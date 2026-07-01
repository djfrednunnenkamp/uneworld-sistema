"""Execução SEGURA de um script Python da operadora para calcular um câmbio.

Camadas de segurança:
  1) RestrictedPython — compila o código bloqueando import, acesso a atributos
     perigosos (__...__), open/exec/eval, etc. Só expomos um conjunto curado de
     builtins + helpers (fetch_json/fetch_text/Decimal).
  2) Subprocesso isolado (spawn) com TIMEOUT rígido (mata o processo se passar) —
     protege contra loop infinito e isola memória.
  3) fetch_* bloqueia URLs internas/loopback/metadata (anti-SSRF).

O script deve definir a variável `result` com a taxa (número). Não há Django
aqui de propósito (o subprocesso fica leve e sem acesso ao banco)."""
import ipaddress
import multiprocessing
import socket
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

import requests

HTTP_TIMEOUT = 10
DEFAULT_TIMEOUT = 12


def _check_url(url):
    p = urlparse(url)
    if p.scheme not in ('http', 'https'):
        raise ValueError('Só http/https é permitido.')
    host = p.hostname
    if not host:
        raise ValueError('URL inválida.')
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        raise ValueError('Não foi possível resolver o host.')
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            raise ValueError('Acesso a endereço interno bloqueado.')


def safe_get(url, timeout=HTTP_TIMEOUT, **kwargs):
    """GET com proteção anti-SSRF (A-05). Valida o scheme (http/https), resolve o
    host e bloqueia loopback/privado/link-local/metadata, e NUNCA segue redirects
    (um 30x poderia escapar da verificação para um destino interno). É o único
    ponto de saída HTTP para URLs controladas pelo usuário na área de câmbio —
    tanto o link próprio da moeda (fetch_from_url no exchange_service) quanto os
    scripts do sandbox (fetch_json/fetch_text) passam por aqui."""
    _check_url(url)
    kwargs.setdefault('allow_redirects', False)   # anti-SSRF: não seguir redirect
    return requests.get(url, timeout=min(timeout, HTTP_TIMEOUT), **kwargs)


def fetch_json(url, timeout=HTTP_TIMEOUT):
    r = safe_get(url, timeout=timeout)
    r.raise_for_status()
    return r.json()


def fetch_text(url, timeout=HTTP_TIMEOUT):
    r = safe_get(url, timeout=timeout)
    r.raise_for_status()
    return r.text


def _build_env():
    from RestrictedPython import compile_restricted, safe_builtins, safe_globals  # noqa: F401
    from RestrictedPython.Guards import guarded_iter_unpack_sequence, safer_getattr
    from RestrictedPython.Eval import default_guarded_getitem, default_guarded_getiter
    from RestrictedPython.PrintCollector import PrintCollector
    import builtins as _bi

    b = dict(safe_builtins)
    for n in ('min', 'max', 'sum', 'round', 'abs', 'len', 'sorted', 'float', 'int',
              'str', 'bool', 'list', 'dict', 'tuple', 'set', 'enumerate', 'range',
              'zip', 'map', 'filter', 'reversed', 'divmod', 'pow', 'all', 'any'):
        if hasattr(_bi, n):
            b[n] = getattr(_bi, n)

    env = dict(safe_globals)
    env['__builtins__'] = b
    env['_getitem_'] = default_guarded_getitem
    env['_getiter_'] = default_guarded_getiter
    env['_getattr_'] = safer_getattr
    env['_iter_unpack_sequence_'] = guarded_iter_unpack_sequence
    env['_print_'] = PrintCollector   # habilita print() (saída coletada)
    env['fetch_json'] = fetch_json
    env['fetch_text'] = fetch_text
    env['Decimal'] = Decimal
    return env


def _printed(loc):
    """Texto acumulado pelos print() do script (PrintCollector), se houver."""
    pc = loc.get('_print')
    if pc is None:
        return ''
    try:
        return str(pc())[:4000]
    except Exception:
        return ''


def _run_target(source, q):
    loc = {}
    try:
        import warnings
        from RestrictedPython import compile_restricted
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', SyntaxWarning)
            byte_code = compile_restricted(source, '<cambio-script>', 'exec')
        env = _build_env()
        exec(byte_code, env, loc)  # noqa: S102 — sandbox RestrictedPython

        def _pick(*names):
            for n in names:
                v = loc.get(n, env.get(n))
                if v is not None:
                    return v
            return None

        # Dois modos:
        #  1) só a taxa de mercado  -> `result` (o acréscimo à vista/parcelado é
        #     aplicado por cima nas Configurações).
        #  2) os dois valores prontos -> `result_a_vista` e `result_parcelado`
        #     (têm precedência; o acréscimo é ignorado).
        market    = _pick('result')
        a_vista   = _pick('result_a_vista', 'result_avista', 'result_vista')
        parcelado = _pick('result_parcelado', 'result_installment', 'result_parc')
        if market is None and a_vista is None and parcelado is None:
            q.put(('err', "O script precisa definir 'result' (taxa de mercado) — "
                          "ou 'result_a_vista' e 'result_parcelado'.", _printed(loc)))
            return
        try:
            def _dec(x):
                return None if x is None else str(Decimal(str(x)))
            data = {'market': _dec(market), 'a_vista': _dec(a_vista), 'parcelado': _dec(parcelado)}
        except (InvalidOperation, ValueError, TypeError) as e:
            q.put(('err', f'Um dos valores retornados não é um número válido: {e}', _printed(loc)))
            return
        q.put(('ok', data, _printed(loc)))
    except SyntaxError as e:
        q.put(('err', f'Bloqueado/erro de sintaxe: {e}', _printed(loc)))
    except Exception as e:  # noqa: BLE001
        q.put(('err', f'{type(e).__name__}: {e}', _printed(loc)))


def run_script(source, timeout=DEFAULT_TIMEOUT):
    """Executa o script no sandbox.

    Devolve (ok, payload, saida_print):
      - ok=True  -> payload = dict {'market','a_vista','parcelado'} (Decimal ou None)
      - ok=False -> payload = mensagem de erro (str)
    """
    if not (source or '').strip():
        return (False, 'Script vazio.', '')
    ctx = multiprocessing.get_context('spawn')
    q = ctx.Queue()
    p = ctx.Process(target=_run_target, args=(source, q), daemon=True)
    p.start()
    p.join(timeout)
    if p.is_alive():
        p.terminate()
        p.join(1)
        return (False, 'Tempo excedido — o script demorou demais e foi interrompido.', '')
    try:
        status, payload, out = q.get_nowait()
    except Exception:
        return (False, 'O script não retornou nada (pode ter travado ou sido morto).', '')
    if status == 'ok':
        data = {k: (Decimal(v) if v is not None else None) for k, v in payload.items()}
        return (True, data, out)
    return (False, payload, out)

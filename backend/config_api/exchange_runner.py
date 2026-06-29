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


def fetch_json(url, timeout=HTTP_TIMEOUT):
    _check_url(url)
    r = requests.get(url, timeout=min(timeout, HTTP_TIMEOUT))
    r.raise_for_status()
    return r.json()


def fetch_text(url, timeout=HTTP_TIMEOUT):
    _check_url(url)
    r = requests.get(url, timeout=min(timeout, HTTP_TIMEOUT))
    r.raise_for_status()
    return r.text


def _build_env():
    from RestrictedPython import compile_restricted, safe_builtins, safe_globals  # noqa: F401
    from RestrictedPython.Guards import guarded_iter_unpack_sequence, safer_getattr
    from RestrictedPython.Eval import default_guarded_getitem, default_guarded_getiter
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
    env['fetch_json'] = fetch_json
    env['fetch_text'] = fetch_text
    env['Decimal'] = Decimal
    return env


def _run_target(source, q):
    try:
        from RestrictedPython import compile_restricted
        byte_code = compile_restricted(source, '<cambio-script>', 'exec')
        env = _build_env()
        loc = {}
        exec(byte_code, env, loc)  # noqa: S102 — sandbox RestrictedPython
        result = loc.get('result', env.get('result'))
        if result is None:
            q.put(('err', "O script precisa definir a variável 'result' com a taxa."))
            return
        try:
            d = Decimal(str(result))
        except (InvalidOperation, ValueError, TypeError):
            q.put(('err', f'O result não é um número válido: {result!r}'))
            return
        q.put(('ok', str(d)))
    except SyntaxError as e:
        q.put(('err', f'Bloqueado/erro de sintaxe: {e}'))
    except Exception as e:  # noqa: BLE001
        q.put(('err', f'{type(e).__name__}: {e}'))


def run_script(source, timeout=DEFAULT_TIMEOUT):
    """Executa o script no sandbox. Devolve (True, Decimal) ou (False, mensagem)."""
    if not (source or '').strip():
        return (False, 'Script vazio.')
    ctx = multiprocessing.get_context('spawn')
    q = ctx.Queue()
    p = ctx.Process(target=_run_target, args=(source, q), daemon=True)
    p.start()
    p.join(timeout)
    if p.is_alive():
        p.terminate()
        p.join(1)
        return (False, 'Tempo excedido — o script demorou demais e foi interrompido.')
    try:
        status, payload = q.get_nowait()
    except Exception:
        return (False, 'O script não retornou nada (pode ter travado ou sido morto).')
    if status == 'ok':
        return (True, Decimal(payload))
    return (False, payload)

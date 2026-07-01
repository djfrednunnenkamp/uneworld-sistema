"""Câmbio automático — busca taxas de moedas → BRL na internet e atualiza os
ConfigExchangeRate (`base_rate`), recalculando a taxa efetiva (com o acréscimo).

Duas fontes possíveis por moeda:
- API global (open.er-api.com, grátis sem chave): pega todas as moedas → BRL.
- Link próprio da moeda (`source_url`): JSON de onde extraímos o número da taxa.
"""
from decimal import Decimal, InvalidOperation

import requests

API_URL = 'https://open.er-api.com/v6/latest/BRL'
TIMEOUT = 15

# Chaves comuns onde APIs costumam colocar a taxa (procuradas primeiro).
RATE_KEYS = ('rate', 'value', 'price', 'bid', 'ask', 'venda', 'cotacao',
             'cotação', 'valor', 'conversion_rate', 'result', 'last')


def _to_decimal(v):
    try:
        if isinstance(v, str):
            v = v.replace(',', '.').strip()
        d = Decimal(str(v))
        return d if d > 0 else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def _extract_rate(obj):
    """Acha um número de taxa plausível num JSON: tenta as chaves conhecidas e,
    se não achar, varre recursivamente pegando o primeiro número positivo."""
    if isinstance(obj, (int, float)):
        return _to_decimal(obj)
    if isinstance(obj, str):
        return _to_decimal(obj)
    if isinstance(obj, dict):
        for k in RATE_KEYS:
            if k in obj:
                d = _extract_rate(obj[k])
                if d is not None:
                    return d
        for v in obj.values():
            d = _extract_rate(v)
            if d is not None:
                return d
    if isinstance(obj, list):
        for v in obj:
            d = _extract_rate(v)
            if d is not None:
                return d
    return None


def fetch_from_url(url):
    """Busca a taxa a partir do link próprio de uma moeda (JSON). Devolve Decimal
    ou None se não conseguir ler um número."""
    resp = requests.get(url, timeout=TIMEOUT)
    resp.raise_for_status()
    try:
        data = resp.json()
    except ValueError:
        return _to_decimal(resp.text.strip())
    d = _extract_rate(data)
    return d.quantize(Decimal('0.0001')) if d is not None else None


def fetch_brl_rates():
    """Devolve {moeda: Decimal(taxa X→BRL)} para todas as moedas (exceto BRL),
    pela API global. Levanta exceção em caso de falha."""
    resp = requests.get(API_URL, timeout=TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    if data.get('result') != 'success' or not data.get('rates'):
        raise ValueError('Resposta inesperada da API de câmbio.')
    out = {}
    for code, brl_to_x in data['rates'].items():
        if code == 'BRL':
            continue
        v = _to_decimal(brl_to_x)
        if v:
            out[code.upper()] = (Decimal('1') / v).quantize(Decimal('0.0001'))
    return out


def _has_script(row):
    """True se a linha tem um script Python customizado associado.

    Script customizado == EXECUÇÃO DE CÓDIGO no servidor (mesmo sandboxed) e por
    isso é um privilégio sensível: só superusuário escreve (serializer) e só
    superusuário dispara manualmente (run_now/update_one). O agendador executa
    esses scripts automaticamente, mas apenas conteúdo escrito por superusuário."""
    return bool((row.script or '').strip())


def _rates_for(row, global_rates):
    """Taxas de uma linha (dict {'market','a_vista','parcelado'} ou None).

    Script (sandbox) tem precedência e pode devolver só a taxa de mercado
    (`market`) ou já os dois valores prontos (`a_vista`/`parcelado`). Link
    próprio e API global devolvem só a taxa de mercado."""
    def _q(v):
        return v.quantize(Decimal('0.0001')) if v is not None else None
    if (row.script or '').strip():
        from .exchange_runner import run_script
        ok, data, _out = run_script(row.script)
        if not ok:
            return None
        return {'market': _q(data.get('market')), 'a_vista': _q(data.get('a_vista')),
                'parcelado': _q(data.get('parcelado'))}
    if row.source_url:
        v = fetch_from_url(row.source_url)
        return {'market': _q(v)} if v is not None else None
    v = global_rates.get(row.from_currency.upper())
    return {'market': _q(v)} if v is not None else None


def _apply_rates(row, data):
    """Aplica as taxas calculadas na linha (em memória, antes do save).

    - Só `market`: vira a taxa de mercado; o acréscimo à vista/parcelado que o
      usuário definiu é aplicado por cima no save() (comportamento padrão).
    - `a_vista`/`parcelado` explícitos: definem DIRETO as taxas efetivas.

    O acréscimo (markup) é SEMPRE definido pelo usuário — nunca é alterado
    automaticamente aqui."""
    market = data.get('market')
    a_vista = data.get('a_vista')
    parcelado = data.get('parcelado')
    base = market if market is not None else a_vista
    if base is not None:
        row.base_rate = base
    # Valores explícitos do script têm precedência sobre o markup neste save
    # (aplicados direto no save() via estes atributos voláteis), sem mexer no
    # acréscimo configurado pelo usuário.
    row._script_a_vista = a_vista
    row._script_parcelado = parcelado


def pull_all_from_internet():
    """Cria/atualiza um câmbio MOEDA → BRL para cada moeda. Linhas com link próprio
    usam o link; as demais usam a API global. Mantém o acréscimo (markup) de cada
    uma. Devolve (criadas, atualizadas)."""
    from .models import ConfigExchangeRate
    global_rates = fetch_brl_rates()
    created = updated = 0
    existing = {r.from_currency.upper(): r for r in ConfigExchangeRate.objects.filter(to_currency='BRL')}
    # Atualiza as existentes (respeitando link próprio)
    for code, row in existing.items():
        try:
            data = _rates_for(row, global_rates)
        except Exception:
            data = None
        if not data:
            continue
        _apply_rates(row, data)
        row.save(update_fields=['base_rate', 'rate', 'rate_installment', 'updated_at'])
        updated += 1
    # Cria as que faltam (a partir da API global)
    for code, brl in global_rates.items():
        if code not in existing:
            ConfigExchangeRate.objects.create(from_currency=code, to_currency='BRL', base_rate=brl, markup_percent=0)
            created += 1
    return created, updated


def update_due(now=None, force=False, include_scripts=True):
    """Atualiza os câmbios com auto_update cujo horário (próprio ou o geral) já
    chegou hoje e que ainda não foram atualizados hoje. Roda no agendador.

    Com force=True atualiza AGORA todas as moedas com auto_update ligado,
    ignorando horário e a marca de "já atualizado hoje" (botão manual).

    include_scripts=False pula as moedas com script customizado (execução de
    código no servidor) — usado quando quem dispara não é superusuário. O
    agendador e o disparo manual por superusuário usam include_scripts=True."""
    from django.utils import timezone
    from .models import ConfigExchangeRate, ConfigExchangeSettings
    now = now or timezone.localtime()
    today = now.date()
    default_time = ConfigExchangeSettings.get().default_update_time

    candidates = ConfigExchangeRate.objects.filter(auto_update=True, to_currency='BRL')
    if not force:
        candidates = candidates.exclude(last_auto_update=today)

    due = []
    for row in candidates:
        # Script customizado só executa para quem tem privilégio (superusuário /
        # agendador). Para os demais a moeda é silenciosamente ignorada aqui.
        if not include_scripts and _has_script(row):
            continue
        if force:
            due.append(row)
            continue
        eff = row.update_time or default_time
        if eff is not None and eff <= now.time():
            due.append(row)
    if not due:
        return 0

    # Busca a API global só se alguma linha precisar (sem script e sem link).
    needs_global = any(not (r.script or '').strip() and not r.source_url for r in due)
    global_rates = fetch_brl_rates() if needs_global else {}
    n = 0
    for row in due:
        try:
            data = _rates_for(row, global_rates)
        except Exception:
            data = None
        if not data:
            continue
        _apply_rates(row, data)
        row.last_auto_update = today
        row.save(update_fields=['base_rate', 'rate', 'rate_installment', 'last_auto_update', 'updated_at'])
        n += 1
    return n

"""Câmbio automático — busca taxas de moedas → BRL na internet e atualiza os
ConfigExchangeRate (`base_rate`), recalculando a taxa efetiva (com o acréscimo).

Fonte: open.er-api.com (grátis, sem chave). Pegamos a base BRL e invertemos:
1 X = 1 / (1 BRL em X). Assim obtemos X → BRL para todas as moedas de uma vez.
"""
from decimal import Decimal, InvalidOperation

import requests

API_URL = 'https://open.er-api.com/v6/latest/BRL'
TIMEOUT = 15


def fetch_brl_rates():
    """Devolve {moeda: Decimal(taxa X→BRL)} para todas as moedas (exceto BRL).
    Levanta exceção em caso de falha de rede/resposta inválida."""
    resp = requests.get(API_URL, timeout=TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    if data.get('result') != 'success' or not data.get('rates'):
        raise ValueError('Resposta inesperada da API de câmbio.')
    out = {}
    for code, brl_to_x in data['rates'].items():
        if code == 'BRL':
            continue
        try:
            v = Decimal(str(brl_to_x))
        except (InvalidOperation, TypeError):
            continue
        if v > 0:
            # rates[code] = quanto de `code` vale 1 BRL → invertendo: 1 code = 1/rates[code] BRL
            out[code.upper()] = (Decimal('1') / v).quantize(Decimal('0.0001'))
    return out


def pull_all_from_internet():
    """Cria/atualiza um câmbio MOEDA → BRL para cada moeda do mundo. Mantém o
    acréscimo (markup) já configurado em cada linha. Devolve (criadas, atualizadas)."""
    from .models import ConfigExchangeRate
    rates = fetch_brl_rates()
    created = updated = 0
    existing = {r.from_currency.upper(): r for r in ConfigExchangeRate.objects.filter(to_currency='BRL')}
    for code, brl in rates.items():
        row = existing.get(code)
        if row:
            row.base_rate = brl
            row.save(update_fields=['base_rate', 'rate', 'updated_at'])
            updated += 1
        else:
            ConfigExchangeRate.objects.create(from_currency=code, to_currency='BRL', base_rate=brl, markup_percent=0)
            created += 1
    return created, updated


def update_due(now=None):
    """Atualiza (da internet) os câmbios marcados como auto_update cujo horário já
    chegou hoje e ainda não foram atualizados hoje. Roda no agendador. Busca a
    tabela uma vez só. Devolve quantos foram atualizados."""
    from django.utils import timezone
    from .models import ConfigExchangeRate
    now = now or timezone.localtime()
    today = now.date()
    due = list(ConfigExchangeRate.objects.filter(
        auto_update=True, to_currency='BRL', update_time__isnull=False,
        update_time__lte=now.time(),
    ).exclude(last_auto_update=today))
    if not due:
        return 0
    rates = fetch_brl_rates()   # uma chamada só pra todos
    n = 0
    for row in due:
        brl = rates.get(row.from_currency.upper())
        if brl is None:
            continue
        row.base_rate = brl
        row.last_auto_update = today
        row.save(update_fields=['base_rate', 'rate', 'last_auto_update', 'updated_at'])
        n += 1
    return n

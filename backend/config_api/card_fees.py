"""Leitura da tabela de taxas das adquirentes (o CSV que elas mandam).

O arquivo não é uma tabela só: é uma pilha delas, uma por gateway, separadas por
um título solto e um cabeçalho que começa em "Parcelas". As colunas mudam de uma
para outra (a Safra tem Hipercard, as outras não) e a mesma bandeira aparece
escrita de três jeitos ("Amex", "AMERICAN EXPRESS", "American Express"). Ler isso
à mão é o tipo de trabalho que a máquina faz melhor — e sem errar de linha.

Duas particularidades que o formato traz e que a leitura precisa respeitar:

1. **Título de grupo x título de tabela.** "TAXAS CIELO" é só um agrupador: logo
   abaixo vêm "CIELO MÁQUINA" e "CIELO LINK", que são os contratos de verdade,
   cada um com a sua tabela. Por isso um título que aparece ANTES de qualquer
   cabeçalho substitui o anterior, em vez de criar um gateway vazio.
2. **Parcela 0 é o débito/à vista**, não "sem informação": ela cobra bem menos
   que 1 parcela e vive na mesma tabela.

Puro de propósito: recebe texto, devolve dados. Quem grava é a view.
"""
import csv
import io
import re
from decimal import Decimal, InvalidOperation

# Como cada adquirente escreve a bandeira → como o sistema a chama. O que não
# estiver aqui entra com o nome que veio (capitalizado), porque uma bandeira
# nova não pode fazer a importação falhar.
SINONIMOS = {
    'amex': 'American Express',
    'american express': 'American Express',
    'visa': 'Visa',
    'mastercard': 'Mastercard',
    'master': 'Mastercard',
    'elo': 'Elo',
    'hipercard': 'Hipercard',
    'hiper': 'Hipercard',
}


def nome_da_bandeira(bruto):
    limpo = re.sub(r'\s+', ' ', (bruto or '').strip())
    if not limpo:
        return ''
    return SINONIMOS.get(limpo.lower(), limpo.title())


def nome_do_gateway(bruto):
    """"TAXAS STONE" → "Stone"; "CIELO MÃQUINA" → "Cielo Máquina"."""
    limpo = re.sub(r'\s+', ' ', (bruto or '').strip())
    limpo = re.sub(r'^taxas\s+', '', limpo, flags=re.I)
    return limpo.title() if limpo.isupper() or limpo.islower() else limpo


def _percentual(bruto):
    """"3,13%" / "3.13%" / "3,13" → Decimal('3.13'). Vazio ou lixo → None."""
    txt = (bruto or '').strip().replace('%', '').replace(' ', '')
    if not txt:
        return None
    txt = txt.replace(',', '.')
    try:
        return Decimal(txt)
    except InvalidOperation:
        return None


def _linha_vazia(celulas):
    return not any((c or '').strip() for c in celulas)


def _e_cabecalho(celulas):
    return (celulas[0] or '').strip().lower().startswith('parcela')


def _e_titulo(celulas):
    """Uma célula preenchida e o resto vazio — é o nome de uma tabela."""
    cheias = [c for c in celulas if (c or '').strip()]
    return len(cheias) == 1 and (celulas[0] or '').strip() != ''


def ler_tabela_de_taxas(texto):
    """Devolve (gateways, avisos).

    gateways: [{'name': 'Stone', 'fees': [{'brand','installments','percent'}, …]}]
    avisos:   frases sobre o que foi ignorado — linha sem número de parcela,
              coluna sem bandeira, célula que não é percentual.
    """
    linhas = list(csv.reader(io.StringIO(texto)))
    gateways, avisos = [], []
    atual = None          # gateway sendo preenchido
    colunas = []          # bandeiras da tabela atual, por posição

    for n, celulas in enumerate(linhas, start=1):
        if not celulas or _linha_vazia(celulas):
            continue

        if _e_titulo(celulas):
            nome = nome_do_gateway(celulas[0])
            # Título logo após outro título (sem tabela no meio) é agrupador:
            # "TAXAS CIELO" some quando "CIELO MÁQUINA" aparece.
            if atual is not None and not atual['fees'] and not colunas:
                gateways.pop()
            atual = {'name': nome, 'fees': []}
            gateways.append(atual)
            colunas = []
            continue

        if _e_cabecalho(celulas):
            if atual is None:                     # tabela sem título antes
                atual = {'name': 'Sem nome', 'fees': []}
                gateways.append(atual)
            colunas = [nome_da_bandeira(c) for c in celulas[1:]]
            continue

        if atual is None or not colunas:
            avisos.append(f'Linha {n}: fora de qualquer tabela — ignorada.')
            continue

        parcela = (celulas[0] or '').strip()
        if not parcela.isdigit():
            avisos.append(f'Linha {n}: "{parcela}" não é um número de parcelas — ignorada.')
            continue

        for i, bruto in enumerate(celulas[1:]):
            bandeira = colunas[i] if i < len(colunas) else ''
            if not bandeira:
                continue
            pct = _percentual(bruto)
            if pct is None:
                if (bruto or '').strip():
                    avisos.append(f'Linha {n}, {bandeira}: "{bruto}" não é um percentual — ignorado.')
                continue
            atual['fees'].append({
                'brand': bandeira,
                'installments': int(parcela),
                'percent': pct,
            })

    # Um título no fim do arquivo, sem tabela, não vira gateway vazio.
    gateways = [g for g in gateways if g['fees']]
    return gateways, avisos

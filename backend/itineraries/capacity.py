"""Capacidade à venda de um roteiro — FONTE ÚNICA.

Quantos passageiros o roteiro comporta NÃO é mais um número digitado à mão: vem
dos BLOQUEIOS (aba Valores › Disponibilidade). Bloqueio é o que a operadora
realmente segurou com o fornecedor, então é ele que manda nas vagas.

Contam assento os bloqueios AÉREO (assentos do voo) e RODOVIÁRIO (assentos do
ônibus) — `quantity` é gente nos dois. Vários bloqueios do mesmo tipo SOMAM. Os
outros tipos contam OUTRA coisa e por isso ficam de fora:
  - terrestre: unidades de QUARTO (as classes vêm no M2M `accommodations`);
  - navio: CABINES (quantidade de cabines do grupo categoria+capacidade).
Somar quarto/cabine com gente daria um número errado — 10 duplos são 20 pessoas,
não 10.

Sem bloqueio de assento: devolve None = SEM LIMITE (mesmo significado que o campo
manual em branco tinha antes). É o que mantém o comportamento de quem ainda não
cadastrou bloqueio.
"""

# Tipos de bloqueio cuja `quantity` é ASSENTO (pessoa), não quarto/cabine.
SEAT_KINDS = ('aereo', 'rodoviario')


def seats_from_blocks(blocks):
    """Soma os assentos de uma lista de bloqueios. Aceita tanto objetos do ORM
    quanto os dicts do snapshot publicado (mesmos nomes de campo).
    Devolve None quando não há NENHUM bloqueio de assento (= sem limite)."""
    total, achou = 0, False
    for b in blocks or []:
        get = b.get if isinstance(b, dict) else (lambda k, d=None, o=b: getattr(o, k, d))
        if get('kind') not in SEAT_KINDS:
            continue
        if not get('is_active', True):
            continue
        try:
            qtd = int(get('quantity') or 0)
        except (TypeError, ValueError):
            continue
        if qtd <= 0:
            continue
        achou = True
        total += qtd
    return total if achou else None


def seats_for_itinerary(itinerary):
    """Capacidade AO VIVO (banco). None = sem limite.

    Lê `.all()` de propósito: quem chama em lote (o hub) faz prefetch dos
    bloqueios, e um `.filter()` aqui jogaria esse prefetch fora, voltando a uma
    query por roteiro. A seleção por tipo/ativo já é feita em `seats_from_blocks`."""
    if itinerary is None:
        return None
    return seats_from_blocks(itinerary.inventory_blocks.all())


# Chave dos bloqueios dentro do pricing_snapshot (ver itineraries/views.py::
# _pricing_snapshot). Fica nomeada aqui porque errar este nome faz a capacidade
# cair silenciosamente no valor AO VIVO — ou seja, vaza mudança não publicada.
SNAPSHOT_BLOCKS_KEY = 'inventory_blocks'


def seats_published(itinerary):
    """Capacidade que vale para as RESERVAS: a da foto publicada (published_data),
    porque é ela que o site e o hub enxergam. Mudou o bloqueio e ainda não
    republicou? O hub continua com o número antigo — de propósito.

    Só cai no vivo quem NUNCA publicou os valores (não existe foto). Se a foto
    existe mas não tem bloqueio nenhum, a resposta é "sem bloqueio publicado" —
    nunca o valor ao vivo, senão o rascunho valeria como publicado."""
    snap = (getattr(itinerary, 'published_data', None) or {}).get('pricing_snapshot')
    if snap is None:
        return seats_for_itinerary(itinerary)
    return seats_from_blocks(snap.get(SNAPSHOT_BLOCKS_KEY))

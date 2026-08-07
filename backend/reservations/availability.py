"""Quantos QUARTOS e CABINES ainda há para reservar num roteiro — fonte única.

A capacidade em PESSOAS já tem dono (`itineraries/capacity.py`, que soma os
assentos de avião/ônibus). Aqui é a outra metade da mesma pergunta: de que
JEITO essas pessoas cabem. Bloqueio terrestre conta unidades de QUARTO e
bloqueio de navio conta CABINES — 10 duplos são 10 unidades e 20 pessoas, e
confundir as duas coisas é o erro clássico deste domínio.

Um bloqueio terrestre pode listar VÁRIAS acomodações: são 10 unidades que podem
virar single OU duplo (pool compartilhado) — se 1 vira single, sobram 9 para o
duplo. Por isso a conta é feita por BLOCO, não por tipo de quarto: o limite
mora no bloco, e os tipos são só as formas que aquelas unidades podem assumir.

Como nas vagas, vale a FOTO PUBLICADA quando ela existe: o que o site oferece é
o que foi publicado, não o rascunho em edição.
"""
from collections import defaultdict

from itineraries.capacity import SNAPSHOT_BLOCKS_KEY

# Só estes dois tipos de bloqueio viram quarto/cabine. 'rodoviario' e 'aereo'
# contam assento (pessoa) e já são tratados em itineraries/capacity.py.
ROOM_KINDS = ('terrestre', 'navio')

# Status de reserva que ainda SEGURAM a unidade. Expirada/cancelada devolvem ao
# estoque; convertida virou contrato — quem segura de lá em diante é o contrato.
HOLDING_STATUSES = ('pendente', 'paga')


def _int(v, padrao=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return padrao


def _pessoa(g):
    """Uma pessoa da reserva, sempre no mesmo formato: {'name', 'passenger'}.

    Aceita texto puro (como era antes, e como chega quem só digitou um nome) e
    o objeto com o passageiro do cadastro. Guardar o ID quando ele existe é o
    que permite, na hora do contrato, casar com a pessoa de verdade em vez de
    comparar nome escrito à mão.
    """
    if isinstance(g, dict):
        nome = str(g.get('name') or '').strip()[:120]
        try:
            pid = int(g.get('passenger')) if g.get('passenger') else None
        except (TypeError, ValueError):
            pid = None
        return {'name': nome, 'passenger': pid}
    return {'name': str(g or '').strip()[:120], 'passenger': None}


def _bloco_publicado(itinerary):
    """Bloqueios que valem para reservar: os da foto publicada; os ao vivo só
    quando o roteiro nunca publicou valores (mesma regra de capacity.py)."""
    snap = (getattr(itinerary, 'published_data', None) or {}).get('pricing_snapshot')
    if snap is None:
        return [_do_orm(b) for b in itinerary.inventory_blocks.all()]
    return [_do_snapshot(b) for b in (snap.get(SNAPSHOT_BLOCKS_KEY) or [])]


def _do_orm(b):
    """Bloqueio do banco → dicionário no formato comum."""
    opcoes = []
    if b.kind == 'terrestre':
        for a in b.accommodations.all():
            opcoes.append({'kind': 'terrestre', 'id': a.id, 'label': a.name,
                           'capacity': _int(getattr(a, 'capacity', 1), 1) or 1})
    elif b.kind == 'navio' and b.ship_cabin_id:
        c = b.ship_cabin
        rotulo = ' · '.join([p for p in [getattr(c, 'category', ''), c.name] if p])
        opcoes.append({'kind': 'navio', 'id': c.id, 'label': rotulo or c.name,
                       'capacity': _int(getattr(c, 'capacity', 1), 1) or 1})
    return {'id': b.id, 'kind': b.kind, 'units': _int(b.quantity), 'is_active': b.is_active,
            'notes': b.notes or '', 'options': opcoes}


def _do_snapshot(b):
    """Bloqueio da foto publicada → mesmo formato. O snapshot já traz os nomes
    e as capacidades resolvidos (é uma foto: não depende do catálogo de hoje)."""
    opcoes = []
    if b.get('kind') == 'terrestre':
        for a in (b.get('accommodations_data') or b.get('accommodations') or []):
            if isinstance(a, dict):
                opcoes.append({'kind': 'terrestre', 'id': a.get('id'), 'label': a.get('name') or '',
                               'capacity': _int(a.get('capacity'), 1) or 1})
    elif b.get('kind') == 'navio' and b.get('ship_cabin'):
        # O snapshot guarda a cabine em campos planos (ver ItineraryInventoryBlockSerializer).
        rotulo = ' · '.join([p for p in [b.get('ship_cabin_category') or '', b.get('ship_cabin_name') or ''] if p])
        opcoes.append({'kind': 'navio', 'id': b.get('ship_cabin'), 'label': rotulo,
                       'capacity': _int(b.get('ship_cabin_capacity'), 1) or 1})
    return {'id': b.get('id'), 'kind': b.get('kind'), 'units': _int(b.get('quantity')),
            'is_active': b.get('is_active', True), 'notes': b.get('notes') or '', 'options': opcoes}


def held_by_reservations(itinerary, ignorar_reserva=None):
    """Unidades já seguras por reservas ATIVAS, por bloco. {block_id: unidades}.

    `ignorar_reserva` tira a própria reserva da conta ao editá-la — senão ela
    apareceria disputando as unidades consigo mesma.
    """
    from .models import ReservationRoom
    qs = (ReservationRoom.objects
          .filter(reservation__itinerary=itinerary,
                  reservation__is_deleted=False,
                  reservation__status__in=HOLDING_STATUSES))
    if ignorar_reserva is not None:
        qs = qs.exclude(reservation_id=ignorar_reserva)
    presos = defaultdict(int)
    for r in qs.values('block_id', 'quantity'):
        presos[r['block_id']] += _int(r['quantity'])
    return presos


def pools_for(itinerary, ignorar_reserva=None):
    """Os "pools" de quarto/cabine do roteiro, prontos para a tela e para a
    validação: cada um com o total do bloco, o quanto já está preso e as formas
    (tipos de quarto/cabine) que aquelas unidades podem assumir.

    Bloco inativo, sem unidade ou sem nenhuma opção fica de fora: não há o que
    escolher nele.
    """
    presos = held_by_reservations(itinerary, ignorar_reserva)
    saida = []
    for b in _bloco_publicado(itinerary):
        if b['kind'] not in ROOM_KINDS or not b.get('is_active', True):
            continue
        if b['units'] <= 0 or not b['options']:
            continue
        preso = presos.get(b['id'], 0)
        saida.append({
            'id': b['id'], 'kind': b['kind'], 'units': b['units'],
            'held': preso, 'available': max(0, b['units'] - preso),
            'notes': b['notes'], 'options': b['options'],
        })
    return saida


def validate_rooms(itinerary, pax, rooms, ignorar_reserva=None):
    """Confere o que a tela mandou. Devolve (linhas_prontas, erro).

    `rooms` = [{'pool': block_id, 'kind': 'terrestre'|'navio', 'id': tipo, 'quantity': n}].

    Duas perguntas, e nesta ordem: (1) cabe no que está bloqueado? (2) o que foi
    escolhido acomoda todo mundo? A segunda só vale para o tipo que a tela
    mandou — reservar só o hotel, e o navio depois, é um caminho legítimo.
    """
    if not rooms:
        return [], None
    pools = {p['id']: p for p in pools_for(itinerary, ignorar_reserva)}
    linhas, por_pool, pessoas = [], defaultdict(int), defaultdict(int)
    com_gente = defaultdict(bool)

    for r in rooms:
        qtd = _int(r.get('quantity'), 1) or 1
        if qtd <= 0:
            continue
        pool = pools.get(_int(r.get('pool'), -1))
        if pool is None:
            return None, 'Um dos quartos escolhidos não está mais disponível neste roteiro. Feche e abra a reserva de novo.'
        opcao = next((o for o in pool['options'] if str(o['id']) == str(r.get('id'))), None)
        if opcao is None:
            return None, 'Um dos tipos escolhidos não pertence ao bloqueio. Feche e abra a reserva de novo.'
        cap = (opcao['capacity'] or 1) * qtd
        # A LISTA de pessoas manda quando ela vem — inclusive vazia, que é um
        # quarto reservado e ainda sem ninguém. Nome em branco é gente igual:
        # quem reserva raramente sabe todos os nomes na hora.
        tem_lista = 'guests' in r
        gente = [_pessoa(g) for g in (r.get('guests') or [])]
        if tem_lista:
            if len(gente) > cap:
                return None, f'"{opcao["label"]}" comporta {cap} pessoa(s), e foram colocadas {len(gente)}.'
            com_gente[pool['kind']] = True
            pessoas[pool['kind']] += len(gente)
        else:
            pessoas[pool['kind']] += cap
        por_pool[pool['id']] += qtd
        linhas.append({'kind': pool['kind'], 'block_id': pool['id'], 'option': opcao,
                       'quantity': qtd, 'guests': gente})

    for pid, qtd in por_pool.items():
        if qtd > pools[pid]['available']:
            disp = pools[pid]['available']
            return None, f'Só há {disp} unidade(s) disponível(is) nesse bloqueio — você pediu {qtd}.'

    for kind, gente in pessoas.items():
        qual = 'quartos' if kind == 'terrestre' else 'cabines'
        # Com as pessoas montadas, cada uma tem de estar em exatamente um lugar:
        # sobrar ou faltar gente aqui é erro de conta, não escolha.
        if com_gente[kind] and gente != pax:
            return None, f'A reserva é para {pax} pessoa(s) e {gente} foram distribuída(s) nos {qual}.'
        if not com_gente[kind] and gente < pax:
            return None, f'Os {qual} escolhidos acomodam {gente} pessoa(s), e a reserva é para {pax}.'

    return linhas, None

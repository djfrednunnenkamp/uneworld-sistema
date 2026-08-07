"""Os quartos de uma reserva — as LINHAS viram o que quem reservou enxergou.

A reserva guarda linhas de estoque (`ReservationRoom`), não quartos: uma linha
pode valer várias unidades (`quantity`) e, numa viagem com navio, o MESMO quarto
é gravado duas vezes — uma linha terrestre (o tipo de quarto que as pessoas
ocupam) e uma de navio (a cabine onde esse quarto cabe), ambas com a mesma gente
dentro. Ler isso cru dá quartos repetidos e o dobro de passageiros.

Mesma conta do front (`Uni_Front/src/utils/reservationRooms.js`), porque é a
mesma pergunta: quem dorme onde. Aqui ela serve para montar os quartos na lista
de passageiros.
"""


def _pessoa(g):
    """Pessoa da reserva, sempre no mesmo formato (aceita o texto puro antigo)."""
    if isinstance(g, dict):
        try:
            pid = int(g.get('passenger')) if g.get('passenger') else None
        except (TypeError, ValueError):
            pid = None
        return {'name': str(g.get('name') or '').strip(), 'passenger': pid}
    return {'name': str(g or '').strip(), 'passenger': None}


def _assinatura(pessoas):
    """Quem está aqui dentro — é por isto que a linha terrestre e a de navio se
    reconhecem como o mesmo quarto. Os sem-nome já chegam numerados pela reserva
    ("Agência X - 2"), então a assinatura distingue quartos só de lugares."""
    return '|'.join(f"{p['passenger'] or ''}#{p['name']}" for p in pessoas)


def unidades_da_reserva(linhas):
    """Uma entrada por UNIDADE reservada. `quantity` > 1 é uma linha que vale N
    quartos iguais: as pessoas são fatiadas pela capacidade, na ordem. Linha sem
    lista de gente (reserva antiga, feita só por contagem) vira o quarto cheio de
    lugares sem nome — que é exatamente o que ela significava."""
    out = []
    for r in linhas or []:
        qtd = max(1, r.quantity or 1)
        cap = max(1, r.capacity or 1)
        pessoas = [_pessoa(g) for g in (r.guests or [])]
        for i in range(qtd):
            fatia = pessoas if qtd == 1 else pessoas[i * cap:(i + 1) * cap]
            out.append({
                'kind': r.kind or 'terrestre',
                'accommodation_id': r.accommodation_id,
                'ship_cabin_id': r.ship_cabin_id,
                'label': r.label or '',
                'cabin_label': '',
                'capacity': cap,
                'pessoas': fatia or [{'name': '', 'passenger': None} for _ in range(cap)],
            })
    return out


def quartos_da_reserva(reservation):
    """Os quartos da reserva: unidades terrestres casadas com as cabines que
    levam AS MESMAS pessoas. Sem nomes para casar (reserva antiga), vale a ordem
    — é o melhor palpite possível e nunca duplica ninguém. Só um dos lados
    existindo (roteiro só de hotel, ou só de navio), cada unidade já é um quarto.
    """
    unidades = unidades_da_reserva(list(reservation.rooms.all()))
    terrestres = [u for u in unidades if u['kind'] == 'terrestre']
    navios = [u for u in unidades if u['kind'] == 'navio']
    if not terrestres or not navios:
        return terrestres or navios

    sobra = list(navios)
    casadas = []
    for t in terrestres:
        if not sobra:
            casadas.append(t)
            continue
        chave = _assinatura(t['pessoas'])
        i = next((j for j, n in enumerate(sobra) if _assinatura(n['pessoas']) == chave), 0)
        n = sobra.pop(i)
        t = dict(t, ship_cabin_id=n['ship_cabin_id'], cabin_label=n['label'] or '')
        casadas.append(t)
    # Cabine sem par (não deveria acontecer): entra como quarto próprio em vez de
    # sumir — perder um quarto reservado seria pior do que mostrar um a mais.
    return casadas + sobra


def nome_do_quarto(q):
    """Como o quarto se chama na lista de passageiros. Com navio, a cabine é o
    lugar e o quarto é o arranjo: "Balcão Juliet Inferior — Duplo Twin"."""
    cabine = (q.get('cabin_label') or '').strip()
    tipo = (q.get('label') or '').strip()
    if cabine and tipo and cabine != tipo:
        return f'{cabine} — {tipo}'
    return cabine or tipo or 'Acomodação'

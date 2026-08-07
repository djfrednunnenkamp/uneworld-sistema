"""Quem, da reserva, JÁ está num contrato.

Uma reserva não vira um contrato só. Duas pessoas num duplo que não é casal
pagam cada uma a sua parte; de três, uma paga por duas e a outra paga sozinha.
São dois contratos para a mesma reserva, e é assim que se vende.

Para a segunda rodada funcionar, a reserva precisa saber QUEM já foi — não
quantos. `pax` (o restante) só conta cabeças: com ele, a tela de "gerar o
próximo contrato" ofereceria de novo quem já está contratado, e a pessoa
entraria em dois contratos.

Por isso cada pessoa na foto da reserva (`ReservationRoom.guests`) recebe o id
do contrato que a levou. Duas maneiras de casar, nesta ordem:

1. **Pelo passageiro**, quando a pessoa da reserva já tinha cadastro — é exato.
2. **Pelo lugar guardado**, para quem entrou sem nome: os hóspedes do contrato
   que sobraram consomem os lugares livres na ordem. É o melhor possível, já
   que o lugar sem nome não tem identidade — e é justamente ele que o contrato
   acabou de batizar.

Numa viagem com navio a mesma pessoa aparece em duas linhas (o quarto e a
cabine). Marcar por `passenger`/`name` acerta as duas de uma vez, que é o que
mantém a foto coerente.
"""


def _chave_sem_nome(g):
    """O rótulo do lugar guardado ("Agência X - 2") é o que o identifica entre as
    linhas de quarto e de cabine da MESMA unidade."""
    return (g.get('name') or '').strip()


def marcar_contratados(reservation, contract, slots=None):
    """Registra na reserva quem entrou neste contrato. Idempotente: rodar de novo
    com o mesmo contrato não consome lugares novos. Devolve quantas pessoas foram
    marcadas.

    `slots` são os rótulos dos lugares sem nome que a tela mandou para o
    contrato. Com eles a marcação é exata; sem eles, os lugares livres são
    consumidos na ordem — o que erra o alvo quando a reserva tem lugares livres
    em quartos diferentes e o contrato levou os do segundo."""
    from .models import ReservationRoom

    rooms = list(reservation.rooms.all())
    if not rooms:
        return 0

    do_contrato = [g.passenger_id for g in contract.guests.all() if g.passenger_id]
    if not do_contrato:
        return 0

    # Quem este contrato já ocupava antes (idempotência): solta para recontar.
    for room in rooms:
        for g in (room.guests or []):
            if g.get('contract') == contract.id:
                g.pop('contract', None)

    marcadas = 0
    restantes = list(do_contrato)

    # 1) Casa pelo passageiro — exato, e pega as duas linhas (quarto + cabine).
    for pid in list(restantes):
        achou = False
        for room in rooms:
            for g in (room.guests or []):
                if g.get('contract') or g.get('passenger') != pid:
                    continue
                g['contract'] = contract.id
                achou = True
        if achou:
            restantes.remove(pid)
            marcadas += 1

    # 2) O que sobrou entrou no lugar de quem ainda não tinha nome. Os rótulos
    #    que a tela mandou (`slots`) vêm primeiro — eles dizem QUAIS lugares
    #    foram; o resto é a ordem, que é o melhor palpite possível.
    if restantes:
        livres = []
        pedidos = [str(s).strip() for s in (slots or []) if str(s).strip()]
        for room in rooms:
            for g in (room.guests or []):
                if g.get('contract') or g.get('passenger'):
                    continue
                chave = _chave_sem_nome(g)
                if chave and chave not in livres:
                    livres.append(chave)
        # Pedidos válidos na frente, sem repetir.
        livres = [c for c in pedidos if c in livres] + [c for c in livres if c not in pedidos]
        for chave in livres[:len(restantes)]:
            for room in rooms:
                for g in (room.guests or []):
                    if not g.get('contract') and not g.get('passenger') and _chave_sem_nome(g) == chave:
                        g['contract'] = contract.id
            marcadas += 1

    ReservationRoom.objects.bulk_update(rooms, ['guests'])
    return marcadas

"""Da reserva para a LISTA DE PASSAGEIROS — e de volta, quando ela cai.

Reservar é dizer quem viaja e como as pessoas se dividem. Quem organiza a
viagem trabalha na lista de passageiros, não no hub de Reservas: se a reserva
não chegar lá sozinha, alguém vai remontar à mão os mesmos quartos que já foram
montados — e as duas telas passam a discordar sobre quem vai.

Duas particularidades do domínio moram aqui:

1. **O lugar sem nome também viaja.** Na hora de reservar quase nunca se sabe
   quem são todos; a lista já tem o conceito exato para isso — o BLOQUEIO de
   agência (`is_block`, assento sem passageiro). O lugar guardado entra como
   bloqueio e vira gente quando o nome aparecer.
2. **O que a reserva fez, a reserva desfaz.** Cada linha criada aqui aponta para
   a reserva (`ListEnrollment.reservation`), então quando ela cai só some o que
   ela pôs — quem entrou por contrato ou à mão fica onde está.
"""
import logging

logger = logging.getLogger(__name__)

# Status da linha na lista: a reserva SEGURA o lugar, ainda não confirmou.
STATUS_RESERVADO = 'reservado'


def lista_do_roteiro(itinerary):
    """A lista que recebe os passageiros do roteiro — a primeira ativa, a MESMA
    regra que o contrato aprovado já segue. Sem lista, ninguém inventa uma."""
    if not itinerary or getattr(itinerary, 'is_deleted', False):
        return None
    return itinerary.passenger_lists.filter(is_deleted=False).order_by('id').first()


def _nome_livre(pl, base, usados):
    """'Duplo Twin', 'Duplo Twin 2'… — o primeiro nome que ainda não existe."""
    if base not in usados:
        return base
    i = 2
    while f'{base} {i}' in usados:
        i += 1
    return f'{base} {i}'


def sincronizar_lista(reservation):
    """Põe (ou repõe) a reserva na lista de passageiros do roteiro.

    Recria o que é DESTA reserva: mudar a divisão dos quartos na reserva tem de
    chegar inteira à lista, e meia-sincronização deixaria quarto fantasma. Quem
    já saiu do controle da reserva (virou contrato, ver `soltar_do_contrato`)
    não é tocado.

    Devolve (passenger_list, linhas_criadas) — `passenger_list` é None quando o
    roteiro não tem lista, e aí nada é feito (a reserva vale do mesmo jeito).
    """
    from django.db import transaction
    from trips.models import ListEnrollment, PassengerList, Room
    from trips.rooms import cleanup_empty_rooms, nomes_ocupados
    from .rooms import quartos_da_reserva, nome_do_quarto

    pl = lista_do_roteiro(reservation.itinerary)
    if pl is None:
        return None, []

    quartos = quartos_da_reserva(reservation)
    # Pessoas sem unidade própria: vão para uma acomodação que já existe na
    # lista, ou para nenhuma. Elas contam tanto quanto as outras.
    soltas = [g for g in (reservation.list_guests or []) if isinstance(g, dict)]
    if not quartos and not soltas:
        return pl, []

    agencia = reservation.agency
    nome_agencia = (getattr(agencia, 'name', '') or '').strip()

    with transaction.atomic():
        # Lock da lista: dois pedidos na mesma lista calculariam a MESMA ordem e
        # os mesmos nomes de quarto em Python e se atropelariam.
        list(PassengerList.objects.select_for_update().filter(pk=pl.pk))

        ListEnrollment.objects.filter(passenger_list=pl, reservation=reservation).delete()

        # Nomes de quarto que ainda TÊM gente — não os Rooms existentes. Os que
        # acabaram de esvaziar (as linhas desta reserva saíram acima) voltam a
        # ser reusáveis; comparar com os Rooms fazia o mesmo quarto virar
        # "Duplo Twin 2", "3", "4"… a cada sincronização.
        usados = nomes_ocupados(pl)
        ja_na_lista = set(pl.list_enrollments.filter(passenger__isnull=False)
                          .values_list('passenger_id', flat=True))
        ultimo = pl.list_enrollments.order_by('-order_in_list').first()
        ordem = (ultimo.order_in_list + 1) if ultimo else 0

        criadas = []
        for q in quartos:
            nome = _nome_livre(pl, nome_do_quarto(q), usados)
            usados.add(nome)
            Room.objects.get_or_create(passenger_list=pl, name=nome)
            for pessoa in q['pessoas']:
                pid = pessoa.get('passenger')
                # Quem já está na lista (por contrato, por outra reserva ou à
                # mão) não entra de novo: a chave é única e a pessoa é uma só.
                if pid and pid in ja_na_lista:
                    continue
                e = ListEnrollment.objects.create(
                    passenger_list=pl,
                    passenger_id=pid,
                    reservation=reservation,
                    origin='reserva',
                    # Sem nome, o lugar guardado é o que a lista já sabe ser:
                    # um bloqueio da agência.
                    is_block=not pid,
                    block_agency=('' if pid else (nome_agencia or pessoa.get('name') or 'Reserva')),
                    agency=agencia,
                    responsible_user=reservation.responsavel,
                    accommodation=nome,
                    enrollment_status=STATUS_RESERVADO,
                    departure_airport=pl.default_airport,
                    order_in_list=ordem,
                )
                if pid:
                    ja_na_lista.add(pid)
                ordem += 1
                criadas.append(e)

        # As sem unidade entram do mesmo jeito — só que na acomodação que já
        # existe (quando foi dita) ou em nenhuma. Quarto que não existe na lista
        # é ignorado no lugar de ser criado: aqui a reserva não segurou unidade
        # nenhuma, e criar um quarto seria inventar estoque.
        nomes_de_quarto = set(pl.rooms.values_list('name', flat=True))
        for g in soltas:
            pid = g.get('passenger') or None
            if pid and pid in ja_na_lista:
                continue
            quarto = (g.get('room') or '').strip()
            nome = quarto if quarto in nomes_de_quarto else ''
            e = ListEnrollment.objects.create(
                passenger_list=pl, passenger_id=pid, reservation=reservation, origin='reserva',
                is_block=not pid,
                block_agency=('' if pid else (nome_agencia or (g.get('name') or '').strip() or 'Reserva')),
                is_provisional=bool(not pid and (g.get('name') or '').strip()),
                agency=agencia, responsible_user=reservation.responsavel,
                accommodation=nome, enrollment_status=STATUS_RESERVADO,
                departure_airport=pl.default_airport, order_in_list=ordem,
            )
            if pid:
                ja_na_lista.add(pid)
            ordem += 1
            criadas.append(e)

        # Quarto sem ninguém dentro não existe (ver trips/rooms.py).
        cleanup_empty_rooms(pl)
    return pl, criadas


def remover_da_lista(reservation):
    """A reserva caiu (expirou ou foi cancelada): tira da lista o que ela pôs.

    Só o que ainda é dela — pessoa que já virou contrato foi solta antes e
    continua na lista, porque aí quem segura o lugar é o contrato."""
    from trips.models import ListEnrollment, PassengerList
    from trips.rooms import cleanup_empty_rooms
    listas = list(PassengerList.objects
                  .filter(list_enrollments__reservation=reservation).distinct())
    apagadas, _ = ListEnrollment.objects.filter(reservation=reservation).delete()
    # Os quartos que essa gente ocupava ficaram vazios — e quarto vazio não existe.
    for pl in listas:
        cleanup_empty_rooms(pl)
    return apagadas


def soltar_do_contrato(contract, passenger_list):
    """A reserva virou contrato: os lugares dela param de ser dela.

    Sem isto, aprovar o contrato duplicaria a viagem na lista — as pessoas
    entrariam de novo e os lugares sem nome ficariam sobrando como assentos
    fantasmas. Quem tem nome no contrato passa a responder pelo contrato; os
    bloqueios que sobraram somem na medida das pessoas que entraram.

    Devolve quantos bloqueios foram consumidos."""
    from trips.models import ListEnrollment

    res_id = getattr(contract, 'source_reservation_id', None)
    if not res_id:
        return 0

    do_contrato = [g.passenger_id for g in contract.guests.all() if g.passenger_id]
    if not do_contrato:
        return 0

    base = ListEnrollment.objects.filter(passenger_list=passenger_list, reservation_id=res_id)
    # Quem o contrato leva e já está na lista pela reserva: continua onde está
    # (mesmo quarto), agora sob o contrato.
    base.filter(passenger_id__in=do_contrato).update(reservation=None)

    # Para cada pessoa do contrato que AINDA não está na lista, um lugar sem
    # nome da reserva deixa de fazer sentido: é ela que vai ocupá-lo.
    ja_na_lista = set(ListEnrollment.objects
                      .filter(passenger_list=passenger_list, passenger_id__in=do_contrato)
                      .values_list('passenger_id', flat=True))
    faltam = len([p for p in do_contrato if p not in ja_na_lista])
    if not faltam:
        return 0
    ids = list(base.filter(is_block=True).order_by('order_in_list')
               .values_list('id', flat=True)[:faltam])
    if not ids:
        return 0
    ListEnrollment.objects.filter(id__in=ids).delete()
    return len(ids)


def sincronizar_contrato(contract):
    """Os nomes que o contrato deu aos lugares chegam à lista NA HORA.

    A reserva pôs lugares guardados na lista porque ainda não se sabia quem
    viajava. No contrato isso deixa de ser verdade: ali as pessoas têm nome. Não
    havia por que esperar a revisão da operadora para a lista saber disso — quem
    organiza a viagem ficava olhando três "Agência X" onde já existiam três
    pessoas, e o cadastro de cada uma ficava fora de alcance.

    Então: cada hóspede do contrato ocupa o lugar que a reserva guardou (mesmo
    quarto, mesma posição — o bloqueio VIRA a pessoa em vez de ser trocado por
    uma linha nova), e mexer no contrato depois mexe na lista junto.

    Vale só para contrato nascido de reserva e já finalizado (não-rascunho): o
    rascunho salva sozinho a cada poucos segundos, e a lista não pode piscar a
    cada tecla. Devolve (passenger_list, quantos_atualizados)."""
    from django.db import transaction
    from trips.models import ListEnrollment, PassengerList, Room
    from trips.rooms import cleanup_empty_rooms, nomes_ocupados

    if getattr(contract, 'is_deleted', False) or contract.status != 'ativo':
        return None, 0
    res_id = getattr(contract, 'source_reservation_id', None)
    if not res_id:
        return None, 0
    pl = lista_do_roteiro(contract.itinerary)
    if pl is None:
        return None, 0

    guests = [g for g in contract.guests.select_related('passenger', 'accommodation_type')
              .order_by('order') if g.passenger_id]
    if not guests:
        return pl, 0

    with transaction.atomic():
        list(PassengerList.objects.select_for_update().filter(pk=pl.pk))

        da_reserva = list(ListEnrollment.objects
                          .filter(passenger_list=pl, reservation_id=res_id)
                          .order_by('order_in_list'))
        # Quartos que a reserva montou, na ordem — é neles que a gente do
        # contrato entra, para o quarto continuar sendo o que foi reservado.
        quartos_res = []
        for e in da_reserva:
            if e.accommodation and e.accommodation not in quartos_res:
                quartos_res.append(e.accommodation)

        # Cada quarto do CONTRATO (room_group) vira um quarto da lista: o
        # correspondente da reserva quando existe, senão um nome novo pelo tipo.
        usados = nomes_ocupados(pl)
        nome_por_grupo, i = {}, 0
        for g in guests:
            grupo = g.room_group if g.room_group is not None else f'g{g.id}'
            if grupo in nome_por_grupo:
                continue
            if i < len(quartos_res):
                nome_por_grupo[grupo] = quartos_res[i]
            else:
                base = (g.accommodation_type.name if g.accommodation_type_id
                        else (g.accommodation_label or 'Acomodação'))
                nome = _nome_livre(pl, base, usados)
                usados.add(nome)
                Room.objects.get_or_create(passenger_list=pl, name=nome)
                nome_por_grupo[grupo] = nome
            i += 1

        livres = [e for e in da_reserva if e.is_block]
        ja = {e.passenger_id: e for e in pl.list_enrollments.filter(passenger__isnull=False)}
        ultimo = pl.list_enrollments.order_by('-order_in_list').first()
        ordem = (ultimo.order_in_list + 1) if ultimo else 0

        mudou = 0
        for g in guests:
            grupo = g.room_group if g.room_group is not None else f'g{g.id}'
            quarto = nome_por_grupo.get(grupo) or ''
            atual = ja.get(g.passenger_id)
            if atual is not None:
                # Já está na lista: o contrato manda no quarto dela.
                if quarto and atual.accommodation != quarto:
                    atual.accommodation = quarto
                    atual.save(update_fields=['accommodation'])
                    mudou += 1
                continue
            if livres:
                # O lugar guardado VIRA a pessoa: mesmo quarto, mesma posição.
                e = livres.pop(0)
                e.passenger_id = g.passenger_id
                e.is_block = False
                e.block_agency = ''
                if quarto:
                    e.accommodation = quarto
                e.save(update_fields=['passenger', 'is_block', 'block_agency', 'accommodation'])
            else:
                e = ListEnrollment.objects.create(
                    passenger_list=pl, passenger_id=g.passenger_id,
                    reservation_id=res_id, origin='reserva',
                    agency=contract.agency, accommodation=quarto,
                    enrollment_status=STATUS_RESERVADO,
                    departure_airport=pl.default_airport, order_in_list=ordem)
                ordem += 1
            ja[g.passenger_id] = e
            mudou += 1

        # Lugar guardado que o contrato não usou só continua fazendo sentido se
        # a reserva ainda tem gente por contratar (ela vira mais de um contrato,
        # e `pax` é o que sobrou). Consumida a reserva, um bloqueio remanescente
        # é assento fantasma: a lista contaria a mesma pessoa duas vezes — uma
        # com nome, outra como vaga da agência.
        restantes = max(0, getattr(contract.source_reservation, 'pax', 0) or 0)
        sobrando = [e.id for e in livres[restantes:]]
        if sobrando:
            ListEnrollment.objects.filter(id__in=sobrando).delete()
            mudou += len(sobrando)
        cleanup_empty_rooms(pl)
    return pl, mudou


def sincronizar_contrato_seguro(contract):
    """Mesma coisa, à prova de falha: um contrato salvo nunca pode ser perdido
    porque a lista de passageiros engasgou."""
    try:
        return sincronizar_contrato(contract)
    except Exception:
        logger.exception('Falha ao levar os nomes do contrato %s para a lista', getattr(contract, 'pk', None))
        return None, 0


def enviar_comprovante(reservation, passenger_list=None):
    """Comprovante da reserva para quem a fez. Reaproveita o aviso de assentos
    reservados (o mesmo que a lista manda ao responsável) — é a mesma notícia,
    e duas cartas diferentes para o mesmo fato só confundiriam.

    Falhar aqui nunca derruba a reserva: ela já está gravada."""
    from agenda.email_service import send_reservation_notice
    from .rooms import quartos_da_reserva, nome_do_quarto

    # O comprovante vai para quem RESPONDE pela reserva: quando a operadora
    # reserva em nome da agência, quem precisa do papel é a agência, não o
    # operador que digitou. Sem responsável dito, é quem fez (ver `responsavel`).
    user = reservation.responsavel
    email = (getattr(user, 'email', '') or '').strip()
    if not email:
        return False

    quartos = quartos_da_reserva(reservation)
    agencia = (getattr(reservation.agency, 'name', '') or '').strip()
    linhas = []
    for q in quartos:
        nome_q = nome_do_quarto(q)
        for pessoa in q['pessoas']:
            linhas.append({
                'name': pessoa.get('name') or (f'{agencia} — lugar reservado' if agencia else 'Lugar reservado'),
                'status': STATUS_RESERVADO,
                'prazo': reservation.expires_at.date() if reservation.expires_at else None,
                'accommodation': nome_q,
                'notes': '',
            })
    if not linhas:
        return False

    itin = reservation.itinerary
    periodo = ' a '.join(d.strftime('%d/%m/%Y') for d in
                         (getattr(itin, 'start_date', None), getattr(itin, 'end_date', None)) if d)
    acomodacoes = {l['accommodation'] for l in linhas if l['accommodation']}
    return send_reservation_notice(
        email, linhas,
        responsible_name=(user.get_full_name() or '').strip(),
        list_name=(passenger_list.name if passenger_list else ''),
        itinerary=(getattr(itin, 'name', '') or ''),
        period=periodo,
        agency=agencia,
        accommodation=(acomodacoes.pop() if len(acomodacoes) == 1 else ''),
        seats=len(linhas),
        created_by=(user.get_full_name() or user.username or '').strip(),
    )


def sincronizar_e_avisar(reservation, avisar=True):
    """O caminho completo de uma reserva recém-criada, à prova de falha: a
    reserva já está gravada, e nem a lista nem o e-mail podem derrubá-la."""
    pl = None
    try:
        pl, _criadas = sincronizar_lista(reservation)
    except Exception:
        logger.exception('Falha ao inscrever a reserva %s na lista de passageiros', reservation.pk)
    if not avisar:
        return pl
    try:
        enviar_comprovante(reservation, pl)
    except Exception:
        logger.exception('Falha ao enviar o comprovante da reserva %s', reservation.pk)
    return pl

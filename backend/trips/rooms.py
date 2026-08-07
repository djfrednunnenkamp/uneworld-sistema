"""Acomodações (Room) de uma lista de passageiros.

REGRA: quarto sem ninguém dentro não existe. Ele não é uma reserva de nome — é
onde as pessoas dormem; vazio, é só ruído numa tela que já é longa, e some
sozinho. Quem monta acomodação na lista cria o quarto AO PÔR alguém nele.
"""


def cleanup_empty_rooms(passenger_list):
    """Apaga as acomodações que ficaram sem nenhum ocupante. Devolve quantas."""
    from .models import Room
    ocupados = set(passenger_list.list_enrollments.exclude(accommodation='')
                   .values_list('accommodation', flat=True))
    apagados, _ = (Room.objects.filter(passenger_list=passenger_list)
                   .exclude(name__in=ocupados).delete())
    return apagados


def nomes_ocupados(passenger_list):
    """Nomes de quarto que TÊM gente agora.

    É contra esta lista que um nome novo é testado — não contra os Rooms
    existentes. Um Room que acabou de ficar vazio (a sincronização apagou e vai
    recriar as linhas dela) precisa poder ser reusado: comparar com os Rooms
    fazia o mesmo quarto virar "Duplo Twin 2", "Duplo Twin 3"… a cada
    sincronização, deixando um rastro de acomodações vazias.
    """
    return set(passenger_list.list_enrollments.exclude(accommodation='')
               .values_list('accommodation', flat=True))

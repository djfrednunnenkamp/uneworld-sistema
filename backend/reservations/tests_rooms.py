"""Quartos e cabines da reserva.

Reservar N lugares não diz onde essas pessoas dormem. O que existe para vender
são UNIDADES de quarto e de cabine (Valores › Disponibilidade), e é contra elas
que a reserva precisa ser conferida — no servidor, porque o limite não pode
depender da tela.

Os casos aqui são as frases que a operadora diria: "não me venda um duplo que
não tenho", "3 pessoas não cabem num single", "o que já está reservado sai da
prateleira" e "bloco de 10 que vira single OU duplo tem 10, não 20".
"""
from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from agencies.models import Agency
from config_api.models import ConfigAccommodation, ConfigShipCabin
from itineraries.models import Itinerary, ItineraryInventoryBlock
from reservations.models import Reservation, ReservationRoom
from reservations.availability import pools_for, validate_rooms
from users_api.models import UserPermissions


class RoomsBaseTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='res', email='res@x.com', password='pw12345678')
        p, _ = UserPermissions.objects.get_or_create(user=self.user)
        p.reservas_create = True
        p.reservas_create_agency = True
        p.reservas_view = True
        p.reservas_view_all = True
        p.reservas_overbook = True   # tira a capacidade em ASSENTOS do caminho
        p.save()
        self.client.force_authenticate(self.user)
        self.ag = Agency.objects.create(name='Agência X')
        self.it = Itinerary.objects.create(name='Cancún', base_currency='USD')
        self.single = ConfigAccommodation.objects.create(name='Single', capacity=1)
        self.duplo = ConfigAccommodation.objects.create(name='Duplo', capacity=2)
        self.cabine = ConfigShipCabin.objects.create(name='Duplo', category='Janela', capacity=2)

    def bloco_hotel(self, qtd, tipos):
        b = ItineraryInventoryBlock.objects.create(itinerary=self.it, kind='terrestre', quantity=qtd)
        b.accommodations.set(tipos)
        return b

    def bloco_navio(self, qtd):
        return ItineraryInventoryBlock.objects.create(itinerary=self.it, kind='navio',
                                                      quantity=qtd, ship_cabin=self.cabine)


class PoolsTest(RoomsBaseTest):
    def test_lista_o_que_o_bloqueio_oferece(self):
        b = self.bloco_hotel(10, [self.single, self.duplo])
        pools = pools_for(self.it)
        self.assertEqual(len(pools), 1)
        self.assertEqual(pools[0]['id'], b.id)
        self.assertEqual((pools[0]['units'], pools[0]['held'], pools[0]['available']), (10, 0, 10))
        self.assertEqual({o['label'] for o in pools[0]['options']}, {'Single', 'Duplo'})

    def test_assento_de_onibus_e_de_aviao_nao_e_quarto(self):
        ItineraryInventoryBlock.objects.create(itinerary=self.it, kind='rodoviario', quantity=45)
        ItineraryInventoryBlock.objects.create(itinerary=self.it, kind='aereo', quantity=30)
        self.assertEqual(pools_for(self.it), [])

    def test_bloco_inativo_ou_vazio_fica_de_fora(self):
        b = self.bloco_hotel(10, [self.duplo])
        b.is_active = False
        b.save()
        self.bloco_hotel(0, [self.duplo])          # sem unidade
        self.bloco_hotel(5, [])                    # sem tipo nenhum
        self.assertEqual(pools_for(self.it), [])

    def test_reserva_ativa_tira_da_prateleira(self):
        b = self.bloco_hotel(10, [self.duplo])
        res = Reservation.objects.create(itinerary=self.it, agency=self.ag, pax=4, status='pendente')
        ReservationRoom.objects.create(reservation=res, kind='terrestre', block=b,
                                       accommodation=self.duplo, label='Duplo', capacity=2, quantity=2)
        self.assertEqual(pools_for(self.it)[0]['available'], 8)
        # Cancelada devolve as unidades.
        res.status = 'cancelada'
        res.save()
        self.assertEqual(pools_for(self.it)[0]['available'], 10)

    def test_ao_editar_a_reserva_nao_disputa_consigo_mesma(self):
        b = self.bloco_hotel(10, [self.duplo])
        res = Reservation.objects.create(itinerary=self.it, agency=self.ag, pax=4, status='pendente')
        ReservationRoom.objects.create(reservation=res, kind='terrestre', block=b,
                                       accommodation=self.duplo, label='Duplo', capacity=2, quantity=2)
        self.assertEqual(pools_for(self.it, ignorar_reserva=res.id)[0]['available'], 10)


class ValidacaoTest(RoomsBaseTest):
    def test_aceita_o_que_cabe(self):
        b = self.bloco_hotel(10, [self.single, self.duplo])
        linhas, erro = validate_rooms(self.it, 3, [
            {'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 1},
            {'pool': b.id, 'kind': 'terrestre', 'id': self.single.id, 'quantity': 1},
        ])
        self.assertIsNone(erro)
        self.assertEqual(sum(l['quantity'] for l in linhas), 2)

    def test_recusa_mais_unidades_do_que_existe(self):
        b = self.bloco_hotel(2, [self.duplo])
        _, erro = validate_rooms(self.it, 6, [{'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 3}])
        self.assertIn('2 unidade', erro or '')

    def test_bloco_compartilhado_soma_os_tipos_no_mesmo_limite(self):
        """10 unidades que viram single OU duplo são 10 no total, não 10 de cada."""
        b = self.bloco_hotel(10, [self.single, self.duplo])
        _, erro = validate_rooms(self.it, 20, [
            {'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 6},
            {'pool': b.id, 'kind': 'terrestre', 'id': self.single.id, 'quantity': 6},
        ])
        self.assertIn('10 unidade', erro or '')

    def test_recusa_quarto_que_nao_acomoda_todo_mundo(self):
        b = self.bloco_hotel(10, [self.single, self.duplo])
        _, erro = validate_rooms(self.it, 3, [{'pool': b.id, 'kind': 'terrestre', 'id': self.single.id, 'quantity': 1}])
        self.assertIn('acomodam 1 pessoa', erro or '')

    def test_recusa_tipo_que_nao_e_do_bloco(self):
        b = self.bloco_hotel(10, [self.duplo])
        _, erro = validate_rooms(self.it, 2, [{'pool': b.id, 'kind': 'terrestre', 'id': self.single.id, 'quantity': 1}])
        self.assertIn('não pertence ao bloqueio', erro or '')

    def test_hotel_e_navio_sao_contas_separadas(self):
        bh = self.bloco_hotel(10, [self.duplo])
        bn = self.bloco_navio(5)
        linhas, erro = validate_rooms(self.it, 4, [
            {'pool': bh.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 2},
            {'pool': bn.id, 'kind': 'navio', 'id': self.cabine.id, 'quantity': 2},
        ])
        self.assertIsNone(erro)
        self.assertEqual(len(linhas), 2)
        # Faltando cabine para uma das pessoas, recusa — mesmo com o hotel completo.
        _, erro2 = validate_rooms(self.it, 4, [
            {'pool': bh.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 2},
            {'pool': bn.id, 'kind': 'navio', 'id': self.cabine.id, 'quantity': 1},
        ])
        self.assertIn('cabines', erro2 or '')

    # ── Pessoas dentro do quarto ─────────────────────────────────────────────
    def test_pessoas_com_nome_em_branco_contam_igual(self):
        """Reservar sem saber os nomes é o caso NORMAL — o lugar já é da pessoa."""
        b = self.bloco_hotel(10, [self.single, self.duplo])
        linhas, erro = validate_rooms(self.it, 3, [
            {'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 1, 'guests': ['Ana', '']},
            {'pool': b.id, 'kind': 'terrestre', 'id': self.single.id, 'quantity': 1, 'guests': ['']},
        ])
        self.assertIsNone(erro)
        self.assertEqual([[g['name'] for g in l['guests']] for l in linhas], [['Ana', ''], ['']])

    def test_recusa_mais_gente_do_que_o_quarto_comporta(self):
        b = self.bloco_hotel(10, [self.duplo])
        _, erro = validate_rooms(self.it, 3, [
            {'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 1, 'guests': ['A', 'B', 'C']},
        ])
        self.assertIn('comporta 2 pessoa', erro or '')

    def test_todo_mundo_precisa_estar_em_algum_quarto(self):
        b = self.bloco_hotel(10, [self.single, self.duplo])
        _, erro = validate_rooms(self.it, 3, [
            {'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 1, 'guests': ['A', 'B']},
        ])
        self.assertIn('3 pessoa(s) e 2', erro or '')

    def test_quarto_reservado_e_ainda_vazio_e_valido(self):
        """Segurar um quarto a mais é legítimo — ele conta unidade, não gente."""
        b = self.bloco_hotel(10, [self.duplo])
        linhas, erro = validate_rooms(self.it, 2, [
            {'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 1, 'guests': ['A', 'B']},
            {'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 1, 'guests': []},
        ])
        self.assertIsNone(erro)
        self.assertEqual(len(linhas), 2)
        self.assertEqual(sum(l['quantity'] for l in linhas), 2)   # segura as duas unidades

    def test_sem_escolha_nenhuma_segue_o_jogo(self):
        """Roteiro sem bloqueio de quarto (ou reserva antiga) continua funcionando."""
        self.assertEqual(validate_rooms(self.it, 3, []), ([], None))


class ApiTest(RoomsBaseTest):
    def test_endpoint_de_disponibilidade(self):
        b = self.bloco_hotel(4, [self.duplo])
        self.bloco_navio(3)
        r = self.client.get('/api/reservations/availability/', {'itinerary': self.it.id})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body['has_terrestre'])
        self.assertTrue(body['has_navio'])
        self.assertEqual({p['id'] for p in body['pools']}, {b.id, b.id + 1})

    def test_cria_reserva_com_quartos_e_da_baixa(self):
        b = self.bloco_hotel(4, [self.single, self.duplo])
        r = self.client.post('/api/reservations/', {
            'itinerary': self.it.id, 'agency': self.ag.id, 'reservation_type': 'sem_pagamento', 'pax': 3,
            'rooms_input': [
                {'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 1},
                {'pool': b.id, 'kind': 'terrestre', 'id': self.single.id, 'quantity': 1},
            ],
        }, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        quartos = r.json()['rooms']
        self.assertEqual(sorted(q['label'] for q in quartos), ['Duplo', 'Single'])
        self.assertEqual(sum(q['people'] for q in quartos), 3)
        # As unidades saíram da prateleira para a próxima reserva.
        self.assertEqual(pools_for(self.it)[0]['available'], 2)

    def test_cria_reserva_com_as_pessoas_dentro_dos_quartos(self):
        b = self.bloco_hotel(4, [self.single, self.duplo])
        r = self.client.post('/api/reservations/', {
            'itinerary': self.it.id, 'agency': self.ag.id, 'reservation_type': 'sem_pagamento', 'pax': 3,
            'rooms_input': [
                {'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 1, 'guests': ['Ana', 'Bruno']},
                {'pool': b.id, 'kind': 'terrestre', 'id': self.single.id, 'quantity': 1, 'guests': ['']},
            ],
        }, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        quartos = sorted(r.json()['rooms'], key=lambda q: q['label'])
        self.assertEqual([g['name'] for g in quartos[0]['guests']], ['Ana', 'Bruno'])
        self.assertEqual(quartos[0]['people'], 2)
        self.assertEqual([g['name'] for g in quartos[1]['guests']], [''])
        self.assertEqual(quartos[1]['people'], 1)

    def test_api_recusa_alem_do_bloqueio(self):
        b = self.bloco_hotel(1, [self.duplo])
        r = self.client.post('/api/reservations/', {
            'itinerary': self.it.id, 'agency': self.ag.id, 'reservation_type': 'sem_pagamento', 'pax': 4,
            'rooms_input': [{'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 2}],
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('rooms', r.json())
        self.assertEqual(Reservation.objects.count(), 0)


class PessoaDoCadastroTest(RoomsBaseTest):
    """A pessoa pode vir do cadastro de passageiros (com vínculo) ou ser um nome
    digitado. Guardar o ID quando ele existe é o que deixa o contrato, depois,
    casar com a pessoa de verdade em vez de comparar nome escrito à mão."""

    def test_guarda_o_vinculo_com_o_passageiro(self):
        from passengers.models import Passenger
        p = Passenger.objects.create(full_name='Ana Souza')
        b = self.bloco_hotel(4, [self.duplo])
        r = self.client.post('/api/reservations/', {
            'itinerary': self.it.id, 'agency': self.ag.id, 'reservation_type': 'sem_pagamento', 'pax': 2,
            'rooms_input': [{'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 1,
                             'guests': [{'name': 'Ana Souza', 'passenger': p.id}, {'name': 'Agência X - 1'}]}],
        }, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        gente = r.json()['rooms'][0]['guests']
        self.assertEqual(gente[0], {'name': 'Ana Souza', 'passenger': p.id})
        self.assertEqual(gente[1], {'name': 'Agência X - 1', 'passenger': None})

    def test_texto_puro_continua_valendo(self):
        """Formato antigo (só o nome) não pode quebrar."""
        b = self.bloco_hotel(4, [self.duplo])
        linhas, erro = validate_rooms(self.it, 2, [
            {'pool': b.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 1, 'guests': ['Ana', 'Bruno']},
        ])
        self.assertIsNone(erro)
        self.assertEqual(linhas[0]['guests'], [{'name': 'Ana', 'passenger': None}, {'name': 'Bruno', 'passenger': None}])


class CabineUniversalTest(RoomsBaseTest):
    """A cabine do navio NÃO é presa a tipo de quarto.

    A mesma cabine serve para single, duplo ou duplo casal — a capacidade dela
    é o TETO, não uma correspondência. Dez cabines são dez cabines: quem vai
    dentro é problema do quarto, desde que caiba.
    """

    def test_uma_pessoa_numa_cabine_de_duas_vale(self):
        bh = self.bloco_hotel(10, [self.single])
        bn = self.bloco_navio(4)          # cabine de 2 pessoas
        linhas, erro = validate_rooms(self.it, 1, [
            {'pool': bh.id, 'kind': 'terrestre', 'id': self.single.id, 'quantity': 1, 'guests': ['Ana']},
            {'pool': bn.id, 'kind': 'navio', 'id': self.cabine.id, 'quantity': 1, 'guests': ['Ana']},
        ])
        self.assertIsNone(erro)
        self.assertEqual(len(linhas), 2)

    def test_a_mesma_cabine_serve_a_ocupacoes_diferentes(self):
        """Um single e um duplo saindo do MESMO bloco de cabines."""
        bh = self.bloco_hotel(10, [self.single, self.duplo])
        bn = self.bloco_navio(4)
        linhas, erro = validate_rooms(self.it, 3, [
            {'pool': bh.id, 'kind': 'terrestre', 'id': self.single.id, 'quantity': 1, 'guests': ['Ana']},
            {'pool': bn.id, 'kind': 'navio', 'id': self.cabine.id, 'quantity': 1, 'guests': ['Ana']},
            {'pool': bh.id, 'kind': 'terrestre', 'id': self.duplo.id, 'quantity': 1, 'guests': ['Bia', 'Caio']},
            {'pool': bn.id, 'kind': 'navio', 'id': self.cabine.id, 'quantity': 1, 'guests': ['Bia', 'Caio']},
        ])
        self.assertIsNone(erro)
        self.assertEqual(sum(l['quantity'] for l in linhas if l['kind'] == 'navio'), 2)   # 2 cabines do mesmo bloco

    def test_o_teto_continua_valendo(self):
        """Três pessoas não entram numa cabine de duas."""
        bn = self.bloco_navio(4)
        _, erro = validate_rooms(self.it, 3, [
            {'pool': bn.id, 'kind': 'navio', 'id': self.cabine.id, 'quantity': 1, 'guests': ['A', 'B', 'C']},
        ])
        self.assertIn('comporta 2 pessoa', erro or '')

    def test_o_teto_vem_da_CATEGORIA_da_cabine(self):
        """O catálogo guarda a cabine como categoria + ocupação, herança de quando
        cabine era presa a tipo de quarto. Um bloqueio de cabines "Janela ·
        Single" são cabines JANELA — e elas recebem um casal, porque a categoria
        existe no catálogo até 2 pessoas."""
        ConfigShipCabin.objects.create(name='Single', category='Janela', capacity=1)
        single_janela = ConfigShipCabin.objects.get(category='Janela', capacity=1)
        b = ItineraryInventoryBlock.objects.create(itinerary=self.it, kind='navio',
                                                   quantity=5, ship_cabin=single_janela)
        pool = next(p for p in pools_for(self.it) if p['id'] == b.id)
        opcao = pool['options'][0]
        self.assertEqual(opcao['label'], 'Janela')      # a cabine é a categoria
        self.assertEqual(opcao['capacity'], 2)          # e comporta o que a categoria comporta
        # …e por isso um casal entra nela.
        _, erro = validate_rooms(self.it, 2, [
            {'pool': b.id, 'kind': 'navio', 'id': single_janela.id, 'quantity': 1, 'guests': ['Ana', 'Bruno']},
        ])
        self.assertIsNone(erro)

"""Envia todos os templates de e-mail com dados fictícios para o endereço informado.

Uso: python manage.py send_test_emails <email>
"""
from datetime import date, timedelta

from django.core.management.base import BaseCommand

from agenda.email_service import (
    send_calendar_summary,
    send_daily_digest,
    send_reservation_notice,
)
from users_api.email_service import send_invite, send_reset_password

SAMPLE_DEADLINE_TODAY = [
    {'passenger_name': 'Ana Beatriz Souza',  'list_name': 'Cancún Julho 2026',  'pending_reason': 'Aguardando documento',   'created_by': 'Frederico N.'},
    {'passenger_name': 'Carlos Mendes',      'list_name': 'Fernando de Noronha', 'pending_reason': '',                       'created_by': 'Maria Lima'},
    {'passenger_name': 'Júlia Fernandes',    'list_name': 'Cancún Julho 2026',  'pending_reason': 'Pagamento pendente',      'created_by': 'Frederico N.'},
]
SAMPLE_DEADLINE_2D = [
    {'passenger_name': 'Roberto Alves',      'list_name': 'Europa Set 2026',     'pending_reason': '',                       'created_by': 'Frederico N.'},
    {'passenger_name': 'Patrícia Costa',     'list_name': 'Nordeste Out 2026',   'pending_reason': 'Voo pendente',           'created_by': 'Ana Lima'},
]
SAMPLE_TASKS = [
    {'title': 'Confirmar ônibus para Cancún',          'list_name': 'Cancún Julho 2026',  'created_by': 'Frederico N.'},
    {'title': 'Enviar contrato para o hotel Atlântico', 'list_name': 'Nordeste Out 2026',  'created_by': 'Maria Lima'},
]
SAMPLE_BIRTHDAYS = [
    {'name': 'Luiz Antonio Pereira', 'birth_date': '17/06/1985', 'age': 41},
    {'name': 'Sandra Oliveira',      'birth_date': '17/06/1990', 'age': 36},
    {'name': 'Marcio Gomes',         'birth_date': '17/06/2001', 'age': 25},
]
SAMPLE_RESERVATION = [
    {'name': 'Analice Carrer',       'status': 'reservado',  'prazo': '2026-08-20', 'accommodation': 'Duplo 12', 'notes': 'Aguardando pagamento da entrada'},
    {'name': 'José Carlos Carrer',   'status': 'reservado',  'prazo': '2026-08-20', 'accommodation': 'Duplo 12', 'notes': ''},
    {'name': 'Marta Regina Bendin',  'status': 'pendente',   'prazo': '2026-08-15', 'accommodation': 'Single 4', 'notes': 'Falta documento'},
    {'name': 'Ana Maria Frapporti',  'status': 'confirmado', 'prazo': '',           'accommodation': 'Triplo 7', 'notes': ''},
]
SAMPLE_CALENDAR_EVENTS = [
    {'type': 'trip',     'title': 'Cancún — Grupo Sol & Mar',  'subtitle': '42 passageiros', 'start': '2026-06-15', 'end': '2026-06-22'},
    {'type': 'trip',     'title': 'Fernando de Noronha',       'subtitle': '18 passageiros', 'start': '2026-06-20', 'end': '2026-06-24'},
    {'type': 'deadline', 'title': 'Ana Beatriz Souza',         'subtitle': 'Cancún Julho 2026 · Definido por Frederico N.', 'start': '2026-06-17', 'end': '2026-06-17'},
    {'type': 'birthday', 'title': 'Luiz Antonio Pereira',      'subtitle': '41 anos',        'start': '2026-06-17', 'end': '2026-06-17'},
]


class Command(BaseCommand):
    help = 'Envia todos os templates de e-mail com dados de exemplo para o endereço informado'

    def add_arguments(self, parser):
        parser.add_argument('email', type=str, help='Endereço de e-mail destino')

    def handle(self, *args, **options):
        to = options['email']
        today = date.today()

        self.stdout.write(f'\n📧 Enviando templates para {to}...\n')

        templates = [
            ('Digest diário consolidado (todas as seções)',
             lambda: send_daily_digest(to, today, SAMPLE_DEADLINE_TODAY, SAMPLE_DEADLINE_2D, SAMPLE_TASKS, SAMPLE_BIRTHDAYS)),

            ('Digest diário — só prazos',
             lambda: send_daily_digest(to, today, SAMPLE_DEADLINE_TODAY, SAMPLE_DEADLINE_2D, [], [])),

            ('Digest diário — só pendências',
             lambda: send_daily_digest(to, today, [], [], SAMPLE_TASKS, [])),

            ('Digest diário — só aniversários',
             lambda: send_daily_digest(to, today, [], [], [], SAMPLE_BIRTHDAYS)),

            ('Resumo do calendário (digest semanal)',
             lambda: send_calendar_summary(to, 'Frederico', SAMPLE_CALENDAR_EVENTS, 'Seu resumo semanal', 'Confira os próximos eventos, prazos e aniversários dos seus passageiros.')),

            ('Reserva de assentos (aviso ao responsável)',
             lambda: send_reservation_notice(
                 to, SAMPLE_RESERVATION,
                 responsible_name='Comercial Você Viagens', list_name='China Extraordinária — Grupo Ago/2026',
                 itinerary='CHINA EXTRAORDINÁRIA: ENTRE IMPÉRIOS E CIDADES DO FUTURO',
                 period='15/08/2026 a 29/08/2026', agency='VOCE VIAGENS E EXPERIENCIAS LTDA',
                 seats=4, created_by='Frederico Nunnenkamp')),

            ('Redefinição de senha',
             lambda: send_reset_password(to, 'Frederico', 'https://uneworld.com.br/reset?token=exemplo123')),

            ('Convite para novo usuário',
             lambda: send_invite(to, 'Maria', 'https://uneworld.com.br/convite?token=exemplo456', 'Frederico Nunnenkamp')),
        ]

        for label, fn in templates:
            try:
                ok = fn()
                status = '✅' if ok else '⚠️ (simulado)'
                self.stdout.write(f'  {status}  {label}')
            except Exception as e:
                self.stdout.write(self.style.ERROR(f'  ❌  {label}: {e}'))

        self.stdout.write('\nPronto.\n')

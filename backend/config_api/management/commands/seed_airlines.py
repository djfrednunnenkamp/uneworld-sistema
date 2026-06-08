import csv
import io
import urllib.request
from django.core.management.base import BaseCommand
from config_api.models import Airline

URL = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat'

# Nomes de país em português para os mais comuns
PT_NAMES = {
    'United States': 'Estados Unidos', 'United Kingdom': 'Reino Unido',
    'Brazil': 'Brasil', 'Germany': 'Alemanha', 'France': 'França',
    'Spain': 'Espanha', 'Italy': 'Itália', 'Portugal': 'Portugal',
    'Netherlands': 'Países Baixos', 'Switzerland': 'Suíça',
    'Australia': 'Austrália', 'Canada': 'Canadá', 'China': 'China',
    'Japan': 'Japão', 'Russia': 'Rússia', 'India': 'Índia',
    'Mexico': 'México', 'Argentina': 'Argentina', 'Colombia': 'Colômbia',
    'Chile': 'Chile', 'Peru': 'Peru', 'Turkey': 'Turquia',
    'Saudi Arabia': 'Arábia Saudita', 'United Arab Emirates': 'Emirados Árabes',
    'South Africa': 'África do Sul', 'Egypt': 'Egito', 'Kenya': 'Quênia',
    'Ethiopia': 'Etiópia', 'Morocco': 'Marrocos', 'Nigeria': 'Nigéria',
    'South Korea': 'Coreia do Sul', 'Singapore': 'Singapura',
    'Thailand': 'Tailândia', 'Malaysia': 'Malásia', 'Indonesia': 'Indonésia',
    'Philippines': 'Filipinas', 'Vietnam': 'Vietnã', 'Pakistan': 'Paquistão',
    'Greece': 'Grécia', 'Sweden': 'Suécia', 'Norway': 'Noruega',
    'Denmark': 'Dinamarca', 'Finland': 'Finlândia', 'Poland': 'Polônia',
    'Austria': 'Áustria', 'Belgium': 'Bélgica', 'Ireland': 'Irlanda',
    'New Zealand': 'Nova Zelândia', 'Israel': 'Israel', 'Iran': 'Irã',
    'Iraq': 'Iraque', 'Kuwait': 'Kuwait', 'Qatar': 'Catar',
    'Bahrain': 'Bahrein', 'Oman': 'Omã', 'Jordan': 'Jordânia',
    'Lebanon': 'Líbano', 'Ukraine': 'Ucrânia', 'Romania': 'Romênia',
    'Hungary': 'Hungria', 'Czech Republic': 'República Tcheca',
    'Slovakia': 'Eslováquia', 'Croatia': 'Croácia', 'Serbia': 'Sérvia',
    'Bulgaria': 'Bulgária', 'Latvia': 'Letônia', 'Lithuania': 'Lituânia',
    'Estonia': 'Estônia', 'Iceland': 'Islândia', 'Cyprus': 'Chipre',
    'Malta': 'Malta', 'Luxembourg': 'Luxemburgo', 'Slovenia': 'Eslovênia',
}


def pt(name):
    return PT_NAMES.get(name, name)


class Command(BaseCommand):
    help = 'Importa companhias aéreas do mundo via OpenFlights'

    def add_arguments(self, parser):
        parser.add_argument('--clear', action='store_true', help='Apaga tudo antes de importar')

    def handle(self, *args, **options):
        if options['clear']:
            Airline.objects.all().delete()
            self.stdout.write('Base limpa.')

        self.stdout.write('Baixando airlines.dat…')
        try:
            with urllib.request.urlopen(URL, timeout=30) as resp:
                raw = resp.read().decode('utf-8', errors='replace')
        except Exception as e:
            self.stderr.write(f'Erro ao baixar: {e}')
            return

        reader = csv.reader(io.StringIO(raw))
        existing = set(Airline.objects.values_list('name', flat=True))
        to_create = []

        for row in reader:
            # Formato: id, name, alias, iata, icao, callsign, country, active
            if len(row) < 7:
                continue
            name    = row[1].strip().strip('"')
            iata    = row[3].strip().strip('"')
            country = row[6].strip().strip('"')
            active  = row[7].strip().strip('"') if len(row) > 7 else ''

            # Ignora entradas inválidas, inativas ou sem nome
            if not name or name in ('-', '\\N') or active == 'N':
                continue
            if iata in ('\\N', '-', ''):
                iata = ''
            if country in ('\\N', '-', ''):
                country = ''

            if name not in existing:
                to_create.append(Airline(
                    name=name,
                    iata_code=iata,
                    country=pt(country),
                ))
                existing.add(name)

        Airline.objects.bulk_create(to_create, batch_size=500)
        self.stdout.write(self.style.SUCCESS(
            f'Importadas {len(to_create)} companhias aéreas.'
        ))

"""
Importa todos os aeroportos com código IATA do banco OurAirports.
Fonte: https://davidmegginson.github.io/ourairports-data/airports.csv
"""
import csv
import io
import requests
import pycountry
from django.core.management.base import BaseCommand
from config_api.models import Airport

EXCLUDED_TYPES = {'heliport', 'balloonport', 'seaplane_base', 'closed'}

# Nomes em português para países mais comuns
PT_NAMES = {
    'Brazil': 'Brasil',
    'United States': 'Estados Unidos',
    'United Kingdom': 'Reino Unido',
    'Germany': 'Alemanha',
    'France': 'França',
    'Spain': 'Espanha',
    'Italy': 'Itália',
    'Portugal': 'Portugal',
    'Argentina': 'Argentina',
    'Chile': 'Chile',
    'Colombia': 'Colômbia',
    'Peru': 'Peru',
    'Bolivia': 'Bolívia',
    'Uruguay': 'Uruguai',
    'Paraguay': 'Paraguai',
    'Venezuela': 'Venezuela',
    'Ecuador': 'Equador',
    'Mexico': 'México',
    'Canada': 'Canadá',
    'Australia': 'Austrália',
    'Japan': 'Japão',
    'China': 'China',
    'India': 'Índia',
    'Russia': 'Rússia',
    'Switzerland': 'Suíça',
    'Netherlands': 'Países Baixos',
    'Belgium': 'Bélgica',
    'Sweden': 'Suécia',
    'Norway': 'Noruega',
    'Denmark': 'Dinamarca',
    'Finland': 'Finlândia',
    'Poland': 'Polônia',
    'Turkey': 'Turquia',
    'Greece': 'Grécia',
    'Egypt': 'Egito',
    'South Africa': 'África do Sul',
    'Morocco': 'Marrocos',
    'Kenya': 'Quênia',
    'Nigeria': 'Nigéria',
    'United Arab Emirates': 'Emirados Árabes',
    'Saudi Arabia': 'Arábia Saudita',
    'Israel': 'Israel',
    'Thailand': 'Tailândia',
    'Singapore': 'Singapura',
    'Indonesia': 'Indonésia',
    'Malaysia': 'Malásia',
    'South Korea': 'Coreia do Sul',
    'New Zealand': 'Nova Zelândia',
    'Austria': 'Áustria',
    'Hungary': 'Hungria',
    'Czech Republic': 'República Tcheca',
    'Czechia': 'República Tcheca',
    'Romania': 'Romênia',
    'Croatia': 'Croácia',
    'Slovakia': 'Eslováquia',
    'Ukraine': 'Ucrânia',
    'Serbia': 'Sérvia',
    'Bulgaria': 'Bulgária',
    'Iceland': 'Islândia',
    'Ireland': 'Irlanda',
    'Cuba': 'Cuba',
    'Dominican Republic': 'República Dominicana',
    'Panama': 'Panamá',
    'Costa Rica': 'Costa Rica',
    'Guatemala': 'Guatemala',
    'Honduras': 'Honduras',
    'El Salvador': 'El Salvador',
    'Nicaragua': 'Nicarágua',
    'Jamaica': 'Jamaica',
    'Trinidad and Tobago': 'Trinidad e Tobago',
    'Philippines': 'Filipinas',
    'Vietnam': 'Vietnã',
    'Cambodia': 'Camboja',
    'Myanmar': 'Mianmar',
    'Bangladesh': 'Bangladesh',
    'Pakistan': 'Paquistão',
    'Iran': 'Irã',
    'Iraq': 'Iraque',
    'Jordan': 'Jordânia',
    'Lebanon': 'Líbano',
    'Qatar': 'Catar',
    'Kuwait': 'Kuwait',
    'Bahrain': 'Bahrein',
    'Oman': 'Omã',
    'Ethiopia': 'Etiópia',
    'Tanzania': 'Tanzânia',
    'Uganda': 'Uganda',
    'Ghana': 'Gana',
    'Senegal': 'Senegal',
    'Mozambique': 'Moçambique',
    'Angola': 'Angola',
    'Congo': 'Congo',
    'Zimbabwe': 'Zimbábue',
    'Zambia': 'Zâmbia',
    'Cameroon': 'Camarões',
    'Ivory Coast': 'Costa do Marfim',
    "Côte d'Ivoire": 'Costa do Marfim',
    'Tunisia': 'Tunísia',
    'Algeria': 'Argélia',
    'Libya': 'Líbia',
    'Sudan': 'Sudão',
    'Luxembourg': 'Luxemburgo',
    'Malta': 'Malta',
    'Cyprus': 'Chipre',
    'Albania': 'Albânia',
    'North Macedonia': 'Macedônia do Norte',
    'Bosnia and Herzegovina': 'Bósnia e Herzegovina',
    'Slovenia': 'Eslovênia',
    'Estonia': 'Estônia',
    'Latvia': 'Letônia',
    'Lithuania': 'Lituânia',
    'Belarus': 'Bielorrússia',
    'Moldova': 'Moldávia',
    'Georgia': 'Geórgia',
    'Armenia': 'Armênia',
    'Azerbaijan': 'Azerbaijão',
    'Kazakhstan': 'Cazaquistão',
    'Uzbekistan': 'Uzbequistão',
    'Tajikistan': 'Tajiquistão',
    'Kyrgyzstan': 'Quirguistão',
    'Turkmenistan': 'Turcomenistão',
    'Afghanistan': 'Afeganistão',
    'Nepal': 'Nepal',
    'Sri Lanka': 'Sri Lanka',
    'Maldives': 'Maldivas',
    'Mongolia': 'Mongólia',
    'Papua New Guinea': 'Papua Nova Guiné',
    'Fiji': 'Fiji',
    'Haiti': 'Haiti',
    'Bolivia, Plurinational State of': 'Bolívia',
    'Venezuela, Bolivarian Republic of': 'Venezuela',
    "Korea, Republic of": 'Coreia do Sul',
    'Korea, Democratic People\'s Republic of': 'Coreia do Norte',
    'Iran, Islamic Republic of': 'Irã',
    'Tanzania, United Republic of': 'Tanzânia',
    'Congo, the Democratic Republic of the': 'Congo (RDC)',
    'Syrian Arab Republic': 'Síria',
    'Viet Nam': 'Vietnã',
    'Lao People\'s Democratic Republic': 'Laos',
    'Taiwan, Province of China': 'Taiwan',
    'Hong Kong': 'Hong Kong',
    'Macao': 'Macau',
}


def country_name(iso2):
    try:
        c = pycountry.countries.get(alpha_2=iso2)
        if c:
            name = c.name
            return PT_NAMES.get(name, name)
    except Exception:
        pass
    return iso2


class Command(BaseCommand):
    help = 'Importa aeroportos do mundo inteiro via OurAirports (ourairports.com)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Apaga todos os aeroportos antes de importar',
        )
        parser.add_argument(
            '--large-only',
            action='store_true',
            help='Importar somente aeroportos grandes e médios',
        )

    def handle(self, *args, **options):
        progress_callback = options.get('progress_callback')

        def progress(done, total):
            if progress_callback:
                progress_callback(done, total)

        url = 'https://davidmegginson.github.io/ourairports-data/airports.csv'
        self.stdout.write('Baixando dados do OurAirports…')
        progress(0, 1)
        try:
            r = requests.get(url, timeout=60)
            r.raise_for_status()
        except Exception as e:
            self.stderr.write(f'Erro ao baixar: {e}')
            raise

        if options['clear']:
            deleted, _ = Airport.objects.all().delete()
            self.stdout.write(f'Removidos {deleted} aeroportos existentes.')

        existing_iata = set(Airport.objects.values_list('iata_code', flat=True).exclude(iata_code=''))

        rows = list(csv.DictReader(io.StringIO(r.text)))
        to_create = []
        skipped = 0
        total = len(rows)

        for i, row in enumerate(rows, 1):
            iata = (row.get('iata_code') or '').strip()
            atype = (row.get('type') or '').strip()

            if iata and atype not in EXCLUDED_TYPES and not (options['large_only'] and atype not in ('large_airport', 'medium_airport')):
                if iata in existing_iata:
                    skipped += 1
                else:
                    name    = (row.get('name') or '').strip()
                    city    = (row.get('municipality') or '').strip()
                    iso2    = (row.get('iso_country') or '').strip()
                    country = country_name(iso2) if iso2 else ''
                    to_create.append(Airport(name=name, iata_code=iata, city=city, country=country))
                    existing_iata.add(iata)

            if i % 500 == 0 or i == total:
                progress(i, total)

        Airport.objects.bulk_create(to_create, batch_size=500)

        self.stdout.write(self.style.SUCCESS(
            f'Importados {len(to_create)} aeroportos. '
            f'{skipped} já existiam e foram ignorados.'
        ))
        return len(to_create)

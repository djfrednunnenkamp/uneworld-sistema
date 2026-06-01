"""
Importa países, estados e cidades de todos os países cadastrados no banco.
Uso: python manage.py import_all [--skip-cities] [--country BR]

Fontes:
  - Países: já devem estar no banco (importados via painel)
  - Estados BR: IBGE
  - Estados outros: CountriesNow
  - Cidades BR: IBGE
  - Cidades outros: CountriesNow
"""
import time
import requests
from django.core.management.base import BaseCommand
from config_api.models import ConfigCountry, ConfigState, ConfigCity

IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades'
CNOW = 'https://countriesnow.space/api/v0.1/countries'


def get(url, **kwargs):
    for attempt in range(3):
        try:
            r = requests.get(url, timeout=20, **kwargs)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def post(url, payload):
    for attempt in range(3):
        try:
            r = requests.post(url, json=payload, timeout=20)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


class Command(BaseCommand):
    help = 'Importa estados e cidades de todos os países no banco de dados'

    def add_arguments(self, parser):
        parser.add_argument('--skip-cities', action='store_true',
                            help='Importa só estados, pula cidades')
        parser.add_argument('--country', type=str, default=None,
                            help='Importa só para o código ISO informado (ex: BR)')

    def handle(self, *args, **options):
        skip_cities = options['skip_cities']
        only_code   = options['country']

        countries = ConfigCountry.objects.all().order_by('name')
        if only_code:
            countries = countries.filter(code__iexact=only_code)

        total_c = countries.count()
        if total_c == 0:
            self.stdout.write(self.style.WARNING('Nenhum país encontrado. Importe os países pelo painel primeiro.'))
            return

        self.stdout.write(f'\n📦 Iniciando importação para {total_c} país(es)...\n')

        total_states = 0
        total_cities = 0
        errors = []

        for idx, country in enumerate(countries, 1):
            prefix = f'[{idx}/{total_c}] {country.name}'

            # ── Estados ────────────────────────────────────────────────
            existing_states = country.states.count()
            new_states = 0

            try:
                if country.code == 'BR':
                    data = get(f'{IBGE}/estados?orderBy=nome')
                    for s in data:
                        _, created = ConfigState.objects.get_or_create(
                            country=country, name=s['nome'],
                            defaults={'code': s['sigla']}
                        )
                        if created:
                            new_states += 1
                else:
                    result = post(f'{CNOW}/states', {'country': country.name})
                    states_data = result.get('data', {}).get('states', [])
                    for s in states_data:
                        _, created = ConfigState.objects.get_or_create(
                            country=country, name=s['name'],
                            defaults={'code': s.get('state_code', '')}
                        )
                        if created:
                            new_states += 1

                total_states += new_states
                state_count = country.states.count()
                self.stdout.write(f'{prefix} → {state_count} estados ({new_states} novos)')

            except Exception as e:
                errors.append(f'{country.name}: erro estados — {e}')
                self.stdout.write(self.style.WARNING(f'{prefix} → ERRO estados: {e}'))
                continue

            if skip_cities:
                continue

            # ── Cidades ────────────────────────────────────────────────
            states = country.states.all()
            country_cities = 0

            for state in states:
                if state.cities.exists():
                    continue  # já importado

                try:
                    if country.code == 'BR':
                        state_code = state.code or state.name
                        data = get(f'{IBGE}/estados/{state_code}/municipios?orderBy=nome')
                        cities = [c['nome'] for c in data]
                    else:
                        result = post(f'{CNOW}/state/cities', {
                            'country': country.name,
                            'state':   state.name,
                        })
                        cities = result.get('data', [])

                    objs = [
                        ConfigCity(state=state, name=city)
                        for city in cities
                        if city and not ConfigCity.objects.filter(state=state, name=city).exists()
                    ]
                    ConfigCity.objects.bulk_create(objs, ignore_conflicts=True)
                    country_cities += len(objs)
                    total_cities   += len(objs)

                    # pausa para não sobrecarregar a API
                    time.sleep(0.3)

                except Exception as e:
                    errors.append(f'{country.name}/{state.name}: erro cidades — {e}')
                    self.stdout.write(self.style.WARNING(
                        f'  ⚠ {state.name}: erro cidades — {e}'
                    ))

            if country_cities:
                self.stdout.write(f'  ↳ {country_cities} cidades importadas')

        # ── Resumo ─────────────────────────────────────────────────────
        self.stdout.write('\n' + '─' * 50)
        self.stdout.write(self.style.SUCCESS(
            f'✓ Concluído: {total_states} estados e {total_cities} cidades importados.'
        ))
        if errors:
            self.stdout.write(self.style.WARNING(f'\n{len(errors)} erro(s):'))
            for e in errors[:10]:
                self.stdout.write(f'  • {e}')

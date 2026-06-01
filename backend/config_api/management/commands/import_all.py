"""
Importa estados e cidades de todos os países cadastrados no banco.
Uso: python manage.py import_all [--skip-cities] [--country BR]
"""
import time
import requests
from django.core.management.base import BaseCommand
from config_api.models import ConfigCountry, ConfigState, ConfigCity

IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades'
CNOW = 'https://countriesnow.space/api/v0.1/countries'


def get_json(url, timeout=20):
    for attempt in range(3):
        try:
            r = requests.get(url, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def post_json(url, payload, timeout=20):
    for attempt in range(3):
        try:
            r = requests.post(url, json=payload, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def build_en_name_map():
    """Retorna dict {iso_code: english_name} usando restcountries."""
    try:
        data = get_json('https://restcountries.com/v3.1/all?fields=name,cca2', timeout=30)
        return {c['cca2']: c['name']['common'] for c in data if c.get('cca2')}
    except Exception:
        return {}


class Command(BaseCommand):
    help = 'Importa estados e cidades de todos os países no banco de dados'

    def add_arguments(self, parser):
        parser.add_argument('--skip-cities', action='store_true',
                            help='Importa só estados, pula cidades')
        parser.add_argument('--country', type=str, default=None,
                            help='Código ISO do país (ex: BR)')

    def handle(self, *args, **options):
        skip_cities = options['skip_cities']
        only_code   = options['country']

        countries = ConfigCountry.objects.all().order_by('name')
        if only_code:
            countries = countries.filter(code__iexact=only_code)

        total = countries.count()
        if total == 0:
            self.stdout.write(self.style.WARNING('Nenhum país. Importe os países pelo painel primeiro.'))
            return

        # Busca nomes em inglês para usar na API CountriesNow
        self.stdout.write('🌐 Carregando mapeamento de nomes (EN)...')
        en_map = build_en_name_map()
        self.stdout.write(f'   {len(en_map)} países mapeados.\n')
        self.stdout.write(f'📦 Iniciando importação para {total} país(es)...\n')

        total_states = 0
        total_cities = 0
        errors = []

        for idx, country in enumerate(countries, 1):
            prefix   = f'[{idx}/{total}] {country.name}'
            en_name  = en_map.get(country.code, country.name)

            # ── Estados ────────────────────────────────────────────────
            new_states = 0
            try:
                if country.code == 'BR':
                    data = get_json(f'{IBGE}/estados?orderBy=nome')
                    for s in data:
                        _, created = ConfigState.objects.get_or_create(
                            country=country, name=s['nome'],
                            defaults={'code': s['sigla']}
                        )
                        if created:
                            new_states += 1
                else:
                    result = post_json(f'{CNOW}/states', {'country': en_name})
                    for s in result.get('data', {}).get('states', []):
                        _, created = ConfigState.objects.get_or_create(
                            country=country, name=s['name'],
                            defaults={'code': s.get('state_code', '')}
                        )
                        if created:
                            new_states += 1

                total_states += new_states
                count = country.states.count()
                self.stdout.write(f'{prefix} → {count} estados ({new_states} novos)')

            except Exception as e:
                errors.append(f'{country.name}: estados — {e}')
                self.stdout.write(self.style.WARNING(f'{prefix} → ERRO estados: {e}'))
                continue

            if skip_cities:
                continue

            # ── Cidades ────────────────────────────────────────────────
            country_new_cities = 0
            for state in country.states.all():
                if state.cities.exists():
                    continue

                try:
                    if country.code == 'BR':
                        code = state.code or state.name
                        data = get_json(f'{IBGE}/estados/{code}/municipios?orderBy=nome')
                        names = [c['nome'] for c in data]
                    else:
                        result = post_json(f'{CNOW}/state/cities', {
                            'country': en_name,
                            'state':   state.name,
                        })
                        names = result.get('data', [])

                    if names:
                        objs = [ConfigCity(state=state, name=n) for n in names if n]
                        ConfigCity.objects.bulk_create(objs, ignore_conflicts=True)
                        country_new_cities += len(objs)
                        total_cities       += len(objs)

                    time.sleep(0.25)

                except Exception as e:
                    errors.append(f'{country.name}/{state.name}: cidades — {e}')

            if country_new_cities:
                self.stdout.write(f'  ↳ {country_new_cities} cidades')

        # ── Resumo ─────────────────────────────────────────────────────
        self.stdout.write('\n' + '─' * 50)
        self.stdout.write(self.style.SUCCESS(
            f'✓ Concluído: {total_states} estados e {total_cities} cidades importados.'
        ))
        if errors:
            self.stdout.write(self.style.WARNING(f'\n{len(errors)} aviso(s):'))
            for e in errors[:20]:
                self.stdout.write(f'  • {e}')

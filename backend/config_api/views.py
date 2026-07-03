import csv
import io
import requests
from django.db.models import Q
from django.http import StreamingHttpResponse, HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework import serializers
from rest_framework.parsers import MultiPartParser
from .models import (ConfigProfession, ConfigLanguage, ConfigCountry, ConfigState,
                     ConfigCity, ConfigVaccine, ConfigGender, ConfigProfCard,
                     CustomDocType, CustomDocField, CustomDocFieldOption,
                     ConfigAccommodation, ConfigListCategory, Airport, Airline,
                     BusMap, BusMapRow, SystemSettings, PermissionProfile, ContractClause, TermsAndConditions,
                     OperatingCompany, ConfigPaymentMethod, ConfigPaymentPlan, ConfigExchangeRate,
                     ConfigItineraryCategory, ConfigContinent, ConfigDestination, ConfigHoliday, ConfigService,
                     ConfigItineraryTemplate)
from users_api.permissions import RequirePermission
from core.soft_delete import SoftDeleteViewSetMixin
from dashboard.jobs import run_job


def _settings_perm(perm_base, extra_write=None, action_perms=None):
    """Factory de get_permissions para ViewSets de configurações com permissões granulares.

    action_perms: {nome_da_action: sufixo} — exige '{perm_base}_{sufixo}' para essa action
    específica, em vez do '_edit' genérico (ex: 'import_default' -> 'import_web')."""
    write_set = frozenset(['create', 'update', 'partial_update'] + (extra_write or []))
    action_perms = action_perms or {}

    def get_permissions(self):
        if self.action in action_perms:
            return [RequirePermission('manage_settings', f'{perm_base}_{action_perms[self.action]}')()]
        if self.action == 'destroy':
            return [RequirePermission('manage_settings', perm_base, f'{perm_base}_delete')()]
        if self.action in write_set:
            return [RequirePermission('manage_settings', perm_base, f'{perm_base}_edit')()]
        return [IsAuthenticated()]

    return get_permissions


# ── Exportação/Importação global de Países → Estados → Cidades ────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def geo_analyze(request):
    """
    Analisa linhas do CSV sem gravar nada.
    Input:  { rows: [{continente, pais, estado, cidade}, ...] }
    Output: { rows: [{...row, status: 'new'|'exists'|'error', msg?}, ...] }
    """
    rows = request.data.get('rows', [])
    if not rows:
        return Response({'rows': []})

    # Carrega sets de existentes para comparação rápida
    existing_countries = set(ConfigCountry.objects.values_list('name', flat=True))

    # Para estados: {(country_name, state_name)}
    existing_states = set(
        ConfigState.objects.select_related('country')
        .values_list('country__name', 'name')
    )

    # Para cidades: {(state__country__name, state__name, city__name)}
    existing_cities = set(
        ConfigCity.objects.select_related('state__country')
        .values_list('state__country__name', 'state__name', 'name')
    )

    result = []
    for row in rows:
        pais   = (row.get('pais')   or '').strip()
        estado = (row.get('estado') or '').strip()
        cidade = (row.get('cidade') or '').strip()

        if not pais:
            result.append({**row, 'status': 'error', 'msg': 'País em branco'})
            continue

        if cidade:
            if not estado:
                result.append({**row, 'status': 'error', 'msg': 'Cidade sem estado'})
            elif (pais, estado, cidade) in existing_cities:
                result.append({**row, 'status': 'exists'})
            else:
                result.append({**row, 'status': 'new'})
        elif estado:
            if (pais, estado) in existing_states:
                result.append({**row, 'status': 'exists'})
            else:
                result.append({**row, 'status': 'new'})
        else:
            if pais in existing_countries:
                result.append({**row, 'status': 'exists'})
            else:
                result.append({**row, 'status': 'new'})

    return Response({'rows': result})


@api_view(['POST'])
@permission_classes([RequirePermission('manage_settings', 'settings_countries', 'settings_countries_edit')])
def geo_import_action(request):
    """
    Executa a importação com um modo específico.
    mode=merge   → adiciona novos, mantém existentes
    mode=replace → adiciona novos + apaga do banco o que NÃO está no CSV
    mode=delete  → apaga do banco tudo que está no CSV
    Input: { mode, rows: [{pais, estado, cidade}, ...] }
    """
    mode = request.data.get('mode', 'merge')
    rows = request.data.get('rows', [])

    counts  = {'countries': 0, 'states': 0, 'cities': 0}
    deleted = {'countries': 0, 'states': 0, 'cities': 0}

    country_cache = {}
    state_cache   = {}

    # Conjuntos das linhas do CSV (para mode=replace)
    csv_countries = set()
    csv_states    = set()
    csv_cities    = set()

    for row in rows:
        continente = (row.get('continente') or '').strip()
        pais   = (row.get('pais')   or '').strip()
        estado = (row.get('estado') or '').strip()
        cidade = (row.get('cidade') or '').strip()
        if not pais:
            continue

        csv_countries.add(pais)
        if estado:
            csv_states.add((pais, estado))
        if estado and cidade:
            csv_cities.add((pais, estado, cidade))

        if mode == 'delete':
            continue  # só mapeia, apaga depois

        # País
        if pais not in country_cache:
            continent_obj = _get_continent(continente)
            obj, created = ConfigCountry.objects.get_or_create(name=pais, defaults={'continent': continent_obj})
            if created:
                counts['countries'] += 1
            elif continent_obj and not obj.continent_id:
                obj.continent = continent_obj
                obj.save(update_fields=['continent'])
            country_cache[pais] = obj

        if not estado:
            continue

        country = country_cache[pais]
        state_key = (pais, estado)
        if state_key not in state_cache:
            obj, created = ConfigState.objects.get_or_create(country=country, name=estado)
            if created:
                counts['states'] += 1
            state_cache[state_key] = obj

        if not cidade:
            continue

        state = state_cache[state_key]
        _, created = ConfigCity.objects.get_or_create(state=state, name=cidade)
        if created:
            counts['cities'] += 1

    # ── Apagar ──────────────────────────────────────────
    if mode == 'delete':
        for (pais, estado, cidade) in csv_cities:
            try:
                country = ConfigCountry.objects.get(name=pais)
                state   = ConfigState.objects.get(country=country, name=estado)
                deleted['cities'] += ConfigCity.objects.filter(state=state, name=cidade).delete()[0]
            except Exception:
                pass
        for (pais, estado) in csv_states - {(p, s) for p, s, _ in csv_cities}:
            try:
                country = ConfigCountry.objects.get(name=pais)
                deleted['states'] += ConfigState.objects.filter(country=country, name=estado).delete()[0]
            except Exception:
                pass

    elif mode == 'replace':
        # Apaga cidades não presentes no CSV
        for city in ConfigCity.objects.select_related('state__country').all():
            key = (city.state.country.name, city.state.name, city.name)
            if key not in csv_cities:
                city.delete()
                deleted['cities'] += 1
        # Apaga estados não presentes no CSV
        for state in ConfigState.objects.select_related('country').all():
            key = (state.country.name, state.name)
            if key not in csv_states:
                state.delete()
                deleted['states'] += 1
        # Apaga países não presentes no CSV
        for country in ConfigCountry.objects.all():
            if country.name not in csv_countries:
                country.delete()
                deleted['countries'] += 1

    return Response({'created': counts, 'deleted': deleted})


@api_view(['GET'])
@permission_classes([RequirePermission('manage_settings', 'settings_csv_export', 'settings_countries_export')])
def geo_export(request):
    """
    Exporta todos os continentes, países, estados e cidades em um único CSV:
    continente,pais,estado,cidade
    """
    def rows():
        yield 'continente,pais,estado,cidade\n'
        for country in ConfigCountry.objects.select_related('continent').prefetch_related('states__cities').order_by('name'):
            continente = country.continent.name if country.continent_id else ''
            states = list(country.states.all())
            if not states:
                yield f'"{_esc(continente)}","{_esc(country.name)}",,\n'
                continue
            for state in states:
                cities = list(state.cities.all())
                if not cities:
                    yield f'"{_esc(continente)}","{_esc(country.name)}","{_esc(state.name)}",\n'
                    continue
                for city in cities:
                    yield f'"{_esc(continente)}","{_esc(country.name)}","{_esc(state.name)}","{_esc(city.name)}"\n'

    response = StreamingHttpResponse(rows(), content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = 'attachment; filename="paises_estados_cidades.csv"'
    return response


def _esc(s):
    return (s or '').replace('"', '""')


# Region (inglês, vem da API mledoze/countries) → nome do continente em português.
REGION_TO_CONTINENT = {
    'Africa': 'África', 'Americas': 'Américas', 'Asia': 'Ásia',
    'Europe': 'Europa', 'Oceania': 'Oceania', 'Antarctic': 'Antártida',
}


def _get_continent(name):
    name = (name or '').strip()
    if not name:
        return None
    obj, _ = ConfigContinent.objects.get_or_create(name=name)
    return obj


@api_view(['POST'])
@permission_classes([RequirePermission('manage_settings', 'settings_countries', 'settings_countries_edit')])
def geo_import(request):
    """
    Importa CSV com colunas: continente,pais,estado,cidade
    Cria continentes/países/estados/cidades que não existem ainda.
    """
    f = request.FILES.get('file')
    if not f:
        return Response({'error': 'Arquivo não enviado.'}, status=400)

    content   = f.read().decode('utf-8-sig')
    reader    = csv.DictReader(io.StringIO(content))

    # aceita variações de cabeçalho
    fieldnames = [n.lower().strip() for n in (reader.fieldnames or [])]
    col_continent = next((n for n in reader.fieldnames or [] if n.lower().strip() in ('continente', 'continent')), None)
    col_country = next((n for n in reader.fieldnames or [] if n.lower().strip() in ('pais', 'país', 'country')), None)
    col_state   = next((n for n in reader.fieldnames or [] if n.lower().strip() in ('estado', 'state')), None)
    col_city    = next((n for n in reader.fieldnames or [] if n.lower().strip() in ('cidade', 'city')), None)

    if not col_country:
        return Response({'error': 'Coluna "pais" não encontrada.'}, status=400)

    counts = {'countries': 0, 'states': 0, 'cities': 0, 'rows': 0}
    country_cache = {}
    state_cache   = {}

    for row in reader:
        counts['rows'] += 1
        ct_name = (row.get(col_continent) or '').strip() if col_continent else ''
        c_name = (row.get(col_country) or '').strip()
        s_name = (row.get(col_state)   or '').strip() if col_state else ''
        ci_name= (row.get(col_city)    or '').strip() if col_city  else ''

        if not c_name:
            continue

        # País
        if c_name not in country_cache:
            continent_obj = _get_continent(ct_name)
            obj, created = ConfigCountry.objects.get_or_create(name=c_name, defaults={'continent': continent_obj})
            if created:
                counts['countries'] += 1
            elif continent_obj and not obj.continent_id:
                obj.continent = continent_obj
                obj.save(update_fields=['continent'])
            country_cache[c_name] = obj
        country = country_cache[c_name]

        if not s_name:
            continue

        # Estado
        state_key = (c_name, s_name)
        if state_key not in state_cache:
            obj, created = ConfigState.objects.get_or_create(country=country, name=s_name)
            if created:
                counts['states'] += 1
            state_cache[state_key] = obj
        state = state_cache[state_key]

        if not ci_name:
            continue

        # Cidade
        _, created = ConfigCity.objects.get_or_create(state=state, name=ci_name)
        if created:
            counts['cities'] += 1

    return Response({
        'rows':      counts['rows'],
        'countries': counts['countries'],
        'states':    counts['states'],
        'cities':    counts['cities'],
    })


class ProfessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigProfession
        fields = ['id', 'name']

class LanguageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigLanguage
        fields = ['id', 'name']

class StateSerializer(serializers.ModelSerializer):
    city_count   = serializers.SerializerMethodField()
    country_name = serializers.CharField(source='country.name', read_only=True)
    class Meta:
        model  = ConfigState
        fields = ['id', 'name', 'code', 'city_count', 'country_name']
    def get_city_count(self, obj):
        return obj.cities.count()

class CountrySerializer(serializers.ModelSerializer):
    state_count    = serializers.SerializerMethodField()
    continent_name = serializers.CharField(source='continent.name', read_only=True, default=None)
    class Meta:
        model = ConfigCountry
        fields = ['id', 'name', 'code', 'continent', 'continent_name', 'state_count']
    def get_state_count(self, obj):
        return obj.states.count()


class ProfessionViewSet(viewsets.ModelViewSet):
    queryset = ConfigProfession.objects.all()
    serializer_class = ProfessionSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_professions', action_perms={'import_default': 'import_web'})

    @action(detail=False, methods=['post'], url_path='import')
    def import_default(self, request):
        URL_CSV  = 'https://raw.githubusercontent.com/okfn-brasil/datasets-br-cbo/master/data/lista_canonicos.csv'
        URL_JSON = 'https://raw.githubusercontent.com/lucassmacedo/cbo-brasil/master/json/CBO2002%20-%20Ocupacao.json'

        def task(progress):
            progress(0, 1)
            names = set()
            try:
                r = requests.get(URL_CSV, timeout=20)
                if r.ok:
                    for line in r.text.split('\n')[1:]:
                        line = line.strip()
                        if not line:
                            continue
                        comma = line.index(',') if ',' in line else -1
                        name = line[comma + 1:].replace('\r', '').strip()
                        if name:
                            names.add(name)
            except Exception:
                pass
            try:
                r = requests.get(URL_JSON, timeout=20)
                if r.ok:
                    for item in r.json():
                        if item.get('name'):
                            names.add(item['name'].strip())
            except Exception:
                pass
            if not names:
                raise RuntimeError('Não foi possível importar. Verifique sua conexão.')
            sorted_names = sorted(names)
            total = len(sorted_names)
            before = ConfigProfession.objects.count()
            CHUNK = 200
            for i in range(0, total, CHUNK):
                chunk = sorted_names[i:i + CHUNK]
                ConfigProfession.objects.bulk_create(
                    [ConfigProfession(name=n) for n in chunk], ignore_conflicts=True)
                progress(min(i + CHUNK, total), total)
            after = ConfigProfession.objects.count()
            return {'total': after, 'created': after - before}

        job_id = run_job('professions', 'Profissões', task)
        return Response({'job_id': job_id}, status=status.HTTP_202_ACCEPTED)


class LanguageViewSet(viewsets.ModelViewSet):
    queryset = ConfigLanguage.objects.all()
    serializer_class = LanguageSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_languages', action_perms={'import_default': 'import_web'})

    @action(detail=False, methods=['post'], url_path='import')
    def import_default(self, request):
        DEFAULT = [
            'Afrikaans','Albanês','Alemão','Amárico','Árabe','Aramaico','Armênio',
            'Azerbaijano','Basco','Bengalês','Bielorrusso','Birmanês','Bósnio',
            'Búlgaro','Catalão','Cazaque','Chinês (Cantonês)','Chinês (Mandarim)',
            'Cingalês','Coreano','Croata','Curdo','Dinamarquês','Eslovaco','Esloveno',
            'Espanhol','Estoniano','Filipino','Finlandês','Francês','Galego',
            'Georgiano','Grego','Gujarati','Hausa','Hebraico','Hindi','Holandês',
            'Húngaro','Igbo','Indonésio','Inglês','Islandês','Italiano','Japonês',
            'Javanês','Khmer','Laociano','Letão','Lituano','Macedônio','Malaio',
            'Malaiala','Maltês','Maori','Marata','Mongol','Nepalês','Norueguês',
            'Persa','Polonês','Português','Português (Portugal)','Romeno','Russo',
            'Sérvio','Somali','Sueco','Suaíli','Tagalo','Tailandês','Tâmil',
            'Tcheco','Télugu','Turco','Ucraniano','Urdu','Uzbeque','Vietnamita',
            'Xhosa','Iorubá','Zulu',
        ]
        def task(progress):
            created = 0
            total = len(DEFAULT)
            for i, n in enumerate(DEFAULT, 1):
                if ConfigLanguage.objects.get_or_create(name=n)[1]:
                    created += 1
                progress(i, total)
            return {'total': ConfigLanguage.objects.count(), 'created': created}

        job_id = run_job('languages', 'Idiomas', task)
        return Response({'job_id': job_id}, status=status.HTTP_202_ACCEPTED)


class CountryViewSet(viewsets.ModelViewSet):
    queryset = ConfigCountry.objects.all()
    serializer_class = CountrySerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_countries', action_perms={
        'import_default': 'import_web', 'import_cascade': 'import_web',
    })

    @action(detail=False, methods=['post'], url_path='import')
    def import_default(self, request):
        def task(progress):
            progress(0, 1)
            try:
                r = requests.get('https://raw.githubusercontent.com/mledoze/countries/master/dist/countries.json', timeout=20)
                if not r.ok:
                    raise RuntimeError('Falha ao buscar países.')
            except Exception:
                raise RuntimeError('Erro de conexão.')
            rows = r.json()
            if not isinstance(rows, list):
                raise RuntimeError('Resposta inesperada da API de países.')
            created = 0
            total = len(rows)
            for i, c in enumerate(rows, 1):
                if not isinstance(c, dict):
                    continue
                name = (c.get('translations') or {}).get('por', {}).get('common') or c.get('name', {}).get('common')
                if not name:
                    continue
                code = c.get('cca2', '')
                continent = _get_continent(REGION_TO_CONTINENT.get(c.get('region', '')))
                obj, was_created = ConfigCountry.objects.get_or_create(name=name, defaults={'code': code, 'continent': continent})
                if was_created:
                    created += 1
                elif continent and not obj.continent_id:
                    obj.continent = continent
                    obj.save(update_fields=['continent'])
                if i % 10 == 0 or i == total:
                    progress(i, total)
            return {'total': ConfigCountry.objects.count(), 'created': created}

        job_id = run_job('countries', 'Países', task)
        return Response({'job_id': job_id}, status=status.HTTP_202_ACCEPTED)

    @action(detail=False, methods=['post'], url_path='import-cascade')
    def import_cascade(self, request):
        """Importa todos os países e, para cada um, seus estados e as cidades de
        cada estado — tudo em sequência, em um único job de longa duração."""
        def fetch_states(country):
            try:
                if country.code == 'BR':
                    r = requests.get('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome', timeout=15)
                    return [{'name': s['nome'], 'code': s['sigla']} for s in r.json()] if r.ok else []
                r = requests.post('https://countriesnow.space/api/v0.1/countries/states',
                                   json={'country': country.name}, timeout=15)
                return [{'name': s['name'], 'code': s.get('state_code', '')} for s in r.json().get('data', {}).get('states', [])] if r.ok else []
            except Exception:
                return []

        def fetch_cities(state, country):
            try:
                if country.code == 'BR' and state.code:
                    r = requests.get(f'https://servicodados.ibge.gov.br/api/v1/localidades/estados/{state.code}/municipios', timeout=15)
                    return [m['nome'] for m in r.json()] if r.ok else []
                r = requests.post('https://countriesnow.space/api/v0.1/countries/state/cities',
                                   json={'country': country.name, 'state': state.name}, timeout=15)
                return list(r.json().get('data', [])) if r.ok else []
            except Exception:
                return []

        def task(progress):
            progress(0, 1)
            try:
                r = requests.get('https://raw.githubusercontent.com/mledoze/countries/master/dist/countries.json', timeout=20)
                rows = r.json() if r.ok else []
            except Exception:
                rows = []
            if not isinstance(rows, list) or not rows:
                # A API às vezes responde 200 com um JSON de erro (dict/string) em vez
                # de uma lista — sem essa checagem, "for c in rows" iterava os
                # caracteres da string e quebrava com 'str' object has no attribute 'get'.
                raise RuntimeError('Não foi possível buscar a lista de países (resposta inesperada da API).')
            for c in rows:
                if not isinstance(c, dict):
                    continue
                name = (c.get('translations') or {}).get('por', {}).get('common') or c.get('name', {}).get('common')
                if not name:
                    continue
                continent = _get_continent(REGION_TO_CONTINENT.get(c.get('region', '')))
                obj, was_created = ConfigCountry.objects.get_or_create(name=name, defaults={'code': c.get('cca2', ''), 'continent': continent})
                if not was_created and continent and not obj.continent_id:
                    obj.continent = continent
                    obj.save(update_fields=['continent'])

            countries = list(ConfigCountry.objects.all())
            total = len(countries)
            new_states = new_cities = 0
            failed = 0
            for ci, country in enumerate(countries, 1):
                try:
                    for s in fetch_states(country):
                        _, created = ConfigState.objects.get_or_create(
                            country=country, name=s['name'], defaults={'code': s['code']})
                        if created:
                            new_states += 1
                    for state in country.states.all():
                        names = fetch_cities(state, country)
                        if names:
                            before = state.cities.count()
                            ConfigCity.objects.bulk_create(
                                [ConfigCity(state=state, name=n) for n in names], ignore_conflicts=True)
                            new_cities += state.cities.count() - before
                except Exception:
                    # Um país com falha (ex: banco ocupado por outra importação em
                    # paralelo) não pode travar a importação inteira — segue para o
                    # próximo e reporta quantos falharam no resultado final.
                    failed += 1
                progress(ci, total)
            result = {'countries': ConfigCountry.objects.count(), 'new_states': new_states, 'new_cities': new_cities}
            if failed:
                result['failed_countries'] = failed
            return result

        job_id = run_job('countries_cascade', 'Países + Estados + Cidades (tudo)', task)
        return Response({'job_id': job_id}, status=status.HTTP_202_ACCEPTED)


# ── Tipos de Documento ────────────────────────────────────────────────────

class DocFieldOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomDocFieldOption
        fields = ['id', 'value', 'order']

class DocFieldSerializer(serializers.ModelSerializer):
    options = DocFieldOptionSerializer(many=True, read_only=True)
    class Meta:
        model = CustomDocField
        fields = ['id', 'key', 'label', 'field_type', 'subtype', 'required', 'order', 'options']

class DocTypeSerializer(serializers.ModelSerializer):
    fields = DocFieldSerializer(many=True, read_only=True)
    class Meta:
        model = CustomDocType
        fields = ['id', 'key', 'label', 'icon', 'color', 'order', 'is_active', 'fields']


class DocTypeViewSet(viewsets.ModelViewSet):
    queryset = CustomDocType.objects.prefetch_related('fields__options').all()
    serializer_class = DocTypeSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_doc_types', ['seed'])

    @action(detail=False, methods=['post'], url_path='seed')
    def seed(self, request):
        """Popula com os tipos de documento padrão do sistema."""
        DEFAULTS = [
            {'key':'passport',   'label':'Passaporte',                'icon':'🛂','color':'#2e6db4','order':1,
             'fields':[
               {'key':'doc_number','label':'Número do passaporte','field_type':'text','required':True,'order':1},
               {'key':'issued_date','label':'Data de emissão','field_type':'date','required':True,'order':2},
               {'key':'expiry_date','label':'Validade','field_type':'date','required':True,'order':3},
               {'key':'issued_by','label':'País emissor','field_type':'country','required':True,'order':4},
             ]},
            {'key':'rg',         'label':'Carteira de Identidade (RG)','icon':'🪪','color':'#7c3aed','order':2,
             'fields':[
               {'key':'doc_number','label':'Número do RG','field_type':'text','required':True,'order':1},
               {'key':'issued_date','label':'Data de expedição','field_type':'date','required':True,'order':2},
               {'key':'expiry_date','label':'Validade','field_type':'date','required':False,'order':3},
             ]},
            {'key':'cnh',        'label':'Carteira de Motorista (CNH)','icon':'🚗','color':'#059669','order':3,
             'fields':[
               {'key':'doc_number','label':'Número da CNH','field_type':'text','required':True,'order':1},
               {'key':'issued_date','label':'Data de emissão','field_type':'date','required':True,'order':2},
               {'key':'expiry_date','label':'Validade','field_type':'date','required':True,'order':3},
             ]},
            {'key':'visa',       'label':'Visto',                     'icon':'✈️','color':'#0891b2','order':4,
             'fields':[
               {'key':'doc_number','label':'Número do visto','field_type':'text','required':True,'order':1},
               {'key':'issued_date','label':'Data de emissão','field_type':'date','required':True,'order':2},
               {'key':'expiry_date','label':'Validade','field_type':'date','required':True,'order':3},
               {'key':'issued_by','label':'País emissor','field_type':'country','required':True,'order':4},
             ]},
            {'key':'birth_cert', 'label':'Certidão de Nascimento',    'icon':'📄','color':'#b45309','order':5,
             'fields':[
               {'key':'doc_number','label':'Número do documento','field_type':'text','required':True,'order':1},
               {'key':'issued_date','label':'Data de emissão','field_type':'date','required':True,'order':2},
               {'key':'issued_by','label':'Cartório / Órgão','field_type':'text','required':True,'order':3},
             ]},
            {'key':'residence',  'label':'Comprovante de Residência', 'icon':'🏠','color':'#92400e','order':6,
             'fields':[
               {'key':'issued_date','label':'Data do comprovante','field_type':'date','required':True,'order':1},
               {'key':'issued_by','label':'Emissor','field_type':'text','required':True,'order':2},
             ]},
            {'key':'vaccine',    'label':'Vacina',                    'icon':'💉','color':'#0f766e','order':7,
             'fields':[
               {'key':'doc_number','label':'Nome da vacina','field_type':'text','required':True,'order':1},
               {'key':'issued_date','label':'Data da vacinação','field_type':'date','required':False,'order':2},
               {'key':'expiry_date','label':'Data de validade','field_type':'date','required':False,'order':3},
             ]},
            {'key':'prof_card',  'label':'Carteira Profissional',     'icon':'🪪','color':'#7c3aed','order':8,
             'fields':[
               {'key':'doc_number',  'label':'Nome da carteira','field_type':'prof_card','required':True, 'order':1},
               {'key':'issued_by',   'label':'Número / Registro','field_type':'text',    'required':True, 'order':2},
               {'key':'issued_date', 'label':'Data de emissão',  'field_type':'date',    'required':False,'order':3},
               {'key':'expiry_date', 'label':'Data de validade', 'field_type':'date',    'required':False,'order':4},
             ]},
            {'key':'other',      'label':'Outro documento',           'icon':'📎','color':'#475569','order':99,
             'fields':[
               {'key':'doc_number','label':'Número do documento','field_type':'text','required':False,'order':1},
               {'key':'issued_date','label':'Data de emissão','field_type':'date','required':False,'order':2},
               {'key':'expiry_date','label':'Validade','field_type':'date','required':False,'order':3},
             ]},
        ]
        created_types = 0
        for dt in DEFAULTS:
            fields_data = dt.pop('fields', [])
            obj, created = CustomDocType.objects.get_or_create(key=dt['key'], defaults=dt)
            if created:
                created_types += 1
            for fd in fields_data:
                CustomDocField.objects.get_or_create(doc_type=obj, key=fd['key'], defaults=fd)
        return Response({'created_types': created_types, 'total': CustomDocType.objects.count()})


class DocFieldViewSet(viewsets.ModelViewSet):
    serializer_class = DocFieldSerializer
    pagination_class = None

    def get_queryset(self):
        doc_type_id = self.request.query_params.get('doc_type_id')
        qs = CustomDocField.objects.prefetch_related('options').all()
        if doc_type_id:
            qs = qs.filter(doc_type_id=doc_type_id)
        return qs

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('manage_settings', 'settings_doc_types', 'settings_doc_types_delete')()]
        return [RequirePermission('manage_settings', 'settings_doc_types', 'settings_doc_types_edit')()]

    def perform_create(self, serializer):
        doc_type = get_object_or_404(CustomDocType, pk=self.request.data.get('doc_type_id'))
        serializer.save(doc_type=doc_type)


class DocFieldOptionViewSet(viewsets.ModelViewSet):
    serializer_class = DocFieldOptionSerializer
    pagination_class = None

    def get_queryset(self):
        field_id = self.request.query_params.get('field_id')
        qs = CustomDocFieldOption.objects.all()
        if field_id:
            qs = qs.filter(field_id=field_id)
        return qs

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('manage_settings', 'settings_doc_types', 'settings_doc_types_delete')()]
        return [RequirePermission('manage_settings', 'settings_doc_types', 'settings_doc_types_edit')()]

    def perform_create(self, serializer):
        field = get_object_or_404(CustomDocField, pk=self.request.data.get('field_id'))
        serializer.save(field=field)


class ProfCardSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigProfCard
        fields = ['id', 'name']


class ProfCardViewSet(viewsets.ModelViewSet):
    queryset = ConfigProfCard.objects.all()
    serializer_class = ProfCardSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_prof_cards', action_perms={'import_default': 'import_web'})

    @action(detail=False, methods=['post'], url_path='import')
    def import_default(self, request):
        DEFAULT = [
            'CAU — Conselho de Arquitetura e Urbanismo',
            'CFM — Conselho Federal de Medicina',
            'CFO — Conselho Federal de Odontologia',
            'CFP — Conselho Federal de Psicologia',
            'COFECI — Conselho Federal de Corretores de Imóveis',
            'CONFEF — Conselho Federal de Educação Física',
            'COREN — Conselho Regional de Enfermagem',
            'CRBIO — Conselho Regional de Biologia',
            'CRBM — Conselho Regional de Biomedicina',
            'CRC — Conselho Regional de Contabilidade',
            'CRECI — Conselho Regional de Corretores de Imóveis',
            'CREF — Conselho Regional de Educação Física',
            'CREFITO — Conselho Regional de Fisioterapia e Terapia Ocupacional',
            'CREFONO — Conselho Regional de Fonoaudiologia',
            'CREA — Conselho Regional de Engenharia e Agronomia',
            'CRF — Conselho Regional de Farmácia',
            'CRM — Conselho Regional de Medicina',
            'CRN — Conselho Regional de Nutricionistas',
            'CRO — Conselho Regional de Odontologia',
            'CRP — Conselho Regional de Psicologia',
            'CTPS — Carteira de Trabalho e Previdência Social',
            'OAB — Ordem dos Advogados do Brasil',
            'Registro de Classe (geral)',
        ]
        def task(progress):
            created = 0
            total = len(DEFAULT)
            for i, n in enumerate(DEFAULT, 1):
                if ConfigProfCard.objects.get_or_create(name=n)[1]:
                    created += 1
                progress(i, total)
            return {'total': ConfigProfCard.objects.count(), 'created': created}

        job_id = run_job('prof_cards', 'Carteiras', task)
        return Response({'job_id': job_id}, status=status.HTTP_202_ACCEPTED)


class GenderSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigGender
        fields = ['id', 'name']


class GenderViewSet(viewsets.ModelViewSet):
    queryset = ConfigGender.objects.all()
    serializer_class = GenderSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_genders')


class ItineraryCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigItineraryCategory
        fields = ['id', 'name']


class ItineraryCategoryViewSet(viewsets.ModelViewSet):
    queryset = ConfigItineraryCategory.objects.all()
    serializer_class = ItineraryCategorySerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_itinerary_categories')


class ContinentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigContinent
        fields = ['id', 'name']


class ContinentViewSet(viewsets.ModelViewSet):
    """Continentes são gerenciados dentro de Países & Estados — usa a mesma
    permissão de Países (settings_countries), sem permissão própria."""
    queryset = ConfigContinent.objects.all()
    serializer_class = ContinentSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_countries')


class DestinationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigDestination
        fields = ['id', 'name']


class DestinationViewSet(viewsets.ModelViewSet):
    queryset = ConfigDestination.objects.all()
    serializer_class = DestinationSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_destinations')


class HolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigHoliday
        fields = ['id', 'name']


class HolidayViewSet(viewsets.ModelViewSet):
    queryset = ConfigHoliday.objects.all()
    serializer_class = HolidaySerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_holidays')


class ServiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigService
        fields = ['id', 'name']


class ServiceViewSet(viewsets.ModelViewSet):
    queryset = ConfigService.objects.all()
    serializer_class = ServiceSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_services')


class ItineraryTemplateSerializer(serializers.ModelSerializer):
    kind_display = serializers.CharField(source='get_kind_display', read_only=True)

    class Meta:
        model = ConfigItineraryTemplate
        fields = ['id', 'kind', 'kind_display', 'name', 'content']

    def validate_content(self, value):
        from core.sanitize import sanitize_html
        return sanitize_html(value)


class ItineraryTemplateViewSet(viewsets.ModelViewSet):
    serializer_class = ItineraryTemplateSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_itinerary_templates')

    def get_queryset(self):
        qs = ConfigItineraryTemplate.objects.all()
        kind = self.request.query_params.get('kind')
        if kind:
            qs = qs.filter(kind=kind)
        return qs


class PaymentMethodSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigPaymentMethod
        fields = ['id', 'name']


class PaymentMethodViewSet(viewsets.ModelViewSet):
    queryset = ConfigPaymentMethod.objects.all()
    serializer_class = PaymentMethodSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_payment_methods')


class PaymentPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigPaymentPlan
        fields = ['id', 'name', 'a_vista', 'has_down_payment', 'down_payment_mode', 'down_payment_value',
                  'down_payment_method', 'down_payment_rounding', 'installments_count', 'payment_method',
                  'installment_rounding', 'first_due_days', 'interval_days']


class PaymentPlanViewSet(viewsets.ModelViewSet):
    queryset = ConfigPaymentPlan.objects.all()
    serializer_class = PaymentPlanSerializer
    pagination_class = None
    # Mesma área/permissão das formas de pagamento (settings_payment_methods_*).
    get_permissions = _settings_perm('settings_payment_methods')


class ExchangeRateSerializer(serializers.ModelSerializer):
    base_rate = serializers.DecimalField(max_digits=12, decimal_places=4, required=False, allow_null=True)

    class Meta:
        model = ConfigExchangeRate
        fields = ['id', 'from_currency', 'to_currency', 'base_rate', 'markup_percent',
                  'markup_percent_installment', 'rate', 'rate_installment',
                  'auto_update', 'is_favorite', 'source_url', 'script', 'update_time',
                  'last_auto_update', 'rounding_decimals', 'rounding_mode',
                  'rate_updated_at', 'updated_at']
        read_only_fields = ['rate', 'rate_installment', 'last_auto_update', 'rate_updated_at', 'updated_at']

    def validate(self, attrs):
        # Enforce server-side as permissões granulares do câmbio — não basta o
        # frontend desabilitar os campos. Quem não tem a permissão tem os campos
        # correspondentes descartados do payload, preservando o valor já salvo.
        from users_api.permissions import has_any_perm
        req = self.context.get('request')
        user = getattr(req, 'user', None)
        is_su = bool(user and user.is_superuser)
        has_advanced = is_su or bool(user and has_any_perm(
            user, 'manage_settings', 'settings_exchange_rates_advanced'))
        has_rounding = is_su or bool(user and has_any_perm(
            user, 'manage_settings', 'settings_exchange_rates_rounding'))

        # Script (execução de código no servidor) é exclusivo de superusuário.
        if 'script' in attrs and not is_su:
            attrs.pop('script')
        # Opções avançadas: auto-atualização e fonte externa (link/script/horário).
        if not has_advanced:
            for f in ('auto_update', 'source_url', 'script', 'update_time'):
                attrs.pop(f, None)
        # Arredondamento da taxa final.
        if not has_rounding:
            attrs.pop('rounding_decimals', None)
            attrs.pop('rounding_mode', None)
        return attrs

    def to_representation(self, instance):
        # A leitura da lista de câmbio é liberada para qualquer autenticado (a taxa
        # é usada em vários lugares), mas `script` (código Python do servidor) e
        # `source_url` (endpoints internos) não devem vazar para quem não administra
        # o câmbio. `script` só para superusuário; `source_url` só para quem tem
        # acesso de câmbio (view/edit) ou manage_settings.
        from users_api.permissions import has_any_perm
        data = super().to_representation(instance)
        req = self.context.get('request')
        user = getattr(req, 'user', None)
        if not (user and user.is_superuser):
            data.pop('script', None)
        if not (user and has_any_perm(user, 'manage_settings',
                                      'settings_exchange_rates_view', 'settings_exchange_rates_edit')):
            data.pop('source_url', None)
        return data

    def to_internal_value(self, data):
        # Compatibilidade: payloads que mandam só `rate` (importação/antigos) usam
        # esse valor como taxa de mercado (base_rate); a taxa efetiva é recalculada.
        if hasattr(data, 'get') and (data.get('base_rate') in (None, '')) and (data.get('rate') not in (None, '')):
            try:
                data = dict(data)
                data['base_rate'] = data['rate']
            except Exception:
                pass
        return super().to_internal_value(data)


class ExchangeRateViewSet(viewsets.ModelViewSet):
    queryset = ConfigExchangeRate.objects.all()
    serializer_class = ExchangeRateSerializer
    pagination_class = None
    # 'pull_internet' e 'default_time' (horário geral) fazem parte das opções
    # avançadas → exigem settings_exchange_rates_advanced, não o _edit básico.
    get_permissions = _settings_perm(
        'settings_exchange_rates',
        extra_write=['test_script'],
        action_perms={'pull_internet': 'advanced', 'default_time': 'advanced', 'run_now': 'update_now', 'update_one': 'update_now'},
    )

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get('favorites') in ('1', 'true', 'True'):
            qs = qs.filter(is_favorite=True)
        return qs.order_by('-is_favorite', 'from_currency', 'to_currency')

    @action(detail=False, methods=['post'], url_path='pull-internet')
    def pull_internet(self, request):
        """Puxa as taxas de TODAS as moedas → BRL da internet, criando/atualizando
        os câmbios. Mantém o acréscimo (%) já configurado em cada um."""
        from .exchange_service import pull_all_from_internet
        try:
            created, updated = pull_all_from_internet()
        except Exception as e:
            return Response({'error': f'Não foi possível puxar da internet: {e}'},
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response({'created': created, 'updated': updated})

    @action(detail=False, methods=['post'], url_path='run-now')
    def run_now(self, request):
        """Força a atualização automática AGORA — atualiza todas as moedas com
        auto-atualização ligada (script/link/API), sem esperar o horário.

        Script customizado = execução de código no servidor (privilégio sensível):
        só superusuário dispara scripts. Um não-superusuário atualiza apenas as
        moedas de fonte simples (link/API); as com script são puladas."""
        from .exchange_service import update_due
        try:
            n = update_due(force=True, include_scripts=request.user.is_superuser)
        except Exception as e:
            return Response({'error': f'Não foi possível atualizar agora: {e}'},
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response({'updated': n})

    @action(detail=True, methods=['post'], url_path='update-now')
    def update_one(self, request, pk=None):
        """Atualiza UMA moeda agora, pela fonte configurada nela (script, link
        próprio ou API global). Não mexe no acréscimo definido pelo usuário."""
        row = self.get_object()
        from .exchange_service import _rates_for, _apply_rates, fetch_brl_rates, _has_script
        # Script customizado roda código no servidor — só superusuário dispara.
        if _has_script(row) and not request.user.is_superuser:
            return Response({'error': 'Apenas superusuário pode atualizar uma moeda com script customizado.'},
                            status=status.HTTP_403_FORBIDDEN)
        try:
            need_global = not (row.script or '').strip() and not row.source_url
            global_rates = fetch_brl_rates() if need_global else {}
            data = _rates_for(row, global_rates)
            if not data:
                return Response({'error': 'Não foi possível obter a taxa desta moeda agora.'},
                                status=status.HTTP_502_BAD_GATEWAY)
            _apply_rates(row, data)
            row.save(update_fields=['base_rate', 'rate', 'rate_installment', 'updated_at'])
        except Exception as e:
            return Response({'error': f'Não foi possível atualizar: {e}'},
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response(self.get_serializer(row).data)

    @action(detail=False, methods=['post'], url_path='test-script')
    def test_script(self, request):
        """Roda o script no sandbox e devolve a taxa calculada (ou o erro). Só
        superusuário — é execução de código no servidor."""
        if not request.user.is_superuser:
            return Response({'error': 'Apenas superusuário pode testar scripts.'}, status=403)
        from .exchange_runner import run_script
        ok, data, out = run_script(request.data.get('script') or '')
        if ok:
            market = data.get('market'); a = data.get('a_vista'); p = data.get('parcelado')
            primary = market if market is not None else a
            resp = {'rate': str(primary) if primary is not None else None, 'output': out}
            if market is not None:
                resp['rate_market'] = str(market)
            if a is not None:
                resp['rate_a_vista'] = str(a)
            if p is not None:
                resp['rate_parcelado'] = str(p)
            return Response(resp)
        return Response({'error': data, 'output': out})

    @action(detail=False, methods=['get', 'post'], url_path='default-time')
    def default_time(self, request):
        """Horário GERAL de atualização — usado pelas moedas sem horário próprio."""
        from .models import ConfigExchangeSettings
        obj = ConfigExchangeSettings.get()
        if request.method == 'POST':
            t = request.data.get('default_update_time')
            obj.default_update_time = t or None
            obj.save(update_fields=['default_update_time', 'updated_at'])
        return Response({'default_update_time': obj.default_update_time})


class ListCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigListCategory
        fields = ['id', 'name']


class ListCategoryViewSet(viewsets.ModelViewSet):
    queryset = ConfigListCategory.objects.all()
    serializer_class = ListCategorySerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_list_categories')


class VaccineSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigVaccine
        fields = ['id', 'name']


class VaccineViewSet(viewsets.ModelViewSet):
    queryset = ConfigVaccine.objects.all()
    serializer_class = VaccineSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_vaccines', action_perms={'import_default': 'import_web'})

    @action(detail=False, methods=['post'], url_path='import')
    def import_default(self, request):
        DEFAULT = [
            # Vacinas do calendário básico
            'BCG (Tuberculose)',
            'DTP (Difteria, Tétano e Coqueluche)',
            'dT (Dupla Adulto — Difteria e Tétano)',
            'dTpa (Tríplice Bacteriana Adulto)',
            'Hib (Haemophilus influenzae tipo b)',
            'Poliomielite (VIP/VOP)',
            'Rotavírus',
            'Pneumocócica 10-valente (PCV10)',
            'Pneumocócica 13-valente (PCV13)',
            'Pneumocócica 23-valente (PPSV23)',
            'Meningocócica C',
            'Meningocócica ACWY',
            'Meningocócica B',
            'Tríplice Viral (Sarampo, Caxumba e Rubéola)',
            'Varicela (Catapora)',
            'Hepatite A',
            'Hepatite B',
            'Hepatite A+B (Twinrix)',
            'HPV Bivalente (Cervarix)',
            'HPV Quadrivalente (Gardasil)',
            'HPV Nonavalente (Gardasil 9)',
            'Influenza (Gripe)',
            'Herpes Zóster (Zostavax)',
            'Herpes Zóster Recombinante (Shingrix)',
            # Vacinas de viagem / tropicais
            'Febre Amarela',
            'Febre Tifoide (oral Ty21a)',
            'Febre Tifoide (injetável Vi)',
            'Cólera / Diarreia do Viajante (Dukoral)',
            'Raiva (pré-exposição)',
            'Encefalite Japonesa (Ixiaro)',
            'Encefalite por Carrapato (FSME-Immun / Ticovac)',
            'Dengue (Dengvaxia)',
            'Dengue (Qdenga)',
            # COVID-19
            'COVID-19 Pfizer-BioNTech (Comirnaty)',
            'COVID-19 Moderna (Spikevax)',
            'COVID-19 AstraZeneca (Vaxzevria)',
            'COVID-19 Janssen (Ad26.COV2.S)',
            'COVID-19 Coronavac (Sinovac)',
            'COVID-19 Covaxin (Bharat Biotech)',
            'COVID-19 Novavax (Nuvaxovid)',
            # Outras
            'Antimeningocócica Polissacarídica',
            'Anti-rábica (pós-exposição)',
            'Varicela-Zóster Imunoglobulina',
            'Imunoglobulina Hepatite A',
            'Imunoglobulina Hepatite B',
        ]
        def task(progress):
            created = 0
            total = len(DEFAULT)
            for i, n in enumerate(DEFAULT, 1):
                if ConfigVaccine.objects.get_or_create(name=n)[1]:
                    created += 1
                progress(i, total)
            return {'total': ConfigVaccine.objects.count(), 'created': created}

        job_id = run_job('vaccines', 'Vacinas', task)
        return Response({'job_id': job_id}, status=status.HTTP_202_ACCEPTED)


class CitySerializer(serializers.ModelSerializer):
    state_name   = serializers.CharField(source='state.name', read_only=True, default=None)
    country_name = serializers.CharField(source='state.country.name', read_only=True, default=None)

    class Meta:
        model = ConfigCity
        fields = ['id', 'name', 'state_name', 'country_name']


class CityViewSet(viewsets.ModelViewSet):
    serializer_class = CitySerializer
    pagination_class = None

    def get_queryset(self):
        state_id = self.request.query_params.get('state_id')
        q = self.request.query_params.get('q')
        if state_id:
            return ConfigCity.objects.filter(state_id=state_id).select_related('state__country')
        if q:
            return ConfigCity.objects.filter(name__icontains=q).select_related('state__country')[:50]
        return ConfigCity.objects.none()

    get_permissions = _settings_perm('settings_countries', action_perms={'import_for_state': 'import_web'})

    def perform_create(self, serializer):
        state = get_object_or_404(ConfigState, pk=self.request.data.get('state_id'))
        serializer.save(state=state)

    @action(detail=False, methods=['post'], url_path='import')
    def import_for_state(self, request):
        state_id = request.data.get('state_id')
        try:
            state = ConfigState.objects.select_related('country').get(pk=state_id)
        except ConfigState.DoesNotExist:
            return Response({'error': 'Estado não encontrado.'}, status=404)

        def task(progress):
            progress(0, 1)
            try:
                if state.country.code == 'BR' and state.code:
                    r = requests.get(
                        f'https://servicodados.ibge.gov.br/api/v1/localidades/estados/{state.code}/municipios',
                        timeout=15)
                    names = [m['nome'] for m in r.json()] if r.ok else []
                else:
                    r = requests.post('https://countriesnow.space/api/v0.1/countries/state/cities',
                                       json={'country': state.country.name, 'state': state.name}, timeout=15)
                    names = list(r.json().get('data', [])) if r.ok else []
            except Exception:
                raise RuntimeError('Erro ao importar cidades.')
            total = len(names)
            before = state.cities.count()
            CHUNK = 200
            for i in range(0, total, CHUNK):
                chunk = names[i:i + CHUNK]
                ConfigCity.objects.bulk_create(
                    [ConfigCity(state=state, name=n) for n in chunk], ignore_conflicts=True)
                progress(min(i + CHUNK, total), total)
            after = state.cities.count()
            return {'total': after, 'created': after - before}

        job_id = run_job('cities', f'Cidades — {state.name}', task)
        return Response({'job_id': job_id}, status=status.HTTP_202_ACCEPTED)


class StateViewSet(viewsets.ModelViewSet):
    serializer_class = StateSerializer
    pagination_class = None

    def get_queryset(self):
        country_id = self.request.query_params.get('country_id')
        if country_id:
            return ConfigState.objects.filter(country_id=country_id).select_related('country')
        if self.request.query_params.get('all'):
            return ConfigState.objects.all().select_related('country').order_by('country__name', 'name')
        return ConfigState.objects.none()

    get_permissions = _settings_perm('settings_countries', action_perms={'import_for_country': 'import_web'})

    def perform_create(self, serializer):
        country = get_object_or_404(ConfigCountry, pk=self.request.data.get('country_id'))
        serializer.save(country=country)

    @action(detail=False, methods=['post'], url_path='import')
    def import_for_country(self, request):
        country_id = request.data.get('country_id')
        try:
            country = ConfigCountry.objects.get(pk=country_id)
        except ConfigCountry.DoesNotExist:
            return Response({'error': 'País não encontrado.'}, status=404)

        def task(progress):
            progress(0, 1)
            try:
                if country.code == 'BR':
                    r = requests.get('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome', timeout=15)
                    rows = [{'name': s['nome'], 'code': s['sigla']} for s in r.json()] if r.ok else []
                else:
                    r = requests.post('https://countriesnow.space/api/v0.1/countries/states', json={'country': country.name}, timeout=15)
                    rows = [{'name': s['name'], 'code': s.get('state_code', '')} for s in r.json().get('data', {}).get('states', [])] if r.ok else []
            except Exception:
                raise RuntimeError('Erro ao importar estados.')
            created = 0
            total = len(rows)
            for i, s in enumerate(rows, 1):
                _, ok = ConfigState.objects.get_or_create(country=country, name=s['name'], defaults={'code': s['code']})
                if ok:
                    created += 1
                progress(i, total)
            return {'total': country.states.count(), 'created': created}

        job_id = run_job('states', f'Estados — {country.name}', task)
        return Response({'job_id': job_id}, status=status.HTTP_202_ACCEPTED)


# ── Tipos de Acomodação ────────────────────────────────────────────────────

class AccommodationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigAccommodation
        fields = ['id', 'name', 'capacity', 'is_couple']


class AccommodationViewSet(viewsets.ModelViewSet):
    queryset         = ConfigAccommodation.objects.all()
    serializer_class = AccommodationSerializer
    get_permissions  = _settings_perm('settings_accommodations')


# ── Cláusulas de contrato ───────────────────────────────────────────────────

class ContractClauseSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ContractClause
        fields = ['id', 'name', 'content', 'is_default', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']

    def validate_content(self, value):
        from core.sanitize import sanitize_html
        return sanitize_html(value)


class ContractClauseViewSet(viewsets.ModelViewSet):
    queryset         = ContractClause.objects.all()
    serializer_class = ContractClauseSerializer
    pagination_class = None
    get_permissions  = _settings_perm('settings_contract_clauses')

    def get_queryset(self):
        qs = ContractClause.objects.all()
        q = self.request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(Q(name__icontains=q))
        return qs


# ── Aeroportos ────────────────────────────────────────────────────────────

class AirportSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Airport
        fields = ['id', 'name', 'iata_code', 'city', 'country', 'is_favorite']


class ConfigListPagination(PageNumberPagination):
    """Paginação para cadastros grandes (aeroportos, companhias aéreas, etc.).

    page_size_query_param permite que ações administrativas (export CSV,
    checagem de duplicidade na importação) peçam o conjunto completo via
    ?page_size=<alto>, sem afetar o carregamento normal da tela (rápido,
    50 itens por vez).
    """
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 10000


class AirportViewSet(viewsets.ModelViewSet):
    queryset         = Airport.objects.all()
    serializer_class = AirportSerializer
    pagination_class = ConfigListPagination
    get_permissions  = _settings_perm('settings_airports', action_perms={'seed': 'import_web'})

    def get_queryset(self):
        qs = Airport.objects.all()
        q = self.request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(
                Q(name__icontains=q) | Q(iata_code__icontains=q) | Q(city__icontains=q)
            )
        if self.request.query_params.get('favorites') in ('1', 'true', 'True'):
            qs = qs.filter(is_favorite=True)
        return qs.order_by('-is_favorite', 'name')

    @action(detail=False, methods=['get'], url_path='country-suggestions')
    def country_suggestions(self, request):
        """Países distintos com aeroportos cadastrados, filtrados por ?q=."""
        q = request.query_params.get('q', '').strip()
        qs = Airport.objects.exclude(country='')
        if q:
            qs = qs.filter(country__icontains=q)
        names = list(qs.values_list('country', flat=True).distinct().order_by('country')[:60])
        return Response(names)

    @action(detail=False, methods=['get'], url_path='city-suggestions')
    def city_suggestions(self, request):
        """Cidades distintas para um país, filtradas por ?q=. Requer ?country=."""
        country = request.query_params.get('country', '').strip()
        q       = request.query_params.get('q', '').strip()
        qs = Airport.objects.exclude(city='')
        if country:
            qs = qs.filter(country__iexact=country)
        if q:
            qs = qs.filter(city__icontains=q)
        cities = list(qs.values_list('city', flat=True).distinct().order_by('city')[:60])
        return Response(cities)

    @action(detail=False, methods=['post'])
    def seed(self, request):
        """Importa aeroportos mundiais do OurAirports em background, com progresso."""
        from config_api.management.commands.seed_airports import Command as SeedAirportsCommand

        def task(progress):
            created = SeedAirportsCommand().handle(clear=False, large_only=False, progress_callback=progress)
            return {'created': created}

        job_id = run_job('airports', 'Aeroportos (base mundial)', task)
        return Response({'job_id': job_id}, status=status.HTTP_202_ACCEPTED)


# ── Companhias Aéreas ────────────────────────────────────────────────────────

class AirlineSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Airline
        fields = ['id', 'name', 'iata_code', 'country', 'is_favorite']


class AirlineViewSet(viewsets.ModelViewSet):
    queryset         = Airline.objects.all()
    serializer_class = AirlineSerializer
    pagination_class = ConfigListPagination
    get_permissions  = _settings_perm('settings_airlines', action_perms={'seed': 'import_web'})

    def get_queryset(self):
        qs = Airline.objects.all()
        q = self.request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(iata_code__icontains=q))
        if self.request.query_params.get('favorites') in ('1', 'true', 'True'):
            qs = qs.filter(is_favorite=True)
        return qs.order_by('-is_favorite', 'name')

    @action(detail=False, methods=['post'])
    def seed(self, request):
        """Importa companhias aéreas em background via OpenFlights, com progresso."""
        from config_api.management.commands.seed_airlines import Command as SeedAirlinesCommand

        def task(progress):
            created = SeedAirlinesCommand().handle(clear=False, progress_callback=progress)
            return {'created': created}

        job_id = run_job('airlines', 'Companhias Aéreas (base mundial)', task)
        return Response({'job_id': job_id}, status=status.HTTP_202_ACCEPTED)


# ── Mapas de Ônibus ────────────────────────────────────────────────────────

class BusMapRowSerializer(serializers.ModelSerializer):
    class Meta:
        model  = BusMapRow
        fields = ['id', 'deck', 'order', 'left_seats', 'right_seats', 'left_labels', 'right_labels']


class BusMapSerializer(serializers.ModelSerializer):
    rows = BusMapRowSerializer(many=True, required=False)

    class Meta:
        model  = BusMap
        fields = ['id', 'key', 'label', 'order', 'is_active', 'deck_count', 'rows']

    def _save_rows(self, bus_map, rows_data):
        bus_map.rows.all().delete()
        BusMapRow.objects.bulk_create([
            BusMapRow(bus_map=bus_map, order=i, deck=row.get('deck', 1),
                      left_seats=row.get('left_seats', 0), right_seats=row.get('right_seats', 0),
                      left_labels=row.get('left_labels', []), right_labels=row.get('right_labels', []))
            for i, row in enumerate(rows_data)
        ])

    def create(self, validated_data):
        rows_data = validated_data.pop('rows', [])
        bus_map = BusMap.objects.create(**validated_data)
        if rows_data:
            self._save_rows(bus_map, rows_data)
        return bus_map

    def update(self, instance, validated_data):
        rows_data = validated_data.pop('rows', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if rows_data is not None:
            self._save_rows(instance, rows_data)
        return instance


class BusMapViewSet(viewsets.ModelViewSet):
    queryset         = BusMap.objects.prefetch_related('rows').all()
    serializer_class = BusMapSerializer
    pagination_class = None
    get_permissions  = _settings_perm('settings_bus_maps')


# ── Configurações globais do sistema ─────────────────────────────────────────

class SystemSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SystemSettings
        fields = ['deadline_notification_emails']

class _IsStaffOrSuper(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and (u.is_staff or u.is_superuser))

@api_view(['GET', 'PATCH'])
@permission_classes([_IsStaffOrSuper])
def system_settings(request):
    obj = SystemSettings.get()
    if request.method == 'PATCH':
        ser = SystemSettingsSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
    return Response(SystemSettingsSerializer(obj).data)


# ── Dados da operadora (UneWorld) — pré-preenche contratos ──────────────────

class OperatingCompanySerializer(serializers.ModelSerializer):
    class Meta:
        model  = OperatingCompany
        fields = ['company_name', 'cnpj', 'seller', 'phone', 'mobile', 'email', 'address',
                  'pix_key_type', 'pix_key',
                  'default_signature_type',
                  'ceo_name', 'ceo_email', 'ceo_autentique_token', 'ceo_auto_sign',
                  'updated_at']


CEO_SENSITIVE_FIELDS = ['ceo_name', 'ceo_email', 'ceo_autentique_token', 'ceo_auto_sign']


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def operating_company(request):
    from users_api.permissions import has_any_perm
    can_settings = has_any_perm(request.user, 'manage_settings', 'settings_operating_company_view',
                                'settings_operating_company_edit')
    # Quem cria/vê contratos também precisa dos dados da operadora (cabeçalho do
    # contrato, PIX, forma de assinatura padrão) — mas NÃO dos campos sensíveis do
    # CEO (token Autentique). Sem isso, o form de contrato quebra para usuários de
    # agência, que podem criar contrato mas não têm acesso às Configurações.
    can_contract = has_any_perm(request.user, 'contracts_view', 'contracts_edit')
    if not (can_settings or can_contract):
        return Response(status=403)
    obj = OperatingCompany.get()
    if request.method == 'PATCH':
        if not has_any_perm(request.user, 'manage_settings', 'settings_operating_company_edit'):
            return Response({'error': 'Você não tem permissão para executar esta ação.'}, status=403)
        ser = OperatingCompanySerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
    data = OperatingCompanySerializer(obj).data
    if not can_settings:
        for k in CEO_SENSITIVE_FIELDS:
            data.pop(k, None)
    return Response(data)


# ── Termos e condições ───────────────────────────────────────────────────────

class TermsAndConditionsSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TermsAndConditions
        fields = ['content', 'updated_at']
        read_only_fields = ['updated_at']

    def validate_content(self, value):
        from core.sanitize import sanitize_html
        return sanitize_html(value)


@api_view(['GET', 'PATCH'])
@permission_classes([AllowAny])
def terms_and_conditions(request):
    """GET é público (precisa ser lido antes/sem login, ex: tela de convite).
    PATCH exige permissão de edição dos termos."""
    obj = TermsAndConditions.get()
    if request.method == 'PATCH':
        from users_api.permissions import has_any_perm
        if not has_any_perm(request.user, 'manage_settings', 'settings_terms_edit'):
            return Response({'error': 'Você não tem permissão para executar esta ação.'}, status=403)
        ser = TermsAndConditionsSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
    return Response(TermsAndConditionsSerializer(obj).data)


# ── Perfis de permissão ───────────────────────────────────────────────────────

class PermissionProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PermissionProfile
        fields = ['id', 'name', 'permissions', 'is_agency_default', 'created_at', 'updated_at', 'is_deleted', 'deleted_at']


class PermissionProfileViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset         = PermissionProfile.objects.all()
    serializer_class = PermissionProfileSerializer
    pagination_class = None

    def perform_create(self, serializer):
        obj = serializer.save()
        self._ensure_single_agency_default(obj)

    def perform_update(self, serializer):
        obj = serializer.save()
        self._ensure_single_agency_default(obj)
        self._reapply_to_linked_users(obj)

    def _ensure_single_agency_default(self, obj):
        # Só UM perfil pode ser o padrão de agência — ao marcar um, desmarca os demais.
        if obj.is_agency_default:
            PermissionProfile.objects.exclude(pk=obj.pk).filter(is_agency_default=True).update(is_agency_default=False)

    def _reapply_to_linked_users(self, profile):
        # Link VIVO: ao editar o perfil, re-aplica as permissões a todos os usuários
        # vinculados a ele (inclui os usuários de agência ligados ao perfil padrão).
        from users_api.permissions import apply_profile
        for perms in profile.linked_permissions.select_related('user').all():
            apply_profile(perms.user, profile)

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [IsAuthenticated()]
        if self.action == 'destroy':
            return [RequirePermission('manage_settings', 'settings_user_profiles', 'settings_user_profiles_delete')()]
        return [RequirePermission('manage_settings', 'settings_user_profiles', 'settings_user_profiles_edit')()]

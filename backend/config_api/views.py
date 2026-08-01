import csv
import io
import re
import requests
from django.db import transaction
from django.db.models import Q, Count
from django.http import StreamingHttpResponse, HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes, parser_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny
from rest_framework.response import Response
from rest_framework import serializers
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from .models import (ConfigProfession, ConfigSpecialNeed, ConfigLanguage, ConfigCountry, ConfigState,
                     ConfigCity, ConfigVaccine, ConfigGender, ConfigProfCard,
                     CustomDocType, CustomDocField, CustomDocFieldOption,
                     ConfigAccommodation, ConfigShipCabin, ConfigListCategory, Airport, Airline,
                     BusMap, BusMapRow, SystemSettings, PermissionProfile, ContractClause, TermsAndConditions,
                     OperatingCompany, ConfigPaymentMethod, ConfigPaymentPlan, ConfigExchangeRate,
                     ConfigItineraryCategory, ConfigContinent,
                     ConfigItineraryType, ConfigMaritimeCompany, ConfigCurrency, ConfigKeyword, ConfigCostCategory,
                     ConfigFlightSegment, ConfigFlightClass,
                     ConfigInclusion, ConfigHighlight, ConfigSpecialDate,
                     ConfigHotel, ConfigHotelCategory, ConfigHotelMedia, ConfigBoat, ConfigBoatMedia,
                     ConfigTerrestreCompany, DocumentTemplateConfig, ConfigJobRole, ReservationSettings)
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


def _bulk_delete_ids(model, ids, chunk=1000):
    """Apaga por id em lotes (evita IN gigante) e soma só os do próprio model
    (ignora contagem de cascatas, que já são tratadas na ordem de exclusão)."""
    total = 0
    label = model._meta.label
    for i in range(0, len(ids), chunk):
        _, per_model = model.objects.filter(pk__in=ids[i:i + chunk]).delete()
        total += per_model.get(label, 0)
    return total


def _bulk_upsert_geo(rows, mode='merge'):
    """Importa continentes→países→estados→cidades em POUCOS queries.

    Substitui o get_or_create linha-a-linha (2 queries/linha) por bulk_create/
    bulk_update em lote dentro de UMA transação — não trava o event-loop do Daphne.

    rows: iterável de dicts com chaves continente/pais/estado/cidade.
    mode: 'merge'   → adiciona os que faltam, mantém os existentes
          'replace' → adiciona os que faltam + apaga do banco o que NÃO está no CSV
          'delete'  → apaga do banco o que está no CSV
    Retorna (counts, deleted). ATENÇÃO: bulk_create pula o save(), então name_ascii
    da cidade é computado aqui à mão.
    """
    from .textsearch import normalize_text

    counts  = {'countries': 0, 'states': 0, 'cities': 0, 'rows': 0}
    deleted = {'countries': 0, 'states': 0, 'cities': 0}

    csv_countries = set()          # {pais}
    csv_states    = set()          # {(pais, estado)}
    csv_cities    = set()          # {(pais, estado, cidade)}
    country_continent = {}         # pais -> primeiro continente não-vazio visto

    for row in rows:
        counts['rows'] += 1
        continente = (row.get('continente') or '').strip()
        pais   = (row.get('pais')   or '').strip()
        estado = (row.get('estado') or '').strip()
        cidade = (row.get('cidade') or '').strip()
        if not pais:
            continue
        csv_countries.add(pais)
        if continente and pais not in country_continent:
            country_continent[pais] = continente
        if estado:
            csv_states.add((pais, estado))
        if estado and cidade:
            csv_cities.add((pais, estado, cidade))

    with transaction.atomic():
        if mode == 'delete':
            _geo_delete_from_csv(csv_states, csv_cities, deleted)
            return counts, deleted

        # ── Continentes ─────────────────────────────────────────
        continent_names = {c for c in country_continent.values() if c}
        continent_map = {c.name: c for c in ConfigContinent.objects.filter(name__in=continent_names)}
        missing = continent_names - set(continent_map)
        if missing:
            ConfigContinent.objects.bulk_create([ConfigContinent(name=n) for n in missing])
            continent_map = {c.name: c for c in ConfigContinent.objects.filter(name__in=continent_names)}

        # ── Países (name é unique) ──────────────────────────────
        country_map = {c.name: c for c in ConfigCountry.objects.filter(name__in=csv_countries)}
        missing_countries = csv_countries - set(country_map)
        if missing_countries:
            ConfigCountry.objects.bulk_create([
                ConfigCountry(name=name, continent=continent_map.get(country_continent.get(name, '')))
                for name in missing_countries
            ])
            counts['countries'] = len(missing_countries)
            for c in ConfigCountry.objects.filter(name__in=missing_countries):
                country_map[c.name] = c
        # Preenche continente em países que já existiam mas estavam sem
        to_update = []
        for name, obj in country_map.items():
            cont = continent_map.get(country_continent.get(name, ''))
            if cont and not obj.continent_id:
                obj.continent = cont
                to_update.append(obj)
        if to_update:
            ConfigCountry.objects.bulk_update(to_update, ['continent'])

        # ── Estados (unique_together country+name) ──────────────
        country_ids = {country_map[p].id for (p, _s) in csv_states if p in country_map}
        existing_states = {(st.country_id, st.name)
                           for st in ConfigState.objects.filter(country_id__in=country_ids)}
        to_create, seen = [], set()
        for (pais, estado) in csv_states:
            country = country_map.get(pais)
            if not country:
                continue
            key = (country.id, estado)
            if key in existing_states or key in seen:
                continue
            seen.add(key)
            to_create.append(ConfigState(country=country, name=estado))
        if to_create:
            ConfigState.objects.bulk_create(to_create)
            counts['states'] = len(to_create)
        state_map = {(st.country_id, st.name): st
                     for st in ConfigState.objects.filter(country_id__in=country_ids)}

        # ── Cidades (unique_together state+name; name_ascii à mão) ──
        state_ids = set()
        for (pais, estado, _c) in csv_cities:
            country = country_map.get(pais)
            st = state_map.get((country.id, estado)) if country else None
            if st:
                state_ids.add(st.id)
        existing_cities = set(
            ConfigCity.objects.filter(state_id__in=state_ids).values_list('state_id', 'name'))
        to_create, seen = [], set()
        for (pais, estado, cidade) in csv_cities:
            country = country_map.get(pais)
            st = state_map.get((country.id, estado)) if country else None
            if not st:
                continue
            key = (st.id, cidade)
            if key in existing_cities or key in seen:
                continue
            seen.add(key)
            to_create.append(ConfigCity(state=st, name=cidade, name_ascii=normalize_text(cidade)))
        if to_create:
            ConfigCity.objects.bulk_create(to_create)
            counts['cities'] = len(to_create)

        if mode == 'replace':
            _geo_prune_replace(csv_countries, csv_states, csv_cities, deleted)

    return counts, deleted


def _geo_delete_from_csv(csv_states, csv_cities, deleted):
    """mode=delete: apaga do banco só o que está no CSV (cidades e estados sem cidade)."""
    city_ids = list(
        ConfigCity.objects
        .filter(state__country__name__in={p for p, _s, _c in csv_cities})
        .values_list('id', 'state__country__name', 'state__name', 'name'))
    del_ids = [cid for (cid, cn, sn, ciname) in city_ids if (cn, sn, ciname) in csv_cities]
    deleted['cities'] += _bulk_delete_ids(ConfigCity, del_ids)

    only_states = csv_states - {(p, s) for p, s, _ in csv_cities}
    st_rows = ConfigState.objects.filter(
        country__name__in={p for p, _s in only_states}).values_list('id', 'country__name', 'name')
    del_st = [sid for (sid, cn, sn) in st_rows if (cn, sn) in only_states]
    deleted['states'] += _bulk_delete_ids(ConfigState, del_st)


def _geo_prune_replace(csv_countries, csv_states, csv_cities, deleted):
    """mode=replace: apaga o que NÃO está no CSV, em lote (cidades → estados → países).
    A ordem garante que cascatas não recontem (uma cidade fora do CSV já foi apagada
    antes do estado/país que a continha)."""
    del_city = [cid for (cid, cn, sn, ciname) in
                ConfigCity.objects.values_list('id', 'state__country__name', 'state__name', 'name')
                if (cn, sn, ciname) not in csv_cities]
    deleted['cities'] += _bulk_delete_ids(ConfigCity, del_city)

    del_state = [sid for (sid, cn, sn) in
                 ConfigState.objects.values_list('id', 'country__name', 'name')
                 if (cn, sn) not in csv_states]
    deleted['states'] += _bulk_delete_ids(ConfigState, del_state)

    del_country = [cid for (cid, name) in ConfigCountry.objects.values_list('id', 'name')
                   if name not in csv_countries]
    deleted['countries'] += _bulk_delete_ids(ConfigCountry, del_country)


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
    counts, deleted = _bulk_upsert_geo(rows, mode=mode)
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

    # Normaliza para as chaves do helper (continente/pais/estado/cidade) e delega
    # ao bulk-upsert em lote — nada de get_or_create por linha (travava o Daphne).
    rows = ({
        'continente': (row.get(col_continent) or '') if col_continent else '',
        'pais':       (row.get(col_country)   or ''),
        'estado':     (row.get(col_state)     or '') if col_state else '',
        'cidade':     (row.get(col_city)      or '') if col_city  else '',
    } for row in reader)
    counts, _deleted = _bulk_upsert_geo(rows, mode='merge')

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
        c = getattr(obj, 'city_count_a', None)   # annotate no viewset evita N+1
        return c if c is not None else obj.cities.count()

class CountrySerializer(serializers.ModelSerializer):
    state_count    = serializers.SerializerMethodField()
    continent_name = serializers.CharField(source='continent.name', read_only=True, default=None)
    class Meta:
        model = ConfigCountry
        fields = ['id', 'name', 'code', 'continent', 'continent_name', 'state_count']
    def get_state_count(self, obj):
        c = getattr(obj, 'state_count_a', None)   # annotate no viewset evita N+1
        return c if c is not None else obj.states.count()


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
    queryset = ConfigCountry.objects.annotate(state_count_a=Count('states'))
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
                            from .textsearch import normalize_text
                            ConfigCity.objects.bulk_create(
                                [ConfigCity(state=state, name=n, name_ascii=normalize_text(n)) for n in names], ignore_conflicts=True)
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


class SpecialNeedSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigSpecialNeed
        fields = ['id', 'name']


class SpecialNeedViewSet(viewsets.ModelViewSet):
    queryset = ConfigSpecialNeed.objects.all()
    serializer_class = SpecialNeedSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_special_needs')


class ItineraryCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigItineraryCategory
        fields = ['id', 'name']


class ItineraryCategoryViewSet(viewsets.ModelViewSet):
    queryset = ConfigItineraryCategory.objects.all()
    serializer_class = ItineraryCategorySerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_itinerary_categories')


# ── Listas do Roteiro: Tipos de Roteiro, Companhias Marítimas, Moedas ──

class ItineraryTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigItineraryType
        fields = ['id', 'name']


class ItineraryTypeViewSet(viewsets.ModelViewSet):
    queryset = ConfigItineraryType.objects.all()
    serializer_class = ItineraryTypeSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_itinerary_types')


class MaritimeCompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigMaritimeCompany
        fields = ['id', 'name', 'website']


class MaritimeCompanyViewSet(viewsets.ModelViewSet):
    queryset = ConfigMaritimeCompany.objects.all()
    serializer_class = MaritimeCompanySerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_maritime_companies')


class CurrencySerializer(serializers.ModelSerializer):
    # Declarado explícito para NÃO herdar o RegexValidator do model (que roda antes
    # de validate_code e barraria minúsculas) — aqui normalizo p/ maiúsculas primeiro.
    code = serializers.CharField(max_length=3)

    class Meta:
        model = ConfigCurrency
        fields = ['id', 'code', 'name', 'symbol']

    def validate_code(self, v):
        v = (v or '').strip().upper()
        if len(v) != 3 or not v.isalpha():
            raise serializers.ValidationError('Use o código ISO-4217 com 3 letras (ex.: USD).')
        qs = ConfigCurrency.objects.filter(code=v)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Já existe uma moeda com este código.')
        return v


class CurrencyViewSet(viewsets.ModelViewSet):
    queryset = ConfigCurrency.objects.all()
    serializer_class = CurrencySerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_currencies')


class KeywordSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigKeyword
        fields = ['id', 'name']


class KeywordViewSet(viewsets.ModelViewSet):
    serializer_class = KeywordSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_keywords')

    def get_queryset(self):
        qs = ConfigKeyword.objects.all()
        q = self.request.query_params.get('q', '').strip()
        return qs.filter(name__icontains=q) if q else qs


class CostCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigCostCategory
        fields = ['id', 'name']


class JobRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigJobRole
        fields = ['id', 'name']


class JobRoleViewSet(viewsets.ModelViewSet):
    """Cargos (CEO, Gerência, Vendas…) escolhidos no perfil do usuário."""
    serializer_class = JobRoleSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_job_roles')

    def get_queryset(self):
        qs = ConfigJobRole.objects.all()
        q = self.request.query_params.get('q', '').strip()
        return qs.filter(name__icontains=q) if q else qs


class CostCategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CostCategorySerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_cost_categories')

    def get_queryset(self):
        qs = ConfigCostCategory.objects.all()
        q = self.request.query_params.get('q', '').strip()
        return qs.filter(name__icontains=q) if q else qs


class FlightSegmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigFlightSegment
        fields = ['id', 'name']


class FlightSegmentViewSet(viewsets.ModelViewSet):
    serializer_class = FlightSegmentSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_flight_segments')

    def get_queryset(self):
        qs = ConfigFlightSegment.objects.all()
        q = self.request.query_params.get('q', '').strip()
        return qs.filter(name__icontains=q) if q else qs


class FlightClassSerializer(serializers.ModelSerializer):
    name = serializers.CharField(max_length=80)   # sem UniqueValidator herdado

    class Meta:
        model = ConfigFlightClass
        fields = ['id', 'name', 'itinerary']
        validators = []   # unicidade por escopo (itinerary, name) — ver abaixo

    def validate(self, attrs):
        name = attrs.get('name', getattr(self.instance, 'name', None))
        itin = attrs.get('itinerary', getattr(self.instance, 'itinerary', None))
        qs = ConfigFlightClass.objects.filter(name=name, itinerary=itin)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError({'name': 'Já existe uma classe com esse nome aqui.'})
        return attrs


# Tipos personalizados por roteiro (acomodação/cabine/classe) são API imediata:
# mexer num que pertence a um roteiro publicado acende "Público · pendente".
def _touch_itin_unpublished(itinerary):
    if itinerary and itinerary.is_published and not itinerary.has_unpublished_changes:
        itinerary.has_unpublished_changes = True
        itinerary.save(update_fields=['has_unpublished_changes'])


class _ScopedTypeMixin:
    """perform_create/update/destroy que acendem 'pendente' no roteiro do tipo."""
    def perform_create(self, serializer):
        obj = serializer.save()
        _touch_itin_unpublished(getattr(obj, 'itinerary', None))

    def perform_update(self, serializer):
        obj = serializer.save()
        _touch_itin_unpublished(getattr(obj, 'itinerary', None))

    def perform_destroy(self, instance):
        it = getattr(instance, 'itinerary', None)
        instance.delete()
        _touch_itin_unpublished(it)


class FlightClassViewSet(_ScopedTypeMixin, viewsets.ModelViewSet):
    serializer_class = FlightClassSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_flight_classes')

    def get_queryset(self):
        qs = ConfigFlightClass.objects.all()
        q = self.request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(name__icontains=q)
        return _scoped_config_qs(qs, self)


class InclusionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigInclusion
        fields = ['id', 'name']


class InclusionViewSet(viewsets.ModelViewSet):
    serializer_class = InclusionSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_inclusions')

    def get_queryset(self):
        qs = ConfigInclusion.objects.all()
        q = self.request.query_params.get('q', '').strip()
        return qs.filter(name__icontains=q) if q else qs


class HighlightSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigHighlight
        fields = ['id', 'name']


class HighlightViewSet(viewsets.ModelViewSet):
    serializer_class = HighlightSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_highlights')

    def get_queryset(self):
        qs = ConfigHighlight.objects.all()
        q = self.request.query_params.get('q', '').strip()
        return qs.filter(name__icontains=q) if q else qs


class SpecialDateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigSpecialDate
        fields = ['id', 'name']


class SpecialDateViewSet(viewsets.ModelViewSet):
    serializer_class = SpecialDateSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_special_dates')

    def get_queryset(self):
        qs = ConfigSpecialDate.objects.all()
        q = self.request.query_params.get('q', '').strip()
        return qs.filter(name__icontains=q) if q else qs


class HotelCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigHotelCategory
        fields = ['id', 'name']


class HotelCategoryViewSet(viewsets.ModelViewSet):
    """Categorias de hotel — geridas no próprio pop-up de hotéis."""
    serializer_class = HotelCategorySerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_hotels')

    def get_queryset(self):
        qs = ConfigHotelCategory.objects.all()
        q = self.request.query_params.get('q', '').strip()
        return qs.filter(name__icontains=q) if q else qs


class HotelCitySerializer(serializers.ModelSerializer):
    """Cidade enxuta para exibir junto do hotel (nome, estado, país)."""
    state_name   = serializers.CharField(source='state.name', read_only=True, default=None)
    country_name = serializers.CharField(source='state.country.name', read_only=True, default=None)

    class Meta:
        model = ConfigCity
        fields = ['id', 'name', 'state_name', 'country_name']


class HotelMediaSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = ConfigHotelMedia
        fields = ['id', 'hotel', 'file', 'url', 'kind', 'order']
        extra_kwargs = {'file': {'write_only': True}}
        read_only_fields = ['kind']

    def get_url(self, obj):
        try:
            return obj.file.url
        except ValueError:
            return None


class HotelSerializer(serializers.ModelSerializer):
    city_data       = HotelCitySerializer(source='city', read_only=True)
    categories_data = HotelCategorySerializer(source='categories', many=True, read_only=True)
    media           = HotelMediaSerializer(many=True, read_only=True)

    class Meta:
        model = ConfigHotel
        fields = ['id', 'name', 'city', 'city_data',
                  'categories', 'categories_data',
                  'website', 'phone', 'description', 'is_global', 'media']


class HotelViewSet(viewsets.ModelViewSet):
    """Catálogo global de hotéis (Configurações)."""
    serializer_class = HotelSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_hotels')

    def get_queryset(self):
        qs = (ConfigHotel.objects
              .select_related('city__state__country')
              .prefetch_related('categories', 'media'))
        if self.action != 'list':
            return qs
        qs = qs.filter(is_global=True)   # catálogo/busca: só hotéis globais
        q = self.request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(name__icontains=q)
        cities = self.request.query_params.get('cities', '').strip()
        if cities:
            ids = [int(c) for c in cities.split(',') if c.strip().isdigit()]
            if ids:
                qs = qs.filter(city_id__in=ids)
        return qs

    def perform_update(self, serializer):
        """Ao salvar o hotel no catálogo, reaplica nome/cidade/telefone aos
        hotéis de roteiro vinculados (vínculo vivo ligado)."""
        hotel = serializer.save()
        c = hotel.city
        label = ', '.join([p for p in [c.name if c else None,
                                       c.state.name if c and c.state else None,
                                       c.state.country.name if c and c.state and c.state.country else None] if p])
        from itineraries.models import ItineraryHotel
        from audit.tracking import log_field_propagation
        new_vals = {'name': hotel.name, 'city': label, 'phone': hotel.phone, 'website': hotel.website}
        linked = list(ItineraryHotel.objects.filter(config_hotel=hotel, config_hotel_linked=True))
        ItineraryHotel.objects.filter(pk__in=[h.pk for h in linked]).update(**new_vals)
        # O update em massa burla o signal — loga a propagação do vínculo vivo linha a
        # linha (aparece no log de cada roteiro afetado, com o diff dos campos).
        log_field_propagation(linked, new_vals, model_name='ItineraryHotel', model_label='Hotel do roteiro')


class HotelMediaViewSet(viewsets.ModelViewSet):
    """Imagens/vídeos de um hotel (upload multipart)."""
    serializer_class = HotelMediaSerializer
    pagination_class = None
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    get_permissions = _settings_perm('settings_hotels', extra_write=['reorder', 'restore'])

    def get_queryset(self):
        qs = ConfigHotelMedia.objects.all()
        hotel = self.request.query_params.get('hotel')
        if hotel:
            qs = qs.filter(hotel_id=hotel)
        # Na LISTAGEM, esconde as excluídas (soft-delete); detail/restore acessa todas.
        if self.action == 'list':
            qs = qs.filter(is_deleted=False)
        return qs

    # Soft-delete: excluir só marca (o arquivo/registro ficam) — assim o roteiro
    # pode RESTAURAR pelo id ao reverter, e o diff limpa de verdade.
    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if not obj.is_deleted:
            obj.is_deleted = True
            obj.save(update_fields=['is_deleted'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        """Restaura uma mídia excluída (soft-delete) — mantém o mesmo id."""
        obj = self.get_object()
        if obj.is_deleted:
            obj.is_deleted = False
            obj.save(update_fields=['is_deleted'])
        return Response(HotelMediaSerializer(obj, context=self.get_serializer_context()).data)

    def perform_create(self, serializer):
        from passengers.validators import validate_media_file
        from django.core.exceptions import ValidationError as DjangoValidationError
        from rest_framework.exceptions import ValidationError as DRFValidationError
        f = self.request.FILES.get('file')
        if not f:
            raise DRFValidationError({'file': ['Envie um arquivo de imagem ou vídeo.']})
        try:
            kind_str = validate_media_file(f)   # valida e define o tipo pela extensão real
        except DjangoValidationError as e:
            raise DRFValidationError({'file': e.messages})
        kind = ConfigHotelMedia.VIDEO if kind_str == 'video' else ConfigHotelMedia.IMAGE
        serializer.save(kind=kind)

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        from audit.tracking import log_event
        ids = request.data.get('ids', [])
        for i, mid in enumerate(ids):
            ConfigHotelMedia.objects.filter(id=mid).update(order=i)
        hotel_id = ConfigHotelMedia.objects.filter(id__in=ids).values_list('hotel_id', flat=True).first() if ids else None
        if hotel_id:
            log_event('update', model_name='ConfigHotel', model_label='Hotel (catálogo)',
                      object_id=hotel_id, object_repr=f'Hotel #{hotel_id}',
                      changes={'Mídias': {'antes': '—', 'depois': 'reordenadas'}})
        return Response({'ok': True})


class BoatMediaSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = ConfigBoatMedia
        fields = ['id', 'boat', 'file', 'url', 'kind', 'order']
        extra_kwargs = {'file': {'write_only': True}}
        read_only_fields = ['kind']

    def get_url(self, obj):
        try:
            return obj.file.url
        except ValueError:
            return None


class BoatSerializer(serializers.ModelSerializer):
    media = BoatMediaSerializer(many=True, read_only=True)

    class Meta:
        model = ConfigBoat
        fields = ['id', 'name', 'website', 'description', 'is_global', 'media']


class BoatViewSet(viewsets.ModelViewSet):
    """Catálogo de barcos (Configurações)."""
    serializer_class = BoatSerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_boats')

    def get_queryset(self):
        qs = ConfigBoat.objects.prefetch_related('media')
        if self.action != 'list':
            return qs
        qs = qs.filter(is_global=True)   # catálogo/busca: só barcos globais
        q = self.request.query_params.get('q', '').strip()
        return qs.filter(name__icontains=q) if q else qs

    def perform_update(self, serializer):
        """Ao salvar o barco no catálogo, reaplica o nome aos barcos de roteiro
        vinculados (vínculo vivo ligado)."""
        boat = serializer.save()
        from itineraries.models import ItineraryBoat
        from audit.tracking import log_field_propagation
        new_vals = {'name': boat.name, 'website': boat.website}
        linked = list(ItineraryBoat.objects.filter(config_boat=boat, config_boat_linked=True))
        ItineraryBoat.objects.filter(pk__in=[b.pk for b in linked]).update(**new_vals)
        log_field_propagation(linked, new_vals, model_name='ItineraryBoat', model_label='Barco do roteiro')


class BoatMediaViewSet(viewsets.ModelViewSet):
    """Imagens/vídeos de um barco (upload multipart)."""
    serializer_class = BoatMediaSerializer
    pagination_class = None
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    get_permissions = _settings_perm('settings_boats', extra_write=['reorder', 'restore'])

    def get_queryset(self):
        qs = ConfigBoatMedia.objects.all()
        boat = self.request.query_params.get('boat')
        if boat:
            qs = qs.filter(boat_id=boat)
        # Na LISTAGEM, esconde as excluídas (soft-delete); detail/restore acessa todas.
        if self.action == 'list':
            qs = qs.filter(is_deleted=False)
        return qs

    # Soft-delete: excluir só marca — assim o roteiro pode RESTAURAR pelo id ao reverter.
    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if not obj.is_deleted:
            obj.is_deleted = True
            obj.save(update_fields=['is_deleted'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        """Restaura uma mídia excluída (soft-delete) — mantém o mesmo id."""
        obj = self.get_object()
        if obj.is_deleted:
            obj.is_deleted = False
            obj.save(update_fields=['is_deleted'])
        return Response(BoatMediaSerializer(obj, context=self.get_serializer_context()).data)

    def perform_create(self, serializer):
        from passengers.validators import validate_media_file
        from django.core.exceptions import ValidationError as DjangoValidationError
        from rest_framework.exceptions import ValidationError as DRFValidationError
        f = self.request.FILES.get('file')
        if not f:
            raise DRFValidationError({'file': ['Envie um arquivo de imagem ou vídeo.']})
        try:
            kind_str = validate_media_file(f)   # valida e define o tipo pela extensão real
        except DjangoValidationError as e:
            raise DRFValidationError({'file': e.messages})
        kind = ConfigBoatMedia.VIDEO if kind_str == 'video' else ConfigBoatMedia.IMAGE
        serializer.save(kind=kind)

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        from audit.tracking import log_event
        ids = request.data.get('ids', [])
        for i, mid in enumerate(ids):
            ConfigBoatMedia.objects.filter(id=mid).update(order=i)
        boat_id = ConfigBoatMedia.objects.filter(id__in=ids).values_list('boat_id', flat=True).first() if ids else None
        if boat_id:
            log_event('update', model_name='ConfigBoat', model_label='Navio (catálogo)',
                      object_id=boat_id, object_repr=f'Navio #{boat_id}',
                      changes={'Mídias': {'antes': '—', 'depois': 'reordenadas'}})
        return Response({'ok': True})


class TerrestreCompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigTerrestreCompany
        fields = ['id', 'name', 'is_favorite']


class TerrestreCompanyViewSet(viewsets.ModelViewSet):
    """Empresas terrestres (Configurações) — usadas nos trechos da aba Terrestre."""
    serializer_class = TerrestreCompanySerializer
    pagination_class = None
    get_permissions = _settings_perm('settings_terrestre_companies')

    def get_queryset(self):
        qs = ConfigTerrestreCompany.objects.all()
        if self.action != 'list':
            return qs
        q = self.request.query_params.get('q', '').strip()
        return qs.filter(name__icontains=q) if q else qs


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
        fields = ['id', 'name', 'a_vista', 'a_vista_discount_mode', 'a_vista_discount_value',
                  'has_down_payment', 'down_payment_mode', 'down_payment_value',
                  'down_payment_method', 'down_payment_rounding', 'installments_count', 'payment_method',
                  'installment_rounding', 'interest_tiers', 'first_due_days', 'interval_days', 'is_favorite']

    def validate_interest_tiers(self, v):
        """Higieniza as faixas de juros por nº de parcelas: {from:int, to:int|None, rate:0..1000}.
        `from` = mín. de parcelas; `to` = máx. (None/'' = sem limite); fora das faixas = sem juros."""
        if not isinstance(v, list):
            return []

        def _int_or_none(x):
            if x in (None, '', 'null'):
                return None
            try:
                return max(0, int(x))
            except (TypeError, ValueError):
                return None

        out = []
        for t in v[:20]:
            if not isinstance(t, dict):
                continue
            frm = _int_or_none(t.get('from'))
            to = _int_or_none(t.get('to'))
            try:
                rate = max(0.0, min(float(t.get('rate') or 0), 1000.0))
            except (TypeError, ValueError):
                rate = 0.0
            out.append({'from': frm if frm is not None else 0, 'to': to, 'rate': round(rate, 4)})
        return out


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
                  'rate_updated_at', 'rate_checked_at', 'updated_at']
        read_only_fields = ['rate', 'rate_installment', 'last_auto_update', 'rate_updated_at', 'rate_checked_at', 'updated_at']

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
            # Script customizado só executa para superusuário (execução de código).
            created, updated = pull_all_from_internet(include_scripts=request.user.is_superuser)
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

    @action(detail=True, methods=['get'], url_path='history')
    def history(self, request, pk=None):
        """Histórico da taxa desta moeda (1 ponto/dia, ~10 anos) para o gráfico.
        Cada ponto: d (data YYYY-MM-DD), r (taxa efetiva), t (ISO da captura).
        Não entra na listagem para não pesar; é buscado só ao abrir o gráfico."""
        row = self.get_object()
        return Response({
            'from_currency': row.from_currency,
            'to_currency': row.to_currency,
            'history': row.rate_history or [],
        })

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
            row.save(update_fields=['base_rate', 'rate', 'rate_installment', 'rate_checked_at', 'updated_at'])
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
            if t:
                # Valida o horário (HH:MM[:SS]) — um valor arbitrário estouraria no
                # save() do TimeField (ValueError) → 500. Rejeita com 400.
                from django.utils.dateparse import parse_time
                parsed = parse_time(t) if isinstance(t, str) else None
                if parsed is None:
                    return Response({'error': 'Horário inválido (use HH:MM).'}, status=400)
                obj.default_update_time = parsed
            else:
                obj.default_update_time = None
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
    state_name     = serializers.CharField(source='state.name', read_only=True, default=None)
    country_name   = serializers.CharField(source='state.country.name', read_only=True, default=None)
    continent_name = serializers.CharField(source='state.country.continent.name', read_only=True, default=None)
    country        = serializers.IntegerField(source='state.country_id', read_only=True)
    continent      = serializers.IntegerField(source='state.country.continent_id', read_only=True)

    class Meta:
        model = ConfigCity
        fields = ['id', 'name', 'state_name', 'country_name', 'continent_name', 'country', 'continent']


class CityViewSet(viewsets.ModelViewSet):
    serializer_class = CitySerializer
    pagination_class = None

    def get_queryset(self):
        from django.db.models import Case, When, Value, IntegerField
        from .textsearch import normalize_text
        state_id = self.request.query_params.get('state_id')
        # `prefer`/`country_ids`: países a PRIORIZAR no ranking (não filtram — cidades
        # deles aparecem primeiro, mas outras cidades continuam pesquisáveis). Sem
        # busca, mostramos só as cidades dos países preferidos (contexto do roteiro).
        prefer = self.request.query_params.get('prefer') or self.request.query_params.get('country_ids')
        q = self.request.query_params.get('q')
        base = ConfigCity.objects.select_related('state__country', 'state__country__continent')
        if state_id:
            return base.filter(state_id=state_id)
        prefer_ids = [int(x) for x in (prefer or '').split(',') if x.strip().isdigit()]

        if q:
            from django.db.models import Q
            nq = normalize_text(q)
            # casa pelo nome normalizado OU por apelido PT (ex.: 'cidade do méxico').
            qs = base.filter(Q(name_ascii__icontains=nq) | Q(aliases__icontains=nq))
            order = []
            if prefer_ids:   # cidades dos países selecionados vêm primeiro
                qs = qs.annotate(_pref=Case(
                    When(state__country_id__in=prefer_ids, then=Value(0)),
                    default=Value(1), output_field=IntegerField()))
                order.append('_pref')
            # cidade famosa reconhecida pelo apelido PT (ex.: 'roma'→Roma/Itália)
            # aparece antes de homônimas; depois quem COMEÇA com o termo; depois nome.
            qs = qs.annotate(
                _alias=Case(When(aliases__icontains=nq, then=Value(0)),
                            default=Value(1), output_field=IntegerField()),
                _rank=Case(When(name_ascii__startswith=nq, then=Value(0)),
                           default=Value(1), output_field=IntegerField()))
            order += ['_alias', '_rank', 'name']
            return qs.order_by(*order)[:200]

        # Sem busca: se há países preferidos, mostra as cidades deles; senão amostra.
        if prefer_ids:
            return base.filter(state__country_id__in=prefer_ids).order_by('name')[:200]
        return base.order_by('name')[:200]

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
                from .textsearch import normalize_text
                ConfigCity.objects.bulk_create(
                    [ConfigCity(state=state, name=n, name_ascii=normalize_text(n)) for n in chunk], ignore_conflicts=True)
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
            return (ConfigState.objects.filter(country_id=country_id)
                    .select_related('country').annotate(city_count_a=Count('cities')))
        if self.request.query_params.get('all'):
            return (ConfigState.objects.all().select_related('country')
                    .annotate(city_count_a=Count('cities')).order_by('country__name', 'name'))
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

# Filtro de escopo (por-roteiro) na LISTAGEM de tipos de acomodação/cabine:
#   ?itinerary=<id> → SÓ os tipos exclusivos daquele roteiro (pop-up de gestão);
#   ?for=<id>       → tipos RESOLVIDOS do roteiro: os próprios se existirem, senão
#                     os globais (usado pelos seletores do roteiro — regra "substituir");
#   sem parâmetro   → só os GLOBAIS (Settings/vouchers).
# Só afeta a listagem — detalhe/edição/exclusão acessam qualquer linha por id.
def _scoped_config_qs(qs, view):
    if view.action != 'list':
        return qs
    it = view.request.query_params.get('itinerary')
    if it:
        return qs.filter(itinerary_id=it)
    forr = view.request.query_params.get('for')
    if forr:
        scoped = qs.filter(itinerary_id=forr)
        return scoped if scoped.exists() else qs.filter(itinerary__isnull=True)
    return qs.filter(itinerary__isnull=True)


class AccommodationSerializer(serializers.ModelSerializer):
    # `name` declarado explícito p/ NÃO herdar o UniqueValidator que o DRF gera do
    # UniqueConstraint de campo único (ele ignora a condição `itinerary IS NULL` e
    # barraria criar um tipo do roteiro com nome que já existe no global).
    name = serializers.CharField(max_length=200)

    class Meta:
        model = ConfigAccommodation
        fields = ['id', 'name', 'capacity', 'is_couple', 'itinerary']
        validators = []   # unicidade por ESCOPO validada manualmente (validate)

    def validate(self, attrs):
        name = attrs.get('name', getattr(self.instance, 'name', None))
        itin = attrs.get('itinerary', getattr(self.instance, 'itinerary', None))
        qs = ConfigAccommodation.objects.filter(name=name, itinerary=itin)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError({'name': 'Já existe um tipo com esse nome aqui.'})
        return attrs


class AccommodationViewSet(_ScopedTypeMixin, viewsets.ModelViewSet):
    serializer_class = AccommodationSerializer
    get_permissions  = _settings_perm('settings_accommodations')

    def get_queryset(self):
        return _scoped_config_qs(ConfigAccommodation.objects.all(), self)


# ── Tipos de Cabine (navio) ────────────────────────────────────────────────

class ShipCabinSerializer(serializers.ModelSerializer):
    name = serializers.CharField(max_length=200)   # sem UniqueValidator herdado

    class Meta:
        model = ConfigShipCabin
        fields = ['id', 'category', 'name', 'capacity', 'is_couple', 'itinerary']
        validators = []   # unicidade por escopo (itinerary, category, name) — ver abaixo

    def validate(self, attrs):
        name = attrs.get('name', getattr(self.instance, 'name', None))
        cat  = attrs.get('category', getattr(self.instance, 'category', ''))
        itin = attrs.get('itinerary', getattr(self.instance, 'itinerary', None))
        qs = ConfigShipCabin.objects.filter(name=name, category=cat or '', itinerary=itin)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError({'name': 'Já existe uma cabine com esse nome nesta categoria aqui.'})
        return attrs


class ShipCabinViewSet(_ScopedTypeMixin, viewsets.ModelViewSet):
    serializer_class = ShipCabinSerializer
    get_permissions  = _settings_perm('settings_ship_cabins')

    def get_queryset(self):
        return _scoped_config_qs(ConfigShipCabin.objects.all(), self)


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

from .airline_logos import normalize_logo_bytes, normalized_kiwi_logo, save_airline_logo


class AirlineSerializer(serializers.ModelSerializer):
    logo = serializers.SerializerMethodField()

    class Meta:
        model  = Airline
        fields = ['id', 'name', 'iata_code', 'country', 'is_favorite', 'logo']

    def get_logo(self, obj):
        return obj.logo.url if obj.logo else None


class AirlineViewSet(viewsets.ModelViewSet):
    queryset         = Airline.objects.all()
    serializer_class = AirlineSerializer
    pagination_class = ConfigListPagination
    get_permissions  = _settings_perm('settings_airlines',
                                      action_perms={'seed': 'import_web', 'fetch_logo': 'import_web'})

    def get_queryset(self):
        qs = Airline.objects.all()
        q = self.request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(iata_code__icontains=q))
        if self.request.query_params.get('favorites') in ('1', 'true', 'True'):
            qs = qs.filter(is_favorite=True)
        return qs.order_by('-is_favorite', 'name')

    @action(detail=True, methods=['post'], url_path='logo', parser_classes=[MultiPartParser, FormParser])
    def set_logo(self, request, pk=None):
        """Define/remove a logo (upload manual, já recortada no front). Normaliza para 320×160."""
        airline = self.get_object()
        if str(request.data.get('clear', '')).lower() in ('1', 'true'):
            if airline.logo:
                airline.logo.delete(save=True)
            return Response(AirlineSerializer(airline, context=self.get_serializer_context()).data)
        f = request.FILES.get('logo')
        if not f:
            return Response({'error': 'Envie a imagem.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            cf = normalize_logo_bytes(f.read())
        except ValueError:
            return Response({'error': 'Imagem inválida.'}, status=status.HTTP_400_BAD_REQUEST)
        save_airline_logo(airline, cf)
        return Response(AirlineSerializer(airline, context=self.get_serializer_context()).data)

    @action(detail=True, methods=['post'], url_path='fetch-logo')
    def fetch_logo(self, request, pk=None):
        """Baixa a logo da internet (Kiwi) pelo código IATA e normaliza para 320×160."""
        airline = self.get_object()
        if not (airline.iata_code or '').strip():
            return Response({'error': 'A companhia não tem código IATA.'}, status=status.HTTP_400_BAD_REQUEST)
        cf = normalized_kiwi_logo(airline.iata_code)
        if cf is None:
            return Response({'error': 'Logo não encontrada na internet para este código IATA.'}, status=status.HTTP_404_NOT_FOUND)
        save_airline_logo(airline, cf)
        return Response(AirlineSerializer(airline, context=self.get_serializer_context()).data)

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
        # delete()+bulk_create burlam o signal e o diff do BusMap não inclui as linhas
        # (relação reversa) → o redesenho do layout ficaria invisível. Loga um resumo.
        from audit.tracking import log_event
        log_event('update', model_name='BusMap', model_label='Mapa de ônibus',
                  object_id=bus_map.pk, object_repr=str(bus_map),
                  changes={'Layout de assentos': {'antes': '—', 'depois': f'{len(rows_data)} linha(s) redefinidas'}})

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
        fields = ['deadline_notification_emails',
                  'a_vista_discount_mode', 'a_vista_discount_value', 'a_vista_payment_method']

@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def system_settings(request):
    u = request.user
    is_admin = bool(u and (u.is_staff or u.is_superuser))
    obj = SystemSettings.get()
    if request.method == 'PATCH':
        if not is_admin:
            return Response({'detail': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)
        ser = SystemSettingsSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
    # GET: admin vê tudo; os demais (ex.: agência montando um contrato) recebem só os
    # padrões de desconto à vista, que o formulário de contrato precisa ler.
    data = SystemSettingsSerializer(obj).data
    if not is_admin:
        data = {k: data.get(k) for k in ('a_vista_discount_mode', 'a_vista_discount_value', 'a_vista_payment_method')}
    return Response(data)


# ── Configurações de reserva (percentuais) ──────────────────────────────────

class ReservationSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ReservationSettings
        fields = ['reserva_online_percent', 'pagamento_imediato_percent', 'reserva_operadora_percent', 'deadline_hours']

@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def reservation_settings(request):
    u = request.user
    is_admin = bool(u and (u.is_staff or u.is_superuser))
    obj = ReservationSettings.get()
    if request.method == 'PATCH':
        # Só a operadora (admin) pode marcar/editar esses percentuais.
        if not is_admin:
            return Response({'detail': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)
        ser = ReservationSettingsSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
    return Response(ReservationSettingsSerializer(obj).data)


# ── Logos configuráveis por lugar (branding) ────────────────────────────────
BRANDING_SLOTS = {
    'system':   'logo_system',    # legado (fallback geral / PDFs de lista)
    'sidebar':  'logo_sidebar',   # menu lateral
    'topbar':   'logo_topbar',    # barra branca do topo
    'login':    'logo_login',     # telas de login/recuperação
    'favicon':  'favicon',        # ícone do navegador
    'site':     'logo_site',      # vitrine pública
    'pdf':      'logo_pdf',       # PDF dos roteiros
    'contract': 'logo_contract',  # PDF dos contratos
    'voucher':  'logo_voucher',   # PDF dos vouchers
    'list':     'logo_list',      # PDF da lista de passageiros
}
# Campo da imagem ORIGINAL (não-destrutivo) de cada slot.
BRANDING_ORIGINAL_SLOTS = {slot: f'{field}_original' for slot, field in BRANDING_SLOTS.items()}


@api_view(['GET'])
@permission_classes([AllowAny])
def branding_logos(request):
    """URLs dos logos por lugar. PÚBLICO — usado até na tela de login e no favicon."""
    obj = SystemSettings.get()

    def url(f):
        if not f:
            return None
        try:
            return request.build_absolute_uri(f.url)
        except Exception:
            return f.url
    data = {slot: url(getattr(obj, field)) for slot, field in BRANDING_SLOTS.items()}
    # Não-destrutivo: URL da imagem original de cada slot + os dados de enquadramento.
    for slot, ofield in BRANDING_ORIGINAL_SLOTS.items():
        data[f'{slot}_original'] = url(getattr(obj, ofield, None))
    data['crops'] = obj.branding_crops or {}
    # Título da aba do navegador: valor cru p/ o campo + texto padrão quando vazio.
    data['title'] = obj.browser_title or ''
    data['title_fallback'] = 'Operadora'
    # Cores do tema (vazio = usa o padrão do CSS).
    data['color_primary'] = obj.color_primary or ''
    data['color_secondary'] = obj.color_secondary or ''
    return Response(data)


_HEX_RE = re.compile(r'^#[0-9a-fA-F]{6}$')


@api_view(['POST'])
def branding_colors_set(request):
    """Define as cores do tema. body: primary, secondary (hex #rrggbb; vazio = padrão)."""
    from users_api.permissions import has_any_perm
    if not has_any_perm(request.user, 'manage_settings', 'settings_operating_company_cores_edit'):
        return Response(status=status.HTTP_403_FORBIDDEN)

    def clean(v):
        v = (v or '').strip()
        if v and not _HEX_RE.match(v):
            return None, False
        return v, True

    primary, ok1 = clean(request.data.get('primary'))
    secondary, ok2 = clean(request.data.get('secondary'))
    if not ok1 or not ok2:
        return Response({'error': 'Cor inválida. Use o formato #rrggbb.'}, status=status.HTTP_400_BAD_REQUEST)
    obj = SystemSettings.get()
    obj.color_primary = primary
    obj.color_secondary = secondary
    obj.save(update_fields=['color_primary', 'color_secondary'])
    return Response({'color_primary': obj.color_primary, 'color_secondary': obj.color_secondary})


@api_view(['POST'])
def branding_title_set(request):
    """Define o título da aba do navegador. body: title (texto; vazio = limpar)."""
    from users_api.permissions import has_any_perm
    if not has_any_perm(request.user, 'manage_settings', 'settings_operating_company_logos_edit'):
        return Response(status=status.HTTP_403_FORBIDDEN)
    obj = SystemSettings.get()
    obj.browser_title = (request.data.get('title') or '').strip()[:120]
    obj.save(update_fields=['browser_title'])
    return Response({'title': obj.browser_title})


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def branding_logo_set(request, slot):
    """Define/remove o logo de um lugar. body: image (multipart) OU clear=1."""
    from users_api.permissions import has_any_perm
    if not has_any_perm(request.user, 'manage_settings', 'settings_operating_company_logos_edit'):
        return Response(status=status.HTTP_403_FORBIDDEN)
    field = BRANDING_SLOTS.get(slot)
    if not field:
        return Response({'error': 'Lugar inválido.'}, status=status.HTTP_404_NOT_FOUND)
    ofield = BRANDING_ORIGINAL_SLOTS.get(slot)
    obj = SystemSettings.get()
    if str(request.data.get('clear', '')).lower() in ('1', 'true'):
        for fld in (field, ofield):
            old = getattr(obj, fld, None)
            if old:
                old.delete(save=False)
            setattr(obj, fld, None)
        crops = dict(obj.branding_crops or {}); crops.pop(slot, None); obj.branding_crops = crops
        obj.save(update_fields=[field, ofield, 'branding_crops'])
        return Response({'url': None})
    up = request.FILES.get('image') or request.FILES.get('logo')
    if not up:
        return Response({'error': 'Envie a imagem.'}, status=status.HTTP_400_BAD_REQUEST)
    from passengers.validators import validate_document_file, sanitize_image, parse_crop
    from django.core.exceptions import ValidationError as DjangoValidationError
    try:
        validate_document_file(up, allowed_exts={'.png', '.jpg', '.jpeg', '.webp'}, allow_images=True)
    except DjangoValidationError as e:
        return Response({'error': (e.messages[0] if e.messages else 'Imagem inválida.')}, status=status.HTTP_400_BAD_REQUEST)
    old = getattr(obj, field)
    if old:
        old.delete(save=False)
    setattr(obj, field, up)
    update_fields = [field]

    # Não-destrutivo: guarda a ORIGINAL (para reabrir/desfazer) + o recorte.
    orig = request.FILES.get('original')
    if orig:
        try:
            cf = sanitize_image(orig, fmt='PNG', max_dim=1600)
        except DjangoValidationError:
            cf = None
        if cf is not None:
            oldo = getattr(obj, ofield, None)
            if oldo:
                oldo.delete(save=False)
            getattr(obj, ofield).save('logo_orig.png', cf, save=False)
            update_fields.append(ofield)
    crop = parse_crop(request.data.get('crop'))
    if crop:
        crops = dict(obj.branding_crops or {}); crops[slot] = crop; obj.branding_crops = crops
        update_fields.append('branding_crops')

    obj.save(update_fields=update_fields)
    return Response({'url': request.build_absolute_uri(getattr(obj, field).url)})


# ── Dados da operadora (UneWorld) — pré-preenche contratos ──────────────────

class OperatingCompanySerializer(serializers.ModelSerializer):
    # URL do endpoint que serve a imagem (com cache-bust por updated_at); o
    # arquivo em si é gravado na view (não pelo serializer).
    ceo_signature = serializers.SerializerMethodField()

    class Meta:
        model  = OperatingCompany
        fields = ['company_name', 'cnpj', 'seller', 'phone', 'mobile', 'email', 'website', 'address',
                  'agency_invite_email',
                  'pix_key_type', 'pix_key',
                  'default_signature_type', 'sms_verification',
                  'ceo_name', 'ceo_email', 'ceo_autentique_token', 'ceo_auto_sign', 'ceo_signature',
                  'updated_at']

    def get_ceo_signature(self, obj):
        if not obj.ceo_signature:
            return None
        ts = int(obj.updated_at.timestamp()) if obj.updated_at else 0
        return f'/api/config/operating-company/ceo-signature/?v={ts}'


CEO_SENSITIVE_FIELDS = ['ceo_name', 'ceo_email', 'ceo_autentique_token', 'ceo_auto_sign']


@api_view(['GET', 'PATCH'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
@permission_classes([IsAuthenticated])
def operating_company(request):
    from users_api.permissions import has_any_perm
    # Ver os dados da operadora: base (legado) OU qualquer aba de dados/pix/assinatura.
    can_settings = has_any_perm(request.user, 'manage_settings',
                                'settings_operating_company_view', 'settings_operating_company_edit',
                                'settings_operating_company_dados_view', 'settings_operating_company_dados_edit',
                                'settings_operating_company_pix_view', 'settings_operating_company_pix_edit',
                                'settings_operating_company_assinatura_view', 'settings_operating_company_assinatura_edit')
    # Campos sensíveis do CEO ficam SÓ para quem pode ver a aba Assinatura.
    can_assinatura = has_any_perm(request.user, 'manage_settings',
                                  'settings_operating_company_view', 'settings_operating_company_edit',
                                  'settings_operating_company_assinatura_view', 'settings_operating_company_assinatura_edit')
    # Quem cria/vê contratos também precisa dos dados da operadora (cabeçalho do
    # contrato, PIX, forma de assinatura padrão) — mas NÃO dos campos sensíveis do
    # CEO (token Autentique). Sem isso, o form de contrato quebra para usuários de
    # agência, que podem criar contrato mas não têm acesso às Configurações.
    can_contract = has_any_perm(request.user, 'contracts_view', 'contracts_edit')
    if not (can_settings or can_contract):
        return Response(status=403)
    obj = OperatingCompany.get()
    if request.method == 'PATCH':
        if not has_any_perm(request.user, 'manage_settings', 'settings_operating_company_edit',
                            'settings_operating_company_dados_edit', 'settings_operating_company_pix_edit',
                            'settings_operating_company_assinatura_edit'):
            return Response({'error': 'Você não tem permissão para executar esta ação.'}, status=403)
        ser = OperatingCompanySerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        # Imagem da assinatura do CEO (multipart) — tratada fora do serializer.
        sig = request.FILES.get('ceo_signature')
        if sig is not None:
            from django.core.exceptions import ValidationError as DjangoValidationError
            from passengers.validators import validate_document_file
            try:
                sig = validate_document_file(sig, allowed_exts={'.png', '.jpg', '.jpeg', '.webp'}, allow_images=True)
            except DjangoValidationError as e:
                return Response({'error': 'Assinatura inválida: ' + ' '.join(e.messages)}, status=400)
            obj.ceo_signature = sig
            obj.save(update_fields=['ceo_signature', 'updated_at'])
        elif str(request.data.get('ceo_signature_clear', '')).lower() in ('1', 'true', 'yes', 'on'):
            if obj.ceo_signature:
                obj.ceo_signature.delete(save=False)
            obj.ceo_signature = None
            obj.save(update_fields=['ceo_signature', 'updated_at'])
        return Response(OperatingCompanySerializer(obj).data)
    data = OperatingCompanySerializer(obj).data
    if not can_assinatura:
        for k in CEO_SENSITIVE_FIELDS:
            data.pop(k, None)
    return Response(data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def operating_company_ceo_signature(request):
    """Serve a imagem da assinatura do CEO (para embutir no PDF físico)."""
    from django.http import FileResponse, Http404
    from users_api.permissions import has_any_perm
    if not has_any_perm(request.user, 'manage_settings', 'settings_operating_company_view',
                        'settings_operating_company_edit', 'settings_operating_company_assinatura_view',
                        'settings_operating_company_assinatura_edit', 'contracts_view', 'contracts_edit'):
        return Response(status=403)
    obj = OperatingCompany.get()
    if not obj.ceo_signature:
        raise Http404
    resp = FileResponse(obj.ceo_signature.open('rb'), as_attachment=False)
    resp['X-Frame-Options'] = 'SAMEORIGIN'
    return resp


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
            demoted = list(PermissionProfile.objects.exclude(pk=obj.pk).filter(is_agency_default=True))
            PermissionProfile.objects.filter(pk__in=[p.pk for p in demoted]).update(is_agency_default=False)
            # Bulk update burla o signal — perda do "padrão de agência" é relevante p/
            # segurança (define as permissões que toda nova agência herda). Loga cada um.
            from audit.tracking import log_event
            for p in demoted:
                log_event('update', model_name='PermissionProfile', model_label='Perfil de permissão',
                          object_id=p.pk, object_repr=str(p),
                          changes={'Padrão de agência': {'antes': 'Sim', 'depois': 'Não'}})

    def _reapply_to_linked_users(self, profile):
        # Link VIVO: ao editar o perfil, re-aplica as permissões a todos os usuários
        # vinculados a ele (inclui os usuários de agência ligados ao perfil padrão).
        # actor = quem editou o perfil: não-super só propaga o que ele mesmo tem
        # (não escala os vinculados via edição de perfil).
        from users_api.permissions import apply_profile
        actor = getattr(self.request, 'user', None)
        for perms in profile.linked_permissions.select_related('user').all():
            apply_profile(perms.user, profile, actor=actor)

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [IsAuthenticated()]
        if self.action == 'destroy':
            return [RequirePermission('manage_settings', 'settings_user_profiles', 'settings_user_profiles_delete')()]
        return [RequirePermission('manage_settings', 'settings_user_profiles', 'settings_user_profiles_edit')()]


# ── Modelos de documentos (calibração de gabaritos de etiqueta/PDF) ──────────────
# Whitelist dos campos numéricos sobrescrevíveis por modelo, com faixa segura. NADA
# fora disto é aceito (sem código/HTML/URL/caminho; só número dentro do limite).
LABEL_OVERRIDE_LIMITS = {
    'marginLeftMm': (0, 120), 'marginTopMm': (0, 160),
    'horizontalGapMm': (-10, 40), 'verticalGapMm': (-10, 40),
    'labelWidthMm': (5, 400), 'labelHeightMm': (5, 400),
    'paddingLeftMm': (0, 30), 'paddingRightMm': (0, 30),
    'paddingTopMm': (0, 30), 'paddingBottomMm': (0, 30),
    'printerOffsetXMm': (-10, 10), 'printerOffsetYMm': (-10, 10),
}


def _clean_overrides(data):
    """Valida o JSON de overrides: só chaves conhecidas, numéricas e dentro do limite.
    Levanta ValidationError com mensagem clara. Retorna dict limpo (arredondado 0,01)."""
    if not isinstance(data, dict):
        raise serializers.ValidationError('Configuração inválida.')
    out = {}
    for k, v in data.items():
        if k not in LABEL_OVERRIDE_LIMITS:
            raise serializers.ValidationError(f'Campo não permitido: {k}')
        try:
            n = float(v)
        except (TypeError, ValueError):
            raise serializers.ValidationError(f'{k}: valor não numérico.')
        lo, hi = LABEL_OVERRIDE_LIMITS[k]
        if n < lo or n > hi:
            raise serializers.ValidationError(f'{k}: fora do limite ({lo} a {hi} mm).')
        out[k] = round(n, 2)
    return out


class DocumentTemplateConfigSerializer(serializers.ModelSerializer):
    updated_by_name = serializers.SerializerMethodField()
    published_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DocumentTemplateConfig
        fields = ['document_type', 'model_code', 'draft_json', 'published_json', 'version',
                  'history', 'updated_at', 'published_at', 'updated_by_name', 'published_by_name']

    def get_updated_by_name(self, obj):
        return getattr(obj.updated_by, 'first_name', '') or getattr(obj.updated_by, 'username', '') if obj.updated_by else ''

    def get_published_by_name(self, obj):
        u = obj.published_by
        return (getattr(u, 'first_name', '') or getattr(u, 'username', '')) if u else ''


def _doc_row(model_code, document_type='label'):
    row, _ = DocumentTemplateConfig.objects.get_or_create(document_type=document_type, model_code=model_code)
    return row


@api_view(['GET'])
def doc_models_list(request):
    """Lista todas as configurações (rascunho + publicado) para a tela admin."""
    if not (request.user.is_superuser or _has(request.user, 'manage_settings', 'settings_doc_models_view')):
        return Response({'detail': 'Sem permissão.'}, status=403)
    dt = request.query_params.get('document_type', 'label')
    rows = DocumentTemplateConfig.objects.filter(document_type=dt)
    return Response(DocumentTemplateConfigSerializer(rows, many=True).data)


@api_view(['GET'])
def doc_models_published(request):
    """PUBLICADO por modelo — lido pelo GERADOR (qualquer usuário autenticado). Só os
    números publicados; é o que os PDFs reais aplicam."""
    dt = request.query_params.get('document_type', 'label')
    out = {}
    for row in DocumentTemplateConfig.objects.filter(document_type=dt):
        if row.published_json:
            out[row.model_code] = row.published_json
    return Response(out)


@api_view(['PATCH'])
def doc_model_draft(request, model_code):
    """Salva o RASCUNHO (não afeta produção)."""
    if not (request.user.is_superuser or _has(request.user, 'manage_settings', 'settings_doc_models_edit')):
        return Response({'detail': 'Sem permissão.'}, status=403)
    clean = _clean_overrides(request.data if isinstance(request.data, dict) else {})
    row = _doc_row(model_code, request.query_params.get('document_type', 'label'))
    before = dict(row.draft_json or {})
    row.draft_json = clean
    row.updated_by = request.user
    row.save(update_fields=['draft_json', 'updated_by', 'updated_at'])
    from audit.tracking import log_event
    log_event('update', model_name='DocumentTemplateConfig', model_label='Modelo de documento',
              object_id=row.id, object_repr=f'{row.model_code} (rascunho)',
              changes={'Rascunho': {'antes': before, 'depois': clean}})
    return Response(DocumentTemplateConfigSerializer(row).data)


@api_view(['POST'])
def doc_model_publish(request, model_code):
    """PUBLICA o rascunho: vira publicado, versão sobe, versão anterior vai pro histórico."""
    if not (request.user.is_superuser or _has(request.user, 'manage_settings', 'settings_doc_models_publish')):
        return Response({'detail': 'Sem permissão.'}, status=403)
    from django.utils import timezone
    row = _doc_row(model_code, request.query_params.get('document_type', 'label'))
    before = dict(row.published_json or {})
    new_cfg = _clean_overrides(row.draft_json or {})
    # Snapshot da versão ANTERIOR no histórico (imutável).
    if row.version or row.published_json:
        row.history = (row.history or []) + [{
            'version': row.version, 'config': before,
            'published_by': (row.published_by.username if row.published_by else ''),
            'published_at': row.published_at.isoformat() if row.published_at else None,
            'note': (request.data or {}).get('note', ''),
        }]
    row.published_json = new_cfg
    row.version = (row.version or 0) + 1
    row.published_by = request.user
    row.published_at = timezone.now()
    row.save()
    from audit.tracking import log_event
    log_event('update', model_name='DocumentTemplateConfig', model_label='Modelo de documento',
              object_id=row.id, object_repr=f'{row.model_code} v{row.version}',
              changes={'Publicação': {'antes': before, 'depois': new_cfg}, 'Versão': row.version})
    return Response(DocumentTemplateConfigSerializer(row).data)


@api_view(['POST'])
def doc_model_discard(request, model_code):
    """Descarta o rascunho (volta ao publicado)."""
    if not (request.user.is_superuser or _has(request.user, 'manage_settings', 'settings_doc_models_edit')):
        return Response({'detail': 'Sem permissão.'}, status=403)
    row = _doc_row(model_code, request.query_params.get('document_type', 'label'))
    row.draft_json = dict(row.published_json or {})
    row.updated_by = request.user
    row.save(update_fields=['draft_json', 'updated_by', 'updated_at'])
    return Response(DocumentTemplateConfigSerializer(row).data)


@api_view(['POST'])
def doc_model_restore_default(request, model_code):
    """Restaura o PADRÃO do código (publica config vazia = usa o gabarito do código)."""
    if not (request.user.is_superuser or _has(request.user, 'manage_settings', 'settings_doc_models_publish')):
        return Response({'detail': 'Sem permissão.'}, status=403)
    from django.utils import timezone
    row = _doc_row(model_code, request.query_params.get('document_type', 'label'))
    before = dict(row.published_json or {})
    if row.version or row.published_json:
        row.history = (row.history or []) + [{
            'version': row.version, 'config': before,
            'published_by': (row.published_by.username if row.published_by else ''),
            'published_at': row.published_at.isoformat() if row.published_at else None,
            'note': 'restaurar padrão',
        }]
    row.published_json = {}
    row.draft_json = {}
    row.version = (row.version or 0) + 1
    row.published_by = request.user
    row.published_at = timezone.now()
    row.save()
    from audit.tracking import log_event
    log_event('update', model_name='DocumentTemplateConfig', model_label='Modelo de documento',
              object_id=row.id, object_repr=f'{row.model_code} (padrão)',
              changes={'Restaurar padrão': {'antes': before, 'depois': {}}, 'Versão': row.version})
    return Response(DocumentTemplateConfigSerializer(row).data)


@api_view(['POST'])
def doc_model_rollback(request, model_code):
    """Cria uma NOVA versão publicada a partir de uma versão do histórico (não apaga o histórico)."""
    if not (request.user.is_superuser or _has(request.user, 'manage_settings', 'settings_doc_models_publish')):
        return Response({'detail': 'Sem permissão.'}, status=403)
    from django.utils import timezone
    row = _doc_row(model_code, request.query_params.get('document_type', 'label'))
    target_v = (request.data or {}).get('version')
    snap = next((h for h in (row.history or []) if h.get('version') == target_v), None)
    if snap is None:
        return Response({'detail': 'Versão não encontrada no histórico.'}, status=404)
    before = dict(row.published_json or {})
    new_cfg = _clean_overrides(snap.get('config') or {})
    row.history = (row.history or []) + [{
        'version': row.version, 'config': before,
        'published_by': (row.published_by.username if row.published_by else ''),
        'published_at': row.published_at.isoformat() if row.published_at else None,
        'note': f'antes do rollback p/ v{target_v}',
    }]
    row.published_json = new_cfg
    row.draft_json = dict(new_cfg)
    row.version = (row.version or 0) + 1
    row.published_by = request.user
    row.published_at = timezone.now()
    row.save()
    from audit.tracking import log_event
    log_event('update', model_name='DocumentTemplateConfig', model_label='Modelo de documento',
              object_id=row.id, object_repr=f'{row.model_code} rollback→v{target_v}',
              changes={'Rollback': {'para_versao': target_v, 'depois': new_cfg}, 'Versão': row.version})
    return Response(DocumentTemplateConfigSerializer(row).data)


def _has(user, *keys):
    from users_api.permissions import has_any_perm
    return has_any_perm(user, *keys)

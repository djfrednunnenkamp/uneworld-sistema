import csv
import io
import requests
from django.http import StreamingHttpResponse, HttpResponse
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework import serializers
from rest_framework.parsers import MultiPartParser
from .models import (ConfigProfession, ConfigLanguage, ConfigCountry, ConfigState,
                     ConfigCity, ConfigVaccine, ConfigGender, ConfigProfCard,
                     CustomDocType, CustomDocField, CustomDocFieldOption,
                     ConfigAccommodation)


# ── Exportação/Importação global de Países → Estados → Cidades ────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def geo_analyze(request):
    """
    Analisa linhas do CSV sem gravar nada.
    Input:  { rows: [{pais, estado, cidade}, ...] }
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
@permission_classes([IsAdminUser])
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
            obj, created = ConfigCountry.objects.get_or_create(name=pais)
            if created:
                counts['countries'] += 1
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
@permission_classes([IsAuthenticated])
def geo_export(request):
    """
    Exporta todos os países, estados e cidades em um único CSV:
    pais,estado,cidade
    """
    def rows():
        yield 'pais,estado,cidade\n'
        for country in ConfigCountry.objects.prefetch_related('states__cities').order_by('name'):
            states = list(country.states.all())
            if not states:
                yield f'"{_esc(country.name)}",,\n'
                continue
            for state in states:
                cities = list(state.cities.all())
                if not cities:
                    yield f'"{_esc(country.name)}","{_esc(state.name)}",\n'
                    continue
                for city in cities:
                    yield f'"{_esc(country.name)}","{_esc(state.name)}","{_esc(city.name)}"\n'

    response = StreamingHttpResponse(rows(), content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = 'attachment; filename="paises_estados_cidades.csv"'
    return response


def _esc(s):
    return (s or '').replace('"', '""')


@api_view(['POST'])
@permission_classes([IsAdminUser])
def geo_import(request):
    """
    Importa CSV com colunas: pais,estado,cidade
    Cria países/estados/cidades que não existem ainda.
    """
    f = request.FILES.get('file')
    if not f:
        return Response({'error': 'Arquivo não enviado.'}, status=400)

    content   = f.read().decode('utf-8-sig')
    reader    = csv.DictReader(io.StringIO(content))

    # aceita variações de cabeçalho
    fieldnames = [n.lower().strip() for n in (reader.fieldnames or [])]
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
        c_name = (row.get(col_country) or '').strip()
        s_name = (row.get(col_state)   or '').strip() if col_state else ''
        ci_name= (row.get(col_city)    or '').strip() if col_city  else ''

        if not c_name:
            continue

        # País
        if c_name not in country_cache:
            obj, created = ConfigCountry.objects.get_or_create(name=c_name)
            if created:
                counts['countries'] += 1
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
    city_count = serializers.SerializerMethodField()
    class Meta:
        model = ConfigState
        fields = ['id', 'name', 'code', 'city_count']
    def get_city_count(self, obj):
        return obj.cities.count()

class CountrySerializer(serializers.ModelSerializer):
    state_count = serializers.SerializerMethodField()
    class Meta:
        model = ConfigCountry
        fields = ['id', 'name', 'code', 'state_count']
    def get_state_count(self, obj):
        return obj.states.count()


class ProfessionViewSet(viewsets.ModelViewSet):
    queryset = ConfigProfession.objects.all()
    serializer_class = ProfessionSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'import_default']:
            return [IsAdminUser()]
        return [IsAuthenticated()]

    @action(detail=False, methods=['post'], url_path='import')
    def import_default(self, request):
        URL_CSV  = 'https://raw.githubusercontent.com/okfn-brasil/datasets-br-cbo/master/data/lista_canonicos.csv'
        URL_JSON = 'https://raw.githubusercontent.com/lucassmacedo/cbo-brasil/master/json/CBO2002%20-%20Ocupacao.json'
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
            return Response({'error': 'Não foi possível importar. Verifique sua conexão.'}, status=502)
        created = sum(1 for n in sorted(names) if ConfigProfession.objects.get_or_create(name=n)[1])
        return Response({'total': ConfigProfession.objects.count(), 'created': created})


class LanguageViewSet(viewsets.ModelViewSet):
    queryset = ConfigLanguage.objects.all()
    serializer_class = LanguageSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'import_default']:
            return [IsAdminUser()]
        return [IsAuthenticated()]

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
        created = sum(1 for n in DEFAULT if ConfigLanguage.objects.get_or_create(name=n)[1])
        return Response({'total': ConfigLanguage.objects.count(), 'created': created})


class CountryViewSet(viewsets.ModelViewSet):
    queryset = ConfigCountry.objects.all()
    serializer_class = CountrySerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'import_default']:
            return [IsAdminUser()]
        return [IsAuthenticated()]

    @action(detail=False, methods=['post'], url_path='import')
    def import_default(self, request):
        try:
            r = requests.get('https://restcountries.com/v3.1/all?fields=name,cca2,translations', timeout=20)
            if not r.ok:
                return Response({'error': 'Falha ao buscar países.'}, status=502)
        except Exception:
            return Response({'error': 'Erro de conexão.'}, status=502)
        created = 0
        for c in r.json():
            name = (c.get('translations') or {}).get('por', {}).get('common') or c['name']['common']
            code = c.get('cca2', '')
            _, was_created = ConfigCountry.objects.get_or_create(name=name, defaults={'code': code})
            if was_created:
                created += 1
        return Response({'total': ConfigCountry.objects.count(), 'created': created})


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

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'seed']:
            return [IsAdminUser()]
        return [IsAuthenticated()]

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
        return [IsAdminUser()]

    def perform_create(self, serializer):
        doc_type = CustomDocType.objects.get(pk=self.request.data['doc_type_id'])
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
        return [IsAdminUser()]

    def perform_create(self, serializer):
        field = CustomDocField.objects.get(pk=self.request.data['field_id'])
        serializer.save(field=field)


class ProfCardSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigProfCard
        fields = ['id', 'name']


class ProfCardViewSet(viewsets.ModelViewSet):
    queryset = ConfigProfCard.objects.all()
    serializer_class = ProfCardSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'import_default']:
            return [IsAdminUser()]
        return [IsAuthenticated()]

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
        created = sum(1 for n in DEFAULT if ConfigProfCard.objects.get_or_create(name=n)[1])
        return Response({'total': ConfigProfCard.objects.count(), 'created': created})


class GenderSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigGender
        fields = ['id', 'name']


class GenderViewSet(viewsets.ModelViewSet):
    queryset = ConfigGender.objects.all()
    serializer_class = GenderSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAdminUser()]
        return [IsAuthenticated()]


class VaccineSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigVaccine
        fields = ['id', 'name']


class VaccineViewSet(viewsets.ModelViewSet):
    queryset = ConfigVaccine.objects.all()
    serializer_class = VaccineSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'import_default']:
            return [IsAdminUser()]
        return [IsAuthenticated()]

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
        created = sum(1 for n in DEFAULT if ConfigVaccine.objects.get_or_create(name=n)[1])
        return Response({'total': ConfigVaccine.objects.count(), 'created': created})


class CitySerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigCity
        fields = ['id', 'name']


class CityViewSet(viewsets.ModelViewSet):
    serializer_class = CitySerializer
    pagination_class = None

    def get_queryset(self):
        state_id = self.request.query_params.get('state_id')
        if state_id:
            return ConfigCity.objects.filter(state_id=state_id)
        return ConfigCity.objects.none()

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            return [IsAdminUser()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        state = ConfigState.objects.get(pk=self.request.data['state_id'])
        serializer.save(state=state)


class StateViewSet(viewsets.ModelViewSet):
    serializer_class = StateSerializer
    pagination_class = None

    def get_queryset(self):
        country_id = self.request.query_params.get('country_id')
        if country_id:
            return ConfigState.objects.filter(country_id=country_id)
        return ConfigState.objects.none()

    def get_permissions(self):
        if self.action in ['create', 'update', 'partial_update', 'destroy', 'import_for_country']:
            return [IsAdminUser()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        country = ConfigCountry.objects.get(pk=self.request.data['country_id'])
        serializer.save(country=country)

    @action(detail=False, methods=['post'], url_path='import')
    def import_for_country(self, request):
        country_id = request.data.get('country_id')
        try:
            country = ConfigCountry.objects.get(pk=country_id)
        except ConfigCountry.DoesNotExist:
            return Response({'error': 'País não encontrado.'}, status=404)
        created = 0
        try:
            if country.code == 'BR':
                r = requests.get('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome', timeout=15)
                if r.ok:
                    for s in r.json():
                        _, ok = ConfigState.objects.get_or_create(country=country, name=s['nome'], defaults={'code': s['sigla']})
                        if ok:
                            created += 1
            else:
                r = requests.post('https://countriesnow.space/api/v0.1/countries/states', json={'country': country.name}, timeout=15)
                if r.ok:
                    for s in r.json().get('data', {}).get('states', []):
                        _, ok = ConfigState.objects.get_or_create(country=country, name=s['name'], defaults={'code': s.get('state_code', '')})
                        if ok:
                            created += 1
        except Exception:
            return Response({'error': 'Erro ao importar estados.'}, status=502)
        return Response({'total': country.states.count(), 'created': created})


# ── Tipos de Acomodação ────────────────────────────────────────────────────

class AccommodationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigAccommodation
        fields = ['id', 'name', 'capacity', 'is_couple']


class AccommodationViewSet(viewsets.ModelViewSet):
    queryset         = ConfigAccommodation.objects.all()
    serializer_class = AccommodationSerializer
    permission_classes = [IsAuthenticated]

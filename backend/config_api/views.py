import requests
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework import serializers
from .models import ConfigProfession, ConfigLanguage, ConfigCountry, ConfigState, ConfigCity


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

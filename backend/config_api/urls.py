from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('professions',  views.ProfessionViewSet, basename='profession')
router.register('languages',    views.LanguageViewSet,   basename='language')
router.register('countries',    views.CountryViewSet,    basename='country')
router.register('states',       views.StateViewSet,      basename='state')
router.register('cities',       views.CityViewSet,       basename='city')
router.register('vaccines',     views.VaccineViewSet,    basename='vaccine')
router.register('genders',      views.GenderViewSet,     basename='gender')

urlpatterns = [
    path('', include(router.urls)),
    path('geo/export/',  views.geo_export,        name='geo-export'),
    path('geo/import/',  views.geo_import,         name='geo-import'),
    path('geo/analyze/', views.geo_analyze,        name='geo-analyze'),
    path('geo/action/',  views.geo_import_action,  name='geo-action'),
]

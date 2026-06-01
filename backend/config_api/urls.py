from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('professions',  views.ProfessionViewSet, basename='profession')
router.register('languages',    views.LanguageViewSet,   basename='language')
router.register('countries',    views.CountryViewSet,    basename='country')
router.register('states',       views.StateViewSet,      basename='state')

urlpatterns = [path('', include(router.urls))]

from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ContractViewSet, autentique_webhook

router = DefaultRouter()
router.register('', ContractViewSet, basename='contract')

# O webhook precisa vir ANTES das rotas do router, senão 'autentique-webhook'
# seria capturado como o <pk> do detalhe do contrato.
urlpatterns = [
    path('autentique-webhook/', autentique_webhook, name='contract-autentique-webhook'),
    *router.urls,
]

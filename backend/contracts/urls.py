from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ContractViewSet, autentique_webhook
from . import commissions_views as cv

router = DefaultRouter()
router.register('', ContractViewSet, basename='contract')

# O webhook e as rotas de comissões precisam vir ANTES das rotas do router, senão
# seriam capturados como o <pk> do detalhe do contrato.
urlpatterns = [
    path('autentique-webhook/', autentique_webhook, name='contract-autentique-webhook'),
    path('commissions/summary/',      cv.commissions_summary,     name='commissions-summary'),
    path('commissions/by-seller/',    cv.commissions_by_seller,   name='commissions-by-seller'),
    path('commissions/by-dimension/', cv.commissions_by_dimension, name='commissions-by-dimension'),
    path('commissions/year-comparison/', cv.commissions_year_comparison, name='commissions-year-comparison'),
    path('commissions/timeseries/',   cv.commissions_timeseries,  name='commissions-timeseries'),
    path('commissions/insights/',     cv.commissions_insights,    name='commissions-insights'),
    path('commissions/ai-context/',   cv.commissions_ai_context,  name='commissions-ai-context'),
    path('commissions/meta/',         cv.commissions_meta,        name='commissions-meta'),
    path('commissions/export/',       cv.commissions_export,      name='commissions-export'),
    path('commissions/seller/<int:seller_id>/contracts/', cv.commissions_seller_contracts, name='commissions-seller-contracts'),
    *router.urls,
]

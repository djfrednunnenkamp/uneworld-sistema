from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (ItineraryViewSet, ItineraryFieldTemplateViewSet,
                    ItineraryDepartureViewSet, ItineraryFlightViewSet, ItineraryHotelViewSet,
                    ItineraryBoatViewSet, ItineraryTerrestreDepartureViewSet, ItineraryTerrestreLegViewSet,
                    ItineraryDocumentViewSet, ItineraryDocumentFolderViewSet, GalleryImageViewSet,
                    document_callback, document_oo_download,
                    ItineraryCostItemViewSet, ItineraryCurrencyRateViewSet,
                    ItineraryInventoryBlockViewSet, ItineraryCostPaymentViewSet)

router = DefaultRouter()
# Rotas nomeadas ANTES de '' para não serem capturadas pela rota de detalhe do
# ItineraryViewSet (que usa <pk>).
router.register('field-templates', ItineraryFieldTemplateViewSet, basename='itinerary-field-template')
router.register('document-folders', ItineraryDocumentFolderViewSet, basename='itinerary-document-folder')
router.register('documents', ItineraryDocumentViewSet, basename='itinerary-document')
router.register('departures', ItineraryDepartureViewSet, basename='itinerary-departure')
router.register('flights', ItineraryFlightViewSet, basename='itinerary-flight')
router.register('hotels', ItineraryHotelViewSet, basename='itinerary-hotel')
router.register('boats', ItineraryBoatViewSet, basename='itinerary-boat')
router.register('terrestre-departures', ItineraryTerrestreDepartureViewSet, basename='itinerary-terrestre-departure')
router.register('terrestre-legs', ItineraryTerrestreLegViewSet, basename='itinerary-terrestre-leg')
router.register('cost-items', ItineraryCostItemViewSet, basename='itinerary-cost-item')
router.register('currency-rates', ItineraryCurrencyRateViewSet, basename='itinerary-currency-rate')
router.register('inventory-blocks', ItineraryInventoryBlockViewSet, basename='itinerary-inventory-block')
router.register('cost-payments', ItineraryCostPaymentViewSet, basename='itinerary-cost-payment')
router.register('gallery', GalleryImageViewSet, basename='gallery-image')
router.register('', ItineraryViewSet, basename='itinerary')

# Callback e download do OnlyOffice (fora do router: sem auth/CSRF, o DS chama
# server-side). Vêm ANTES de router.urls para não colidir com 'documents/<pk>/'.
urlpatterns = [
    path('documents/<int:pk>/callback/', document_callback, name='itinerary-document-callback'),
    path('documents/oo-download/', document_oo_download, name='itinerary-document-oo-download'),
] + router.urls

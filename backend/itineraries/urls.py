from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (ItineraryViewSet, ItineraryFieldTemplateViewSet,
                    ItineraryDepartureViewSet, ItineraryFlightViewSet, ItineraryHotelViewSet,
                    ItineraryBoatViewSet, ItineraryTerrestreDepartureViewSet, ItineraryTerrestreLegViewSet,
                    ItineraryDocumentViewSet, GalleryImageViewSet, document_callback,
                    ItineraryCostItemViewSet, ItineraryCurrencyRateViewSet)

router = DefaultRouter()
# Rotas nomeadas ANTES de '' para não serem capturadas pela rota de detalhe do
# ItineraryViewSet (que usa <pk>).
router.register('field-templates', ItineraryFieldTemplateViewSet, basename='itinerary-field-template')
router.register('documents', ItineraryDocumentViewSet, basename='itinerary-document')
router.register('departures', ItineraryDepartureViewSet, basename='itinerary-departure')
router.register('flights', ItineraryFlightViewSet, basename='itinerary-flight')
router.register('hotels', ItineraryHotelViewSet, basename='itinerary-hotel')
router.register('boats', ItineraryBoatViewSet, basename='itinerary-boat')
router.register('terrestre-departures', ItineraryTerrestreDepartureViewSet, basename='itinerary-terrestre-departure')
router.register('terrestre-legs', ItineraryTerrestreLegViewSet, basename='itinerary-terrestre-leg')
router.register('cost-items', ItineraryCostItemViewSet, basename='itinerary-cost-item')
router.register('currency-rates', ItineraryCurrencyRateViewSet, basename='itinerary-currency-rate')
router.register('gallery', GalleryImageViewSet, basename='gallery-image')
router.register('', ItineraryViewSet, basename='itinerary')

# Callback do OnlyOffice (fora do router: sem auth/CSRF, o DS chama server-side).
urlpatterns = [
    path('documents/<int:pk>/callback/', document_callback, name='itinerary-document-callback'),
] + router.urls

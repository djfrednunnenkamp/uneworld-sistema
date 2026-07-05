from rest_framework.routers import DefaultRouter

from .views import (ItineraryViewSet, ItineraryFieldTemplateViewSet,
                    ItineraryDepartureViewSet, ItineraryFlightViewSet, ItineraryHotelViewSet,
                    ItineraryBoatViewSet)

router = DefaultRouter()
# Rotas nomeadas ANTES de '' para não serem capturadas pela rota de detalhe do
# ItineraryViewSet (que usa <pk>).
router.register('field-templates', ItineraryFieldTemplateViewSet, basename='itinerary-field-template')
router.register('departures', ItineraryDepartureViewSet, basename='itinerary-departure')
router.register('flights', ItineraryFlightViewSet, basename='itinerary-flight')
router.register('hotels', ItineraryHotelViewSet, basename='itinerary-hotel')
router.register('boats', ItineraryBoatViewSet, basename='itinerary-boat')
router.register('', ItineraryViewSet, basename='itinerary')

urlpatterns = router.urls

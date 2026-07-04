from rest_framework.routers import DefaultRouter

from .views import ItineraryViewSet, ItineraryFieldTemplateViewSet

router = DefaultRouter()
# 'field-templates' registrado ANTES de '' para não ser capturado pela rota de
# detalhe do ItineraryViewSet (que usa <pk>).
router.register('field-templates', ItineraryFieldTemplateViewSet, basename='itinerary-field-template')
router.register('', ItineraryViewSet, basename='itinerary')

urlpatterns = router.urls

from rest_framework.routers import DefaultRouter

from .views import ItineraryViewSet

router = DefaultRouter()
router.register('', ItineraryViewSet, basename='itinerary')

urlpatterns = router.urls

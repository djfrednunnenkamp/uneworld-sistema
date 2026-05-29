from rest_framework.routers import DefaultRouter
from .views import PassengerViewSet

router = DefaultRouter()
router.register('', PassengerViewSet, basename='passenger')

urlpatterns = router.urls

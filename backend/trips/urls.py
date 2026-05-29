from rest_framework.routers import DefaultRouter
from .views import DestinationViewSet, TripViewSet, EnrollmentViewSet

router = DefaultRouter()
router.register('destinations', DestinationViewSet, basename='destination')
router.register('enrollments', EnrollmentViewSet, basename='enrollment')
router.register('', TripViewSet, basename='trip')

urlpatterns = router.urls

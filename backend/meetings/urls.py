from rest_framework.routers import DefaultRouter
from .views import MeetingViewSet

router = DefaultRouter()
router.register('', MeetingViewSet, basename='meeting')

urlpatterns = router.urls

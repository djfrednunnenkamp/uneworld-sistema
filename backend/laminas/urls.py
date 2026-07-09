from rest_framework.routers import DefaultRouter

from .views import LaminaViewSet

router = DefaultRouter()
router.register('', LaminaViewSet, basename='lamina')

urlpatterns = router.urls

from rest_framework.routers import DefaultRouter
from .views import DriveNodeViewSet

router = DefaultRouter()
router.register(r'', DriveNodeViewSet, basename='drive')

urlpatterns = router.urls

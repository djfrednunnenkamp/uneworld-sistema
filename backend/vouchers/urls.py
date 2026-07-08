from rest_framework.routers import DefaultRouter

from .views import VoucherViewSet

router = DefaultRouter()
router.register('', VoucherViewSet, basename='voucher')

urlpatterns = router.urls

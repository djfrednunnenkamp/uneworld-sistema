from rest_framework.routers import DefaultRouter

from .views import VoucherViewSet, VoucherTemplateViewSet

router = DefaultRouter()
router.register('templates', VoucherTemplateViewSet, basename='vouchertemplate')  # antes do root
router.register('', VoucherViewSet, basename='voucher')

urlpatterns = router.urls

from rest_framework.routers import DefaultRouter

from .views import FornecedorViewSet

router = DefaultRouter()
router.register('', FornecedorViewSet, basename='fornecedor')
urlpatterns = router.urls

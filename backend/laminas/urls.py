from rest_framework.routers import DefaultRouter

from .views import LaminaViewSet, ColorPaletteViewSet

router = DefaultRouter()
# Rotas nomeadas ANTES do prefixo vazio (senão o <pk> da lâmina engole 'color-palettes').
router.register('color-palettes', ColorPaletteViewSet, basename='color-palette')
router.register('', LaminaViewSet, basename='lamina')

urlpatterns = router.urls

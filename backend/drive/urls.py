from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import DriveNodeViewSet, drive_document_callback, drive_oo_download

router = DefaultRouter()
router.register(r'', DriveNodeViewSet, basename='drive')

# Callback e download do OnlyOffice vêm ANTES das rotas do router (que capturam
# /<pk>/) para não serem confundidos com uma action/detalhe do viewset.
urlpatterns = [
    path('<int:pk>/callback/', drive_document_callback, name='drive-document-callback'),
    path('oo-download/', drive_oo_download, name='drive-oo-download'),
    *router.urls,
]

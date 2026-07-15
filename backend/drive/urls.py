from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import DriveNodeViewSet, drive_document_callback

router = DefaultRouter()
router.register(r'', DriveNodeViewSet, basename='drive')

# O callback do OnlyOffice precisa vir ANTES das rotas do router (que capturam
# /<pk>/) para não ser confundido com uma action do viewset.
urlpatterns = [
    path('<int:pk>/callback/', drive_document_callback, name='drive-document-callback'),
    *router.urls,
]

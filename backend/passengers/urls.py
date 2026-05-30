from rest_framework.routers import DefaultRouter
from django.urls import path
from .views import PassengerViewSet, PassengerDocumentViewSet

router = DefaultRouter()
router.register('documents', PassengerDocumentViewSet, basename='passenger-document')
router.register('', PassengerViewSet, basename='passenger')

urlpatterns = router.urls

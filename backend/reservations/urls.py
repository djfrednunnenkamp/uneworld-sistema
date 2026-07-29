from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register('', views.ReservationViewSet, basename='reservation')

urlpatterns = router.urls

from rest_framework.routers import DefaultRouter
from .views import (
    DestinationViewSet, TripViewSet, EnrollmentViewSet,
    SupplierViewSet, ListAdditionalViewSet, PassengerListViewSet,
)

router = DefaultRouter()
router.register('destinations',    DestinationViewSet,    basename='destination')
router.register('enrollments',     EnrollmentViewSet,     basename='enrollment')
router.register('suppliers',       SupplierViewSet,       basename='supplier')
router.register('list-additionals',ListAdditionalViewSet, basename='listadditional')
router.register('lists',           PassengerListViewSet,  basename='passengerlist')
router.register('',                TripViewSet,           basename='trip')

urlpatterns = router.urls

from rest_framework.routers import DefaultRouter
from .views import (
    DestinationViewSet, TripViewSet, EnrollmentViewSet,
    SupplierViewSet, ListAdditionalViewSet, CrewRoleViewSet, RoteiroViewSet, PassengerListViewSet,
)

router = DefaultRouter()
router.register('destinations',    DestinationViewSet,    basename='destination')
router.register('enrollments',     EnrollmentViewSet,     basename='enrollment')
router.register('suppliers',       SupplierViewSet,       basename='supplier')
router.register('list-additionals',ListAdditionalViewSet, basename='listadditional')
router.register('crew-roles',      CrewRoleViewSet,       basename='crewrole')
router.register('roteiros',        RoteiroViewSet,        basename='roteiro')
router.register('lists',           PassengerListViewSet,  basename='passengerlist')
router.register('',                TripViewSet,           basename='trip')

urlpatterns = router.urls

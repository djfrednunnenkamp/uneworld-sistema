from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('professions',  views.ProfessionViewSet, basename='profession')
router.register('languages',    views.LanguageViewSet,   basename='language')
router.register('countries',    views.CountryViewSet,    basename='country')
router.register('states',       views.StateViewSet,      basename='state')
router.register('cities',       views.CityViewSet,       basename='city')
router.register('vaccines',     views.VaccineViewSet,    basename='vaccine')
router.register('genders',      views.GenderViewSet,        basename='gender')
router.register('payment-methods', views.PaymentMethodViewSet, basename='payment-method')
router.register('payment-plans',   views.PaymentPlanViewSet,   basename='payment-plan')
router.register('exchange-rates',  views.ExchangeRateViewSet,  basename='exchange-rate')
router.register('prof-cards',   views.ProfCardViewSet,      basename='profcard')
router.register('doc-types',      views.DocTypeViewSet,          basename='doctype')
router.register('doc-fields',     views.DocFieldViewSet,         basename='docfield')
router.register('doc-options',    views.DocFieldOptionViewSet,   basename='docoption')
router.register('accommodations', views.AccommodationViewSet,    basename='accommodation')
router.register('list-categories', views.ListCategoryViewSet,    basename='listcategory')
router.register('airports',       views.AirportViewSet,          basename='airport')
router.register('airlines',       views.AirlineViewSet,          basename='airline')
router.register('bus-maps',            views.BusMapViewSet,              basename='busmap')
router.register('permission-profiles', views.PermissionProfileViewSet,   basename='permission-profile')
router.register('contract-clauses',    views.ContractClauseViewSet,      basename='contract-clause')
router.register('itinerary-categories', views.ItineraryCategoryViewSet,  basename='itinerary-category')
router.register('continents',           views.ContinentViewSet,          basename='continent')
router.register('destinations',         views.DestinationViewSet,        basename='destination')
router.register('holidays',             views.HolidayViewSet,             basename='holiday')
router.register('services',             views.ServiceViewSet,             basename='service')
router.register('itinerary-templates',  views.ItineraryTemplateViewSet,    basename='itinerary-template')

urlpatterns = [
    path('', include(router.urls)),
    path('geo/export/',       views.geo_export,        name='geo-export'),
    path('geo/import/',       views.geo_import,         name='geo-import'),
    path('geo/analyze/',      views.geo_analyze,        name='geo-analyze'),
    path('geo/action/',       views.geo_import_action,  name='geo-action'),
    path('system-settings/',  views.system_settings,    name='system-settings'),
    path('terms/',            views.terms_and_conditions, name='terms'),
    path('operating-company/', views.operating_company,  name='operating-company'),
    path('operating-company/ceo-signature/', views.operating_company_ceo_signature, name='operating-company-ceo-signature'),
]

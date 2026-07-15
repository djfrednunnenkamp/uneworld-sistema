from django.urls import path
from .views import dashboard_stats, dashboard_birthdays

urlpatterns = [
    path('', dashboard_stats, name='dashboard-stats'),
    path('birthdays/', dashboard_birthdays, name='dashboard-birthdays'),
]

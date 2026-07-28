from django.urls import path
from . import views

urlpatterns = [
    path('receivables/', views.receivables, name='financeiro-receivables'),
    path('payables/',    views.payables,    name='financeiro-payables'),
    path('cashflow/',    views.cashflow,    name='financeiro-cashflow'),
    path('meta/',        views.meta,        name='financeiro-meta'),
]

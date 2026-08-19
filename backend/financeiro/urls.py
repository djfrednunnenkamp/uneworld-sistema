from django.urls import path
from . import views

urlpatterns = [
    path('receivables/', views.receivables, name='financeiro-receivables'),
    path('payables/',    views.payables,    name='financeiro-payables'),
    path('cashflow/',    views.cashflow,    name='financeiro-cashflow'),
    path('meta/',        views.meta,        name='financeiro-meta'),
    path('receivables/<int:pk>/payments/', views.add_receivable_payment, name='financeiro-add-payment'),
    path('receivables/<int:pk>/payments/<int:payment_id>/', views.delete_receivable_payment,
         name='financeiro-del-payment'),
]

from django.contrib import admin
from .models import Passenger


@admin.register(Passenger)
class PassengerAdmin(admin.ModelAdmin):
    list_display    = ['full_name', 'email', 'mobile', 'city', 'state', 'status', 'created_at']
    list_filter     = ['status', 'state', 'gender', 'is_foreign', 'is_verified']
    search_fields   = ['full_name', 'email', 'cpf', 'rg', 'passport']
    readonly_fields = ['created_at', 'updated_at']
    filter_horizontal = ['agencies']

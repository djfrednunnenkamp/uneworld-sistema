from django.contrib import admin
from .models import Passenger


@admin.register(Passenger)
class PassengerAdmin(admin.ModelAdmin):
    list_display = ['full_name', 'email', 'phone', 'city', 'state', 'status', 'created_at']
    list_filter = ['status', 'state', 'document_type']
    search_fields = ['full_name', 'email', 'document_number']
    readonly_fields = ['created_at', 'updated_at']

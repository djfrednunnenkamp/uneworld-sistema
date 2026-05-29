from django.contrib import admin
from .models import Agency


@admin.register(Agency)
class AgencyAdmin(admin.ModelAdmin):
    list_display  = ['name', 'email', 'phone', 'responsible', 'status', 'created_at']
    list_filter   = ['status']
    search_fields = ['name', 'email', 'cnpj', 'responsible']
    readonly_fields = ['created_at', 'updated_at']

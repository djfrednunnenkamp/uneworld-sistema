from django.contrib import admin

from .models import Fornecedor


@admin.register(Fornecedor)
class FornecedorAdmin(admin.ModelAdmin):
    list_display = ['name', 'status', 'category', 'city', 'country', 'created_at']
    list_filter = ['status', 'category']
    search_fields = ['name', 'company_name', 'cpf', 'cnpj', 'airline_abbr']
    readonly_fields = ['created_at', 'updated_at']

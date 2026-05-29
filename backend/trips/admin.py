from django.contrib import admin
from .models import Destination, Trip, Enrollment


@admin.register(Destination)
class DestinationAdmin(admin.ModelAdmin):
    list_display = ['name', 'country']
    search_fields = ['name', 'country']


class EnrollmentInline(admin.TabularInline):
    model = Enrollment
    extra = 0
    autocomplete_fields = ['passenger']


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = ['title', 'destination', 'departure_date', 'return_date', 'max_passengers', 'status']
    list_filter = ['status', 'destination__country']
    search_fields = ['title', 'destination__name']
    readonly_fields = ['created_at', 'updated_at']
    inlines = [EnrollmentInline]


@admin.register(Enrollment)
class EnrollmentAdmin(admin.ModelAdmin):
    list_display = ['passenger', 'trip', 'status', 'enrolled_at']
    list_filter = ['status']
    search_fields = ['passenger__full_name', 'trip__title']

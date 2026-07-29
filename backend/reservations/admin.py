from django.contrib import admin

from .models import Reservation


@admin.register(Reservation)
class ReservationAdmin(admin.ModelAdmin):
    list_display = ('id', 'itinerary', 'agency', 'reservation_type', 'status', 'pax', 'expires_at', 'created_at')
    list_filter = ('reservation_type', 'status', 'is_deleted')
    search_fields = ('itinerary__name', 'agency__name')
    raw_id_fields = ('itinerary', 'agency', 'contract', 'created_by')

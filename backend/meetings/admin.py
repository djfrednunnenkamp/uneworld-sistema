from django.contrib import admin
from .models import Meeting, MeetingParticipant


class ParticipantInline(admin.TabularInline):
    model = MeetingParticipant
    extra = 0


@admin.register(Meeting)
class MeetingAdmin(admin.ModelAdmin):
    list_display = ['title', 'meeting_type', 'scheduled_at', 'status', 'trip']
    list_filter = ['status', 'meeting_type']
    search_fields = ['title', 'trip__title']
    readonly_fields = ['created_at', 'updated_at']
    inlines = [ParticipantInline]

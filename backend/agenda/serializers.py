from rest_framework import serializers

from .models import CalendarPreference


class CalendarPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CalendarPreference
        fields = ['digest_enabled', 'digest_frequency', 'reminder_enabled', 'reminder_days_before',
                  'receive_deadline_emails', 'receive_task_emails',
                  'side_panel_enabled', 'side_panel_position']

    def validate_reminder_days_before(self, value):
        if value < 0 or value > 30:
            raise serializers.ValidationError('Informe um valor entre 0 e 30 dias.')
        return value

from rest_framework import serializers

from .models import CalendarPreference, EmailLog


class CalendarPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CalendarPreference
        fields = ['digest_enabled', 'digest_frequency', 'reminder_enabled', 'reminder_days_before',
                  'receive_deadline_emails', 'receive_task_emails', 'receive_birthday_emails',
                  'send_hour', 'side_panel_enabled', 'side_panel_position']

    def validate_send_hour(self, value):
        allowed = [7, 8, 9, 10, 12, 13, 14, 17, 18, 19, 20]
        if value not in allowed:
            raise serializers.ValidationError('Horário inválido.')
        return value

    def validate_reminder_days_before(self, value):
        if value < 0 or value > 30:
            raise serializers.ValidationError('Informe um valor entre 0 e 30 dias.')
        return value


class EmailLogListSerializer(serializers.ModelSerializer):
    email_type_display = serializers.CharField(source='get_email_type_display', read_only=True)

    class Meta:
        model  = EmailLog
        fields = ['id', 'sent_at', 'to', 'subject', 'email_type', 'email_type_display', 'success']


class EmailLogDetailSerializer(serializers.ModelSerializer):
    email_type_display = serializers.CharField(source='get_email_type_display', read_only=True)

    class Meta:
        model  = EmailLog
        fields = ['id', 'sent_at', 'to', 'subject', 'email_type', 'email_type_display', 'success', 'html_body']

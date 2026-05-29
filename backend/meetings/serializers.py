from rest_framework import serializers
from .models import Meeting, MeetingParticipant


class MeetingParticipantSerializer(serializers.ModelSerializer):
    passenger_name = serializers.CharField(source='passenger.full_name', read_only=True)

    class Meta:
        model = MeetingParticipant
        fields = ['id', 'passenger', 'passenger_name', 'confirmed']


class MeetingSerializer(serializers.ModelSerializer):
    participants = MeetingParticipantSerializer(many=True, read_only=True)
    trip_title = serializers.CharField(source='trip.title', read_only=True)
    participant_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False
    )

    class Meta:
        model = Meeting
        fields = '__all__'

    def create(self, validated_data):
        participant_ids = validated_data.pop('participant_ids', [])
        meeting = super().create(validated_data)
        for pid in participant_ids:
            MeetingParticipant.objects.create(meeting=meeting, passenger_id=pid)
        return meeting


class MeetingListSerializer(serializers.ModelSerializer):
    trip_title = serializers.CharField(source='trip.title', read_only=True)
    participant_count = serializers.SerializerMethodField()

    class Meta:
        model = Meeting
        fields = ['id', 'title', 'meeting_type', 'scheduled_at', 'duration_minutes', 'location', 'status', 'trip_title', 'participant_count']

    def get_participant_count(self, obj):
        return obj.participants.count()

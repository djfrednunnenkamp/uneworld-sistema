from rest_framework import serializers
from agencies.models import Agency
from .models import Passenger, PassengerDocument
from .validators import validate_document_file


class PassengerListSerializer(serializers.ModelSerializer):
    agency_names = serializers.SerializerMethodField()

    class Meta:
        model  = Passenger
        fields = ['id', 'first_name', 'last_name', 'full_name', 'email',
                  'mobile', 'phone1', 'cpf', 'city', 'state', 'status', 'agency_names']

    def get_agency_names(self, obj):
        return ', '.join(obj.agencies.values_list('name', flat=True))


class PassengerSerializer(serializers.ModelSerializer):
    agencies = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Agency.objects.all(), required=False
    )
    agency_names = serializers.SerializerMethodField()

    class Meta:
        model  = Passenger
        fields = '__all__'

    def get_agency_names(self, obj):
        return [{'id': a.id, 'name': a.name} for a in obj.agencies.all()]

    def create(self, validated_data):
        agencies = validated_data.pop('agencies', [])
        passenger = super().create(validated_data)
        passenger.agencies.set(agencies)
        return passenger

    def update(self, instance, validated_data):
        agencies = validated_data.pop('agencies', None)
        passenger = super().update(instance, validated_data)
        if agencies is not None:
            passenger.agencies.set(agencies)
        return passenger


class PassengerDocumentSerializer(serializers.ModelSerializer):
    download_url  = serializers.SerializerMethodField()
    doc_type_label = serializers.CharField(source='get_doc_type_display', read_only=True)
    display_name  = serializers.SerializerMethodField()

    class Meta:
        model  = PassengerDocument
        fields = ['id', 'doc_type', 'doc_type_label', 'label', 'display_name',
                  'original_name', 'file_size', 'mime_type', 'notes',
                  'uploaded_at', 'download_url']
        read_only_fields = ['original_name', 'file_size', 'mime_type', 'uploaded_at']

    def get_download_url(self, obj):
        return f"/api/passengers/documents/{obj.id}/download/"

    def get_display_name(self, obj):
        return obj.label or obj.get_doc_type_display()

    def validate(self, attrs):
        request = self.context.get('request')
        if request and request.FILES.get('file'):
            f = request.FILES['file']
            validate_document_file(f)
            attrs['original_name'] = f.name
            attrs['file_size']     = f.size
            attrs['mime_type']     = f.content_type or ''
        return attrs

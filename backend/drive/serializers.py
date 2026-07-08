from rest_framework import serializers
from django.contrib.auth.models import User
from .models import DriveNode


def _user_label(u):
    name = f'{u.first_name} {u.last_name}'.strip()
    return name or u.username or u.email or f'#{u.id}'


class DriveUserMiniSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'name', 'email']

    def get_name(self, obj):
        return _user_label(obj)


class DriveNodeSerializer(serializers.ModelSerializer):
    is_image      = serializers.BooleanField(read_only=True)
    download_url  = serializers.SerializerMethodField()
    preview_url   = serializers.SerializerMethodField()
    thumb_url     = serializers.SerializerMethodField()
    ext           = serializers.SerializerMethodField()
    editable      = serializers.SerializerMethodField()
    doc_kind      = serializers.SerializerMethodField()
    shared_with_data = DriveUserMiniSerializer(source='shared_with', many=True, read_only=True)
    owner_name    = serializers.SerializerMethodField()
    is_owner      = serializers.SerializerMethodField()

    class Meta:
        model  = DriveNode
        fields = ['id', 'kind', 'name', 'parent', 'original_name', 'file_size',
                  'mime_type', 'is_image', 'ext', 'editable', 'doc_kind',
                  'download_url', 'preview_url', 'thumb_url',
                  'shared_with', 'shared_with_data', 'owner', 'owner_name',
                  'is_owner', 'created_at', 'updated_at']
        read_only_fields = ['owner', 'original_name', 'file_size', 'mime_type',
                            'created_at', 'updated_at']
        extra_kwargs = {'file': {'write_only': True}, 'shared_with': {'required': False}}

    def get_download_url(self, obj):
        return f'/api/drive/{obj.id}/download/' if obj.kind == 'file' else None

    def get_preview_url(self, obj):
        return f'/api/drive/{obj.id}/preview/' if obj.kind == 'file' else None

    def get_thumb_url(self, obj):
        """Miniatura do conteúdo p/ Word/Excel/PPT/PDF. ?v muda com o conteúdo
        (edit_key) p/ o navegador buscar de novo após uma edição."""
        from itineraries import onlyoffice
        if obj.kind == 'file' and onlyoffice.doc_kind(obj.name or '') in ('word', 'excel', 'powerpoint', 'pdf'):
            return f'/api/drive/{obj.id}/thumb/?v={obj.edit_key or "0"}'
        return None

    def get_ext(self, obj):
        import os
        return (os.path.splitext(obj.original_name or obj.name or '')[1] or '').lower().lstrip('.')

    def get_editable(self, obj):
        """True se dá para abrir no editor OnlyOffice (Word/Excel/PPT/PDF/txt…)."""
        from itineraries import onlyoffice
        return bool(obj.kind == 'file' and onlyoffice.office_document_type(obj.name or ''))

    def get_doc_kind(self, obj):
        """Categoria p/ ícone: word|excel|powerpoint|pdf|other (ou None se pasta)."""
        from itineraries import onlyoffice
        return onlyoffice.doc_kind(obj.name or '') if obj.kind == 'file' else None

    def get_owner_name(self, obj):
        return _user_label(obj.owner) if obj.owner_id else ''

    def get_is_owner(self, obj):
        req = self.context.get('request')
        return bool(req and obj.owner_id == req.user.id)

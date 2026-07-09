from rest_framework import serializers
from .models import Lamina


class LaminaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lamina
        fields = ['id', 'name', 'headline', 'theme', 'pattern', 'columns', 'rows',
                  'roteiro_ids', 'created_by', 'created_at', 'updated_at']
        read_only_fields = ['created_by', 'created_at', 'updated_at']

    def validate_columns(self, v):
        return max(1, min(int(v or 1), 6))

    def validate_rows(self, v):
        return max(1, min(int(v or 1), 12))

    def validate_roteiro_ids(self, v):
        if not isinstance(v, list):
            return []
        out = []
        for x in v:
            try:
                out.append(int(x))
            except (TypeError, ValueError):
                continue
        return out[:200]

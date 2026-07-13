import re

from rest_framework import serializers
from .models import Lamina, UserColorPalette

# #RGB ou #RRGGBB (com ou sem #, maiúsc/minúsc).
_HEX_RE = re.compile(r'^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')


def normalize_hex(value):
    """Normaliza uma cor para '#RRGGBB' maiúsculo. Retorna None se inválida."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not _HEX_RE.match(v):
        return None
    v = v.lstrip('#').upper()
    if len(v) == 3:
        v = ''.join(c * 2 for c in v)
    return f'#{v}'


class LaminaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lamina
        fields = ['id', 'name', 'headline', 'theme', 'pattern', 'columns', 'rows',
                  'roteiro_ids', 'roteiro_order_manual', 'footer', 'source', 'agency', 'style',
                  'created_by', 'created_at', 'updated_at']
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

    def validate_style(self, v):
        # Guarda um JSON de estilo enxuto e saudável (não confia no que vem do front).
        if not isinstance(v, dict):
            return {}
        out = {}
        colors = v.get('colors')
        if isinstance(colors, dict):
            clean = {}
            for role, hexval in list(colors.items())[:20]:
                nh = normalize_hex(hexval)
                if isinstance(role, str) and nh:
                    clean[role[:24]] = nh
            if clean:
                out['colors'] = clean
        if v.get('pattern_density') in ('light', 'medium', 'dense'):
            out['pattern_density'] = v['pattern_density']
        if isinstance(v.get('pattern_opacity'), (int, float)):
            out['pattern_opacity'] = max(0, min(round(float(v['pattern_opacity']), 3), 1))
        pc = normalize_hex(v.get('pattern_color'))
        if pc:
            out['pattern_color'] = pc
        if isinstance(v.get('pattern_scale'), (int, float)):
            out['pattern_scale'] = max(0.4, min(round(float(v['pattern_scale']), 3), 3))
        return out


class UserColorPaletteSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserColorPalette
        fields = ['id', 'name', 'colors', 'is_favorite', 'sort_order', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']

    def validate_name(self, v):
        v = (v or '').strip()
        if not v:
            raise serializers.ValidationError('Informe um nome para a paleta.')
        if len(v) > 60:
            raise serializers.ValidationError('Nome muito longo (máx. 60 caracteres).')
        return v

    def validate_colors(self, v):
        if not isinstance(v, list) or len(v) == 0:
            raise serializers.ValidationError('A paleta precisa de ao menos uma cor.')
        out, seen = [], set()
        for c in v:
            nh = normalize_hex(c)
            if nh is None:
                raise serializers.ValidationError(f'Cor inválida: {c!r}. Use hexadecimal (ex.: #192D58).')
            if nh in seen:
                continue  # evita duplicações desnecessárias
            seen.add(nh)
            out.append(nh)
        if len(out) > UserColorPalette.MAX_COLORS:
            raise serializers.ValidationError(f'Máximo de {UserColorPalette.MAX_COLORS} cores por paleta.')
        return out

    def create(self, validated_data):
        user = self.context['request'].user
        if UserColorPalette.objects.filter(user=user).count() >= UserColorPalette.MAX_PER_USER:
            raise serializers.ValidationError(
                f'Limite de {UserColorPalette.MAX_PER_USER} paletas por usuário atingido.')
        validated_data['user'] = user  # propriedade definida no back — nunca vinda do front
        return super().create(validated_data)

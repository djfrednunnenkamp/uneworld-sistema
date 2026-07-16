from rest_framework import serializers

from .models import CalendarPreference, EmailLog


class CalendarPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CalendarPreference
        fields = ['time_format', 'digest_enabled', 'digest_frequency', 'digest_send_hour',
                  'reminder_enabled', 'reminder_days_before',
                  'receive_deadline_emails', 'receive_task_emails', 'receive_birthday_emails',
                  'send_hour', 'side_panel_enabled', 'side_panel_position',
                  'contract_create_layout', 'contract_edit_layout',
                  'dashboard_currencies', 'dashboard_chart_range', 'dashboard_list_statuses', 'lamina_recent_colors',
                  'lamina_favorite_patterns', 'lamina_recent_patterns', 'lamina_favorite_recommended',
                  'lamina_favorite_themes',
                  'itinerary_tab_order', 'drive_columns',
                  'nav_order', 'nav_hidden', 'table_columns']

    def validate_lamina_recent_colors(self, value):
        # Lista de '#RRGGBB' (máx. 16, sem repetição, mais recente primeiro).
        import re
        hexre = re.compile(r'^#?([0-9a-fA-F]{6})$')
        out, seen = [], set()
        for c in (value if isinstance(value, list) else []):
            if not isinstance(c, str) or not hexre.match(c.strip()):
                continue
            v = '#' + c.strip().lstrip('#').upper()
            if v in seen:
                continue
            seen.add(v)
            out.append(v)
            if len(out) >= 16:
                break
        return out

    def _clean_keys(self, value, cap=80):
        # Lista de chaves curtas (estampa/paleta), sem repetição, mantendo a ordem.
        out, seen = [], set()
        for k in (value if isinstance(value, list) else []):
            if isinstance(k, str) and k.strip() and k not in seen and len(k) <= 40:
                seen.add(k); out.append(k[:40])
            if len(out) >= cap:
                break
        return out

    def validate_lamina_favorite_patterns(self, value):
        return None if value is None else self._clean_keys(value)

    def validate_lamina_recent_patterns(self, value):
        return self._clean_keys(value, cap=16)

    def validate_lamina_favorite_recommended(self, value):
        return None if value is None else self._clean_keys(value)

    def validate_lamina_favorite_themes(self, value):
        return None if value is None else self._clean_keys(value)

    def validate_dashboard_currencies(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Formato inválido.')
        try:
            return [int(v) for v in value]
        except (TypeError, ValueError):
            raise serializers.ValidationError('IDs de moeda inválidos.')

    def validate_dashboard_list_statuses(self, value):
        # Subconjunto de {'ongoing','aberta','fechada'} (status das listas no card).
        allowed = {'ongoing', 'aberta', 'fechada'}
        if not isinstance(value, list):
            raise serializers.ValidationError('Formato inválido.')
        return [v for v in dict.fromkeys(value) if v in allowed]

    def validate_itinerary_tab_order(self, value):
        # Lista de chaves de aba (strings). Guardamos como veio; o front ignora
        # chaves desconhecidas e completa com as que faltarem.
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise serializers.ValidationError('Formato inválido.')
        return value[:40]

    def validate_nav_order(self, value):
        # Lista de rotas (strings), ex.: ['/contratos','/roteiros']. O front ignora
        # rotas desconhecidas/sem permissão e completa com as que faltarem.
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise serializers.ValidationError('Formato inválido.')
        return value[:40]

    def validate_nav_hidden(self, value):
        # Lista de rotas escondidas (strings).
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise serializers.ValidationError('Formato inválido.')
        return value[:40]

    def validate_table_columns(self, value):
        # Dict {tableId: [{key: str, on: bool}, ...]}. Guardamos só o essencial.
        if not isinstance(value, dict):
            raise serializers.ValidationError('Formato inválido.')
        out = {}
        for table_id, cols in list(value.items())[:30]:
            if not isinstance(table_id, str) or not isinstance(cols, list):
                continue
            clean = []
            for item in cols[:40]:
                if isinstance(item, dict) and isinstance(item.get('key'), str):
                    clean.append({'key': item['key'], 'on': bool(item.get('on', True))})
            out[table_id] = clean
        return out

    def validate_drive_columns(self, value):
        # Lista de {key: str, on: bool}. Guardamos só o essencial.
        if not isinstance(value, list):
            raise serializers.ValidationError('Formato inválido.')
        out = []
        for item in value[:20]:
            if isinstance(item, dict) and isinstance(item.get('key'), str):
                out.append({'key': item['key'], 'on': bool(item.get('on', True))})
        return out

    def _validate_hour(self, value):
        if not (0 <= value <= 23):
            raise serializers.ValidationError('Horário inválido (0–23).')
        return value

    def validate_send_hour(self, value):
        return self._validate_hour(value)

    def validate_digest_send_hour(self, value):
        return self._validate_hour(value)

    def validate_reminder_days_before(self, value):
        if value < 0 or value > 30:
            raise serializers.ValidationError('Informe um valor entre 0 e 30 dias.')
        return value


class EmailLogListSerializer(serializers.ModelSerializer):
    email_type_display = serializers.CharField(source='get_email_type_display', read_only=True)

    class Meta:
        model  = EmailLog
        fields = ['id', 'sent_at', 'to', 'subject', 'email_type', 'email_type_display', 'success',
                  'status', 'delivered_at', 'opened_at']


class EmailLogDetailSerializer(serializers.ModelSerializer):
    email_type_display = serializers.CharField(source='get_email_type_display', read_only=True)

    class Meta:
        model  = EmailLog
        fields = ['id', 'sent_at', 'to', 'subject', 'email_type', 'email_type_display', 'success', 'html_body',
                  'status', 'delivered_at', 'opened_at']

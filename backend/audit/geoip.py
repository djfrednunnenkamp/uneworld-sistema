"""Resolve IP -> localização aproximada usando o banco GeoLite2 (offline, sem
limite de consultas). Banco baixado via `python manage.py update_geoip`."""
import geoip2.database
import requests
from django.conf import settings

_reader = None
_unavailable = False


def _get_reader():
    global _reader, _unavailable
    if _reader is None and not _unavailable:
        try:
            _reader = geoip2.database.Reader(str(settings.GEOIP_DB_PATH))
        except FileNotFoundError:
            _unavailable = True
    return _reader


def locate_ip(ip_address):
    """Retorna {'city', 'country', 'latitude', 'longitude'} ou None."""
    if not ip_address or ip_address in ('127.0.0.1', '::1') or ip_address.startswith('192.168.') or ip_address.startswith('10.'):
        return None
    reader = _get_reader()
    if reader is None:
        return None
    try:
        result = reader.city(ip_address)
    except Exception:
        return None
    return {
        'city': result.city.name or '',
        'country': result.country.name or '',
        'latitude': result.location.latitude,
        'longitude': result.location.longitude,
    }


def reverse_geocode(latitude, longitude):
    """Endereço legível a partir de lat/lng via Nominatim (OpenStreetMap) —
    gratuito, mas com limite de 1 requisição/segundo, então só deve ser
    chamado em ações pontuais (login/logout), nunca em todo AuditLog criado."""
    if latitude is None or longitude is None:
        return ''
    try:
        r = requests.get(
            'https://nominatim.openstreetmap.org/reverse',
            params={'format': 'jsonv2', 'lat': latitude, 'lon': longitude, 'zoom': 18, 'addressdetails': 0},
            headers={'User-Agent': 'uneworld-sistema (audit-log-location)'},
            timeout=5,
        )
        if r.status_code == 200:
            return r.json().get('display_name', '') or ''
    except Exception:
        pass
    return ''

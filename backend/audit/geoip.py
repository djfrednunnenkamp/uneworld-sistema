"""Resolve IP -> localização aproximada usando o banco GeoLite2 (offline, sem
limite de consultas). Banco baixado via `python manage.py update_geoip`."""
import geoip2.database
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

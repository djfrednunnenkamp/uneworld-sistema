"""Cálculo do uso de armazenamento do Drive (Meus Documentos) por usuário.

Soma o tamanho dos ARQUIVOS que o usuário é dono (não as pastas, não a lixeira)
e classifica por tipo (PDF, Word, Planilha, Apresentação, Imagem, Vídeo, Outros)
para a visão bonita do consumo. O limite fica em UserPermissions.storage_limit_bytes
(null = ilimitado)."""
import os

# key → (rótulo, ícone/emoji, extensões, prefixos de mime)
CATEGORIES = [
    ('pdf',          'PDFs',           '📕', {'.pdf'},
     ('application/pdf',)),
    ('document',     'Documentos',     '📘', {'.doc', '.docx', '.odt', '.rtf', '.txt', '.md'},
     ('application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml',
      'application/vnd.oasis.opendocument.text', 'text/plain')),
    ('spreadsheet',  'Planilhas',      '📗', {'.xls', '.xlsx', '.ods', '.csv'},
     ('application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml',
      'application/vnd.oasis.opendocument.spreadsheet', 'text/csv')),
    ('presentation', 'Apresentações',  '📙', {'.ppt', '.pptx', '.odp'},
     ('application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml',
      'application/vnd.oasis.opendocument.presentation')),
    ('image',        'Imagens',        '🖼️', {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic', '.tiff'},
     ('image/',)),
    ('video',        'Vídeos',         '🎬', {'.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.m4v'},
     ('video/',)),
    ('audio',        'Áudios',         '🎵', {'.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'},
     ('audio/',)),
    ('archive',      'Compactados',    '🗜️', {'.zip', '.rar', '.7z', '.gz', '.tar'},
     ('application/zip', 'application/x-rar', 'application/x-7z', 'application/gzip', 'application/x-tar')),
]


def _category_of(name, mime):
    ext = os.path.splitext(name or '')[1].lower()
    mime = (mime or '').lower()
    for key, _label, _icon, exts, mimes in CATEGORIES:
        if ext in exts:
            return key
        if mime and any(mime.startswith(m) for m in mimes):
            return key
    return 'other'


def storage_usage(user):
    """Retorna o consumo de armazenamento do usuário no Drive.

    {
      'used_bytes':  int,
      'limit_bytes': int | None,   # None = ilimitado
      'file_count':  int,
      'categories':  [{'key','label','icon','count','bytes'}, ...],  # só as com arquivo, maior primeiro
    }
    """
    from .models import DriveNode
    from users_api.permissions import get_user_permissions

    files = DriveNode.objects.filter(
        owner=user, kind='file', is_deleted=False,
    ).values_list('name', 'mime_type', 'file_size')

    buckets = {}
    used = 0
    count = 0
    for name, mime, size in files.iterator():
        size = size or 0
        used += size
        count += 1
        key = _category_of(name, mime)
        b = buckets.setdefault(key, {'count': 0, 'bytes': 0})
        b['count'] += 1
        b['bytes'] += size

    meta = {key: (label, icon) for key, label, icon, _e, _m in CATEGORIES}
    meta['other'] = ('Outros', '📄')
    cats = []
    for key, b in buckets.items():
        label, icon = meta.get(key, ('Outros', '📄'))
        cats.append({'key': key, 'label': label, 'icon': icon, 'count': b['count'], 'bytes': b['bytes']})
    cats.sort(key=lambda c: c['bytes'], reverse=True)

    perms = get_user_permissions(user)
    return {
        'used_bytes':  used,
        'limit_bytes': perms.storage_limit_bytes,
        'file_count':  count,
        'categories':  cats,
    }


def would_exceed(user, extra_bytes):
    """True se adicionar `extra_bytes` ultrapassaria o limite do usuário.
    Sem limite (None) nunca estoura."""
    from users_api.permissions import get_user_permissions
    limit = get_user_permissions(user).storage_limit_bytes
    if not limit:
        return False
    used = storage_usage(user)['used_bytes']
    return (used + max(0, extra_bytes)) > limit

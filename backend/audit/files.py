"""Serviço central de auditoria de ARQUIVOS.

Toda operação com arquivo (upload/download/geração/exportação/substituição/
exclusão) grava, junto do log, uma REFERÊNCIA ESTRUTURADA em `changes['_file']`
— o suficiente para localizar e pré-visualizar o arquivo depois, mesmo que o
registro dono tenha mudado ou sumido.

Princípios:
  * Não salvamos URL (assinada/temporária expira). Guardamos a CHAVE de storage
    (`storage_name`), que é um identificador permanente, e geramos o acesso na
    hora da visualização.
  * Não duplicamos o arquivo no banco. Só metadados.
  * Um arquivo REMOVIDO ainda mostra os metadados históricos (nome/tipo/tamanho)
    — o modal deixa claro que o conteúdo não está mais disponível, sem quebrar.
  * Versões: quando existir versionamento físico (Drive), a `storage_name` aponta
    para o arquivo DAQUELA versão — o log abre a versão exata, não a mais recente.

Este módulo é reutilizável por qualquer app; nada aqui é específico de uma tela.
"""
import os
import mimetypes

# ── Classificação de formato (única no backend) ─────────────────────────────
KIND_BY_EXT = {}
def _reg(kind, exts):
    for e in exts:
        KIND_BY_EXT[e] = kind
_reg('image',        ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico', 'heic', 'heif', 'tif', 'tiff'])
_reg('video',        ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv', 'avi'])
_reg('audio',        ['mp3', 'wav', 'oga', 'ogg', 'm4a', 'aac', 'flac'])
_reg('pdf',          ['pdf'])
_reg('text',         ['txt', 'log', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'html', 'htm', 'ini', 'conf'])
_reg('document',     ['doc', 'docx', 'odt', 'rtf'])
_reg('spreadsheet',  ['xls', 'xlsx', 'ods'])
_reg('presentation', ['ppt', 'pptx', 'odp'])
_reg('archive',      ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'])

# Tipos de texto que o navegador poderia executar como código → nunca servir com
# o content-type real inline; servir como texto puro (sem execução no modal).
UNSAFE_INLINE = {'html', 'htm', 'svg', 'xml', 'xhtml'}

# Acima disso, não carregar o conteúdo automaticamente — exige ação explícita.
LARGE_FILE_BYTES = 25 * 1024 * 1024   # 25 MB


def ext_of(name):
    return (os.path.splitext(name or '')[1].lstrip('.') or '').lower()


# MIME por extensão para os formatos que o mimetypes do sistema às vezes não sabe.
_EXTRA_MIME = {
    'pdf': 'application/pdf', 'csv': 'text/csv', 'json': 'application/json',
    'svg': 'image/svg+xml', 'webp': 'image/webp', 'avif': 'image/avif',
    'heic': 'image/heic', 'heif': 'image/heif', 'mkv': 'video/x-matroska',
    'webm': 'video/webm', 'ogv': 'video/ogg', 'm4v': 'video/x-m4v',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'zip': 'application/zip',
}


def guess_mime(name, fallback='application/octet-stream'):
    """MIME confiável a partir do nome (extensão). Usado quando o mime salvo está
    vazio — é o que corrige o preview servido como octet-stream."""
    e = ext_of(name)
    if e in _EXTRA_MIME:
        return _EXTRA_MIME[e]
    return mimetypes.guess_type(name or '')[0] or fallback


def kind_for(mime='', name=''):
    """Estratégia de visualização a partir do MIME e/ou nome. Prioriza a extensão
    (mais confiável que MIME genérico), com fallback pelo prefixo do MIME."""
    e = ext_of(name)
    if e in KIND_BY_EXT:
        return KIND_BY_EXT[e]
    m = (mime or '').lower()
    if m.startswith('image/'):
        return 'image'
    if m.startswith('video/'):
        return 'video'
    if m.startswith('audio/'):
        return 'audio'
    if m == 'application/pdf':
        return 'pdf'
    if m.startswith('text/') or m in ('application/json', 'application/xml'):
        return 'text'
    if 'wordprocessing' in m or m == 'application/msword':
        return 'document'
    if 'spreadsheet' in m or m == 'application/vnd.ms-excel':
        return 'spreadsheet'
    if 'presentation' in m or m == 'application/vnd.ms-powerpoint':
        return 'presentation'
    if m in ('application/zip', 'application/x-zip-compressed', 'application/gzip', 'application/x-tar'):
        return 'archive'
    return 'other'


def human_size(n):
    try:
        n = float(n or 0)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if n < 1024 or unit == 'TB':
            return (f'{int(n)} {unit}' if unit == 'B' else f'{n:.1f} {unit}')
        n /= 1024


def safe_inline_content_type(mime, name):
    """Content-type seguro para exibir INLINE (dentro do modal). Formatos que o
    navegador poderia executar (HTML/SVG/XML) são rebaixados a texto puro."""
    if ext_of(name) in UNSAFE_INLINE:
        return 'text/plain; charset=utf-8'
    return mime or 'application/octet-stream'


# ── Captura de metadados a partir de um FieldFile ───────────────────────────
def meta_from_fieldfile(fieldfile, *, original_name=None, mime=None, size=None,
                        version_id=None, kind=None):
    """Monta o dict estruturado `_file` a partir de um FieldFile (ou None).
    `original_name`/`mime`/`size` sobrescrevem o que der pra inferir do arquivo."""
    if not fieldfile:
        return None
    try:
        storage_name = fieldfile.name
    except Exception:
        storage_name = None
    if not storage_name:
        return None
    display = original_name or os.path.basename(storage_name)
    if size is None:
        try:
            size = fieldfile.size
        except Exception:
            size = None
    # MIME: usa o informado; senão adivinha pela extensão (nome amigável ou chave).
    # Sem isso, o preview era servido como octet-stream e o visualizador falhava.
    resolved_mime = mime or guess_mime(display, fallback='') or guess_mime(storage_name, fallback='')
    meta = {
        'name': display,
        'storage_name': storage_name,
        'ext': ext_of(display) or ext_of(storage_name),
        'mime': resolved_mime or '',
        'size': size,
    }
    meta['kind'] = kind or kind_for(meta['mime'], meta['name'])
    if version_id is not None:
        meta['version_id'] = version_id
    return {k: v for k, v in meta.items() if v is not None}


def capture_instance_file(instance):
    """Acha o 1º FileField/ImageField preenchido do modelo e devolve o `_file`.
    Usa `original_name`/`mime_type`/`file_size` do próprio modelo quando existirem
    (nomes comuns nos modelos do sistema)."""
    from django.db.models import FileField
    for f in instance._meta.concrete_fields:
        if isinstance(f, FileField):
            try:
                ff = getattr(instance, f.name, None)
            except Exception:
                ff = None
            if ff:
                return meta_from_fieldfile(
                    ff,
                    original_name=getattr(instance, 'original_name', None) or None,
                    mime=getattr(instance, 'mime_type', None) or '',
                    size=getattr(instance, 'file_size', None) or None,
                )
    return None


def attach_file(changes, fieldfile=None, *, meta=None, **kw):
    """Anexa a referência `_file` a um dict de `changes` (mutando e retornando).
    Passe um FieldFile OU um `meta` já pronto."""
    changes = dict(changes or {})
    m = meta if meta is not None else meta_from_fieldfile(fieldfile, **kw)
    if m:
        changes['_file'] = m
    return changes


def log_file_event(action, *, file=None, meta=None, model_name, model_label,
                   object_id='', object_repr='', changes=None, user=None, **file_kw):
    """Atalho central: `log_event` já com a referência estruturada do arquivo.
    Use em uploads/downloads/gerações que os signals não cobrem."""
    from .tracking import log_event
    changes = attach_file(changes, file, meta=meta, **file_kw)
    log_event(action, model_name=model_name, model_label=model_label,
              object_id=object_id, object_repr=object_repr, changes=changes, user=user)


# ── Resolução do arquivo de um log (para servir/inspecionar) ────────────────
# Logs ANTIGOS (sem `_file`) caem neste mapa: model_name -> (app.Model, campo|callable).
# O 2º item é o nome do FileField OU um callable(obj, log) -> FieldFile.
FILE_MODELS = {
    'ItineraryImage':           ('itineraries.ItineraryImage', 'image'),
    'ItineraryDocument':        ('itineraries.ItineraryDocument', 'file'),
    'VideoExport':              ('itineraries.VideoExport', 'file'),
    'ConfigHotelMedia':         ('config_api.ConfigHotelMedia', 'file'),
    'ConfigBoatMedia':          ('config_api.ConfigBoatMedia', 'file'),
    'PassengerDocument':        ('passengers.PassengerDocument', 'file'),
    'Airline':                  ('config_api.Airline', 'logo'),
    'OperatingCompany':         ('config_api.OperatingCompany', 'ceo_signature'),
    'Agency':                   ('agencies.Agency', 'logo'),
    'UserPermissions':          ('users_api.UserPermissions', 'avatar'),
    'DriveNode':                ('drive.DriveNode', 'file'),
    'DriveNodeVersion':         ('drive.DriveNodeVersion', 'file'),
    'VoucherFlightConfirmation':('vouchers.VoucherFlightConfirmation', 'image'),
    # Contrato tem 2 arquivos — o log diz qual em changes['_file_field'].
    'Contract':                 ('contracts.Contract',
                                 lambda obj, log: getattr(obj, (log.changes or {}).get('_file_field'), None)
                                 if (log.changes or {}).get('_file_field') else None),
}


def _stored_meta(log):
    m = (log.changes or {}).get('_file')
    return m if isinstance(m, dict) else None


def _candidate_storages():
    """Storages onde um arquivo de log pode estar. Mídia PÚBLICA (logos, imagens de
    roteiro, avatares, vouchers) vive no storage `public_media` (S3 em prod); docs
    sensíveis e os artefatos de auditoria ficam no `default` (local). A mesma chave
    relativa é usada nos dois — então tentamos ambos, sem depender do backend."""
    from django.core.files.storage import default_storage, storages
    out = [default_storage]
    try:
        pub = storages['public_media']
        if pub is not default_storage:
            out.append(pub)
    except Exception:
        pass
    return out


def _open_by_storage_name(storage_name):
    """Abre um arquivo pela chave de storage (identificador permanente), procurando
    no storage certo (local OU S3). Protege contra path traversal — a chave tem que
    ser relativa e sem '..'."""
    if not storage_name or storage_name.startswith('/') or '..' in storage_name.split('/'):
        return None
    for st in _candidate_storages():
        try:
            if st.exists(storage_name):
                return st.open(storage_name, 'rb')
        except Exception:
            continue
    return None


def resolve_log_file(log):
    """Resolve o arquivo apontado por um log.

    Retorna (fh_or_None, meta_dict, status), status ∈
      'ok'        arquivo disponível para servir (fh aberto)
      'removed'   há referência estruturada, mas o conteúdo não existe mais
      'no_file'   este log não é de arquivo
      'model_gone'modelo/registro indisponível (logs antigos sem `_file`)
      'legacy'    log antigo sem referência estruturada suficiente
    O `meta_dict` (nome/tipo/tamanho/kind/version) vem do `_file` histórico quando
    houver — então metadados aparecem mesmo com o conteúdo removido.
    """
    stored = _stored_meta(log)

    # 1) Referência estruturada (caminho preferido). Abre a chave de storage exata
    #    daquela ação/versão, mesmo que o registro dono tenha mudado/sumido.
    if stored:
        fh = _open_by_storage_name(stored.get('storage_name'))
        return (fh, stored, 'ok' if fh else 'removed')

    # 2) Logs antigos: tenta o mapa por modelo (arquivo vivo do registro).
    spec = FILE_MODELS.get(log.model_name)
    if not spec or not log.object_id:
        return (None, None, 'no_file')
    from django.apps import apps
    try:
        Model = apps.get_model(spec[0])
    except Exception:
        return (None, None, 'model_gone')
    obj = Model.objects.filter(pk=log.object_id).first()
    if not obj:
        return (None, None, 'model_gone')
    ff = spec[1](obj, log) if callable(spec[1]) else getattr(obj, spec[1], None)
    if not ff:
        # Cobre também o caso do Contrato "baixou o PDF" (gerado no navegador, sem
        # cópia no servidor) e do log antigo sem arquivo servível.
        return (None, None, 'legacy')
    meta = meta_from_fieldfile(
        ff,
        original_name=getattr(obj, 'original_name', None) or None,
        mime=getattr(obj, 'mime_type', None) or '',
        size=getattr(obj, 'file_size', None) or None,
    )
    try:
        return (ff.open('rb'), meta, 'ok')
    except FileNotFoundError:
        return (None, meta, 'removed')


def has_servable_file(log):
    """Rápido (sem tocar em disco): o log APONTA para algum arquivo?

    A referência estruturada `_file` é a fonte da verdade (logs novos). Para logs
    ANTIGOS (sem `_file`), caímos no mapa de modelos — mas só marcamos ações que
    são de fato operação com arquivo (upload/download), para NÃO poluir a lista
    com indicador em renomear/mover/compartilhar/etc."""
    if _stored_meta(log):
        return True
    spec = FILE_MODELS.get(log.model_name)
    if not spec or not log.object_id:
        return False
    if callable(spec[1]):
        # Contrato: só os eventos de download apontam para arquivo armazenado.
        return log.action == 'download'
    return log.action in ('upload', 'download')


def file_kind_of(log):
    """Kind do arquivo para o indicador discreto na LISTA (sem tocar em disco)."""
    stored = _stored_meta(log)
    if stored:
        return stored.get('kind') or kind_for(stored.get('mime', ''), stored.get('name', ''))
    spec = FILE_MODELS.get(log.model_name)
    if not spec:
        return None
    field = spec[1]
    if field in ('image', 'logo', 'ceo_signature', 'avatar', 'thumbnail'):
        return 'image'
    return 'file'


def file_info_for_log(log):
    """Metadados completos + disponibilidade para o modal (SEM baixar o conteúdo).
    Nunca expõe caminho interno/chave de storage."""
    stored = _stored_meta(log)
    spec = FILE_MODELS.get(log.model_name)

    if not stored and not (spec and log.object_id and has_servable_file(log)):
        # Log antigo/sem referência: não inventa associação por nome.
        return {
            'available': False,
            'status': 'legacy',
            'message': 'Este log foi criado antes da implementação da visualização de '
                       'arquivos e não possui uma referência suficiente para localizar o conteúdo.',
            'action': log.action,
        }

    fh, meta, status = resolve_log_file(log)
    if fh:
        try:
            fh.close()
        except Exception:
            pass
    meta = meta or stored or {}
    name = meta.get('name') or (log.object_repr or 'arquivo')
    mime = meta.get('mime') or guess_mime(name, fallback='')
    ext  = meta.get('ext') or ext_of(name)
    kind = meta.get('kind') or kind_for(mime, name)
    size = meta.get('size')
    return {
        'available': status == 'ok',
        'status': status,
        'name': name,
        'ext': ext,
        'mime': mime,
        'kind': kind,
        'size': size,
        'size_h': human_size(size),
        'too_large': bool(size and size > LARGE_FILE_BYTES),
        'version_id': meta.get('version_id'),
        'action': log.action,
        'module': log.model_label,
        'record': {
            'model_name': log.model_name,
            'label': log.model_label,
            'object_id': log.object_id,
            'repr': log.object_repr,
        },
        'description': log.object_repr,
    }

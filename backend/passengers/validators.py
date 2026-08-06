"""
Validação segura de uploads de documentos.
Estratégia em camadas para prevenir ataques via arquivos maliciosos.

IMAGENS: este módulo NÃO reimplementa processamento de imagem — ele é o funil
histórico que as views/serializers já chamam e delega tudo para o serviço
central `core.images` (validação real do conteúdo, normalização, remoção de
metadados e conversão para WebP). Ver core/images.py.
"""
import io
import os
from django.core.exceptions import ValidationError
from PIL import Image, UnidentifiedImageError

from core import images as imgsvc

MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB (documentos; imagem usa o limite do core)

#: Extensões de IMAGEM aceitas em qualquer campo de imagem do sistema.
IMAGE_EXTENSIONS = set(imgsvc.INPUT_EXTENSIONS)

ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS | {'.pdf'}

MAX_IMAGE_PIXELS = imgsvc.MAX_PIXELS  # compat: proteção contra image bombs


def _detect_type(header: bytes) -> str | None:
    """'image' (qualquer formato raster suportado) | 'pdf' | None."""
    if header.startswith(b'%PDF'):
        return 'pdf'
    return 'image' if imgsvc.sniff_image_kind(header) else None


def _kinds_label(allowed_exts, allow_images=True):
    """Rótulo legível com os formatos realmente aceitos — deixa as mensagens de
    erro específicas."""
    exts = set(allowed_exts) if allow_images else {'.pdf'}
    names = []
    if exts & IMAGE_EXTENSIONS:
        names.append(imgsvc.INPUT_LABEL)
    if '.pdf' in exts:
        names.append('PDF')
    if not names:
        return 'arquivo'
    return names[0] if len(names) == 1 else ' ou '.join(names)


def validate_document_file(file, allowed_exts=None, allow_images=True, *,
                           preset='photo', flatten_bg=None):
    """
    Valida um upload e, quando for IMAGEM, devolve a versão processada em WebP
    (conteúdo re-encodado, sem EXIF/GPS/ICC). PDF passa validado, sem conversão.

    allowed_exts/allow_images restringem os tipos aceitos (ex.: só PDF no
    contrato assinado: allowed_exts={'.pdf'}, allow_images=False).
    """
    allowed_exts = set(allowed_exts) if allowed_exts else set(ALLOWED_EXTENSIONS)
    # Quem passa a lista antiga {'.jpg','.jpeg','.png','.webp'} continua valendo,
    # mas agora significa "aceita imagem" — os formatos novos (HEIC/AVIF/GIF)
    # entram junto. A autoridade é a assinatura do conteúdo, não a extensão.
    if allow_images and allowed_exts & IMAGE_EXTENSIONS:
        allowed_exts |= IMAGE_EXTENSIONS
    kinds_label = _kinds_label(allowed_exts, allow_images)

    ext = os.path.splitext(file.name or '')[1].lower()

    # Camada 1 — assinatura do conteúdo (é ela que manda, não a extensão)
    file.seek(0)
    header = file.read(32)
    file.seek(0)
    detected = _detect_type(header)
    if detected is None:
        raise ValidationError(
            f'Arquivo rejeitado: o conteúdo não corresponde a um {kinds_label} válido.'
        )
    if detected == 'image' and not allow_images:
        raise ValidationError('Apenas arquivos PDF são aceitos aqui.')
    if detected == 'pdf' and '.pdf' not in allowed_exts:
        raise ValidationError('PDF não é aceito neste campo.')
    if detected == 'image' and not (allowed_exts & IMAGE_EXTENSIONS):
        raise ValidationError('Imagem não é aceita neste campo.')
    # Extensão mentindo sobre o conteúdo: rejeita explicitamente (o inverso —
    # conteúdo de imagem com extensão de imagem diferente — é tolerado, porque a
    # saída é sempre re-encodada em WebP mesmo).
    if detected == 'pdf' and ext != '.pdf':
        raise ValidationError('Conteúdo PDF com extensão de imagem. Arquivo rejeitado.')
    if detected == 'image' and ext == '.pdf':
        raise ValidationError('Conteúdo de imagem com extensão .pdf. Arquivo rejeitado.')

    if detected == 'pdf':
        # Camada 2 (PDF) — tamanho. Sem re-encode: PDF não passa pelo pipeline
        # de imagem (nem por nenhum outro; ele é servido por view autenticada).
        if file.size > MAX_FILE_SIZE:
            raise ValidationError(
                f'Arquivo muito grande ({file.size // 1024 // 1024} MB). Máximo: 15 MB.'
            )
        return file

    # Camada 2 (imagem) — pipeline central: decodifica, normaliza, limpa e
    # converte para WebP. Devolve um arquivo NOVO (nunca os bytes originais).
    processed = imgsvc.process_image(file, preset=preset, flatten_bg=flatten_bg)
    return _as_uploaded(processed, file)


def _as_uploaded(processed, origem):
    """Embrulha a imagem processada num arquivo com cara de upload (`.name`,
    `.size`, `.content_type`), para os call sites que só repassam adiante."""
    from django.core.files.uploadedfile import InMemoryUploadedFile
    buf = io.BytesIO(processed.content.read())
    processed.content.seek(0)
    buf.seek(0)
    field_name = getattr(origem, 'field_name', None) or 'file'
    return InMemoryUploadedFile(
        buf, field_name, processed.name, imgsvc.CONTENT_TYPE, processed.size, None
    )


# ── Vídeo ────────────────────────────────────────────────────────────────────
MAX_VIDEO_SIZE = 200 * 1024 * 1024  # 200 MB
# Conjunto CONSERVADOR: formatos que os navegadores tocam CRUS (sem conversão).
# Usado onde a mídia é servida como está (galerias de hotéis/barcos em config_api).
VIDEO_EXTENSIONS = {'.mp4', '.webm', '.mov', '.m4v', '.ogv', '.ogg'}
# Conjunto EXPANDIDO: aceito só na Galeria de roteiros, que NORMALIZA todo vídeo
# para MP4/H.264 no servidor (itineraries.services.video). Como sempre convertemos,
# aceitamos os contêineres comuns que o FFmpeg lê. A validação definitiva do
# conteúdo é o ffprobe no processamento; aqui é a 1ª barreira (extensão + tamanho +
# sniff). Mantido em sincronia com ItineraryImage.VIDEO_EXTS.
GALLERY_VIDEO_EXTENSIONS = VIDEO_EXTENSIONS | {
    '.mkv', '.avi', '.mpeg', '.mpg', '.3gp', '.3g2', '.wmv', '.flv'}
# Átomos iniciais (bytes 4-8) de contêineres MP4/MOV (ISO BMFF / QuickTime).
_MP4_ATOMS = {b'ftyp', b'moov', b'mdat', b'free', b'skip', b'wide', b'pnot'}


# ── Anexos de documento (painel de Observações do roteiro) ───────────────────
MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024  # 25 MB
ATTACHMENT_EXTENSIONS = {'.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf'}
_OOXML_EXT = {'.docx', '.xlsx', '.pptx'}          # Office moderno = pacote ZIP (PK)
_LEGACY_OFFICE_EXT = {'.doc', '.xls', '.ppt'}     # Office legado = OLE2 (D0 CF 11 E0)
_OLE2_MAGIC = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'


def validate_attachment_file(file):
    """Valida um anexo Office/PDF (extensão × tamanho × magic bytes do contêiner).
    Bloqueia qualquer conteúdo que não seja Word/Excel/PowerPoint/PDF — impede
    subir executáveis, HTML/SVG (XSS), etc. driblando o front. Não re-processa
    (docs Office são pacotes ZIP; o OnlyOffice é quem abre)."""
    ext = os.path.splitext(file.name or '')[1].lower()
    if ext not in ATTACHMENT_EXTENSIONS:
        raise ValidationError(
            f'Extensão "{ext or "?"}" não permitida. Aceitos: Word, Excel, PowerPoint ou PDF.'
        )
    if file.size > MAX_ATTACHMENT_SIZE:
        raise ValidationError(
            f'Arquivo muito grande ({file.size // 1024 // 1024} MB). Máximo: 25 MB.'
        )
    file.seek(0)
    header = file.read(8)
    file.seek(0)
    is_pdf = header.startswith(b'%PDF')
    is_zip = header.startswith(b'PK\x03\x04')      # OOXML (docx/xlsx/pptx) e também .zip
    is_ole = header.startswith(_OLE2_MAGIC)         # doc/xls/ppt legado
    if ext == '.pdf':
        if not is_pdf:
            raise ValidationError('O conteúdo não corresponde a um PDF válido. Arquivo rejeitado.')
    elif ext in _OOXML_EXT:
        if not is_zip:
            raise ValidationError('O conteúdo não corresponde a um arquivo Office (.docx/.xlsx/.pptx) válido.')
    elif ext in _LEGACY_OFFICE_EXT:
        if not is_ole:
            raise ValidationError('O conteúdo não corresponde a um arquivo Office válido.')
    return file


# ── Anexo livre (documentos do roteiro): aceita QUALQUER arquivo, exceto os
#    perigosos (executáveis, scripts, HTML/SVG que abririam brecha de XSS ao serem
#    servidos inline). Denylist por extensão + limite de tamanho. ──
MAX_ANY_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
_DANGEROUS_EXTENSIONS = {
    '.html', '.htm', '.xhtml', '.shtml', '.svg', '.xml', '.js', '.mjs', '.jsx',
    '.php', '.phtml', '.php3', '.php4', '.php5', '.pht', '.asp', '.aspx', '.jsp',
    '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.sh', '.bash', '.ps1',
    '.vbs', '.vbe', '.wsf', '.wsh', '.hta', '.jar', '.dll', '.so', '.dylib',
    '.app', '.deb', '.rpm', '.apk', '.reg',
}


def validate_any_upload_file(file):
    """Valida um anexo LIVRE (documentos do roteiro): aceita qualquer arquivo
    (fotos, e-mails, Office, PDF, ZIP…) desde que não seja de um tipo perigoso
    (executável/script/HTML/SVG) e respeite o limite de tamanho."""
    ext = os.path.splitext(file.name or '')[1].lower()
    if ext in _DANGEROUS_EXTENSIONS:
        raise ValidationError(
            f'Arquivos "{ext}" não são permitidos por segurança. '
            'Envie fotos, e-mails, PDF, Office, ZIP ou similares.'
        )
    if file.size > MAX_ANY_FILE_SIZE:
        raise ValidationError(
            f'Arquivo muito grande ({file.size // 1024 // 1024} MB). Máximo: 50 MB.'
        )
    return file


def validate_media_file(file):
    """Valida IMAGEM (convertida para WebP) OU VÍDEO (mp4/webm/…) para galerias
    (hotel/barco). Nunca confia no content-type do cliente. Retorna
    ('image'|'video', arquivo) — a imagem volta JÁ PROCESSADA, o vídeo volta como
    veio (o pipeline de vídeo é outro e não é tocado aqui)."""
    ext = os.path.splitext(file.name or '')[1].lower()
    if ext in VIDEO_EXTENSIONS:
        validate_video_file(file)
        return 'video', file
    return 'image', validate_document_file(file, allowed_exts=IMAGE_EXTENSIONS, allow_images=True)


def validate_video_file(file, allowed_exts=None):
    """Valida um upload de VÍDEO (extensão, tamanho e magic bytes do contêiner).
    `allowed_exts` restringe as extensões (padrão: VIDEO_EXTENSIONS, tocáveis crus;
    a Galeria passa GALLERY_VIDEO_EXTENSIONS por normalizar tudo depois). Levanta
    ValidationError se algo estiver fora do esperado."""
    allowed_exts = set(allowed_exts) if allowed_exts else set(VIDEO_EXTENSIONS)
    ext = os.path.splitext(file.name or '')[1].lower()
    if ext not in allowed_exts:
        raise ValidationError(
            f'Extensão "{ext}" não permitida para vídeo.'
        )
    if file.size > MAX_VIDEO_SIZE:
        raise ValidationError(
            f'Vídeo muito grande ({file.size // 1024 // 1024} MB). Máximo: 200 MB.'
        )
    file.seek(0)
    header = file.read(16)
    file.seek(0)
    if not _looks_like_video(header):
        raise ValidationError('Arquivo rejeitado: o conteúdo não parece um vídeo válido.')
    return file


def _looks_like_video(header: bytes) -> bool:
    """Sniff leve do contêiner pelos primeiros bytes (barreira rápida no upload;
    o ffprobe é a validação definitiva no processamento)."""
    if len(header) < 8:
        return False
    checks = (
        header[4:8] in _MP4_ATOMS,                 # MP4/MOV/M4V/3GP (ISO BMFF/QuickTime)
        header.startswith(b'\x1aE\xdf\xa3'),       # EBML (WebM/MKV)
        header.startswith(b'OggS'),                # OGG/OGV
        header[:4] == b'RIFF' and header[8:12] == b'AVI ',  # AVI
        header.startswith(b'\x00\x00\x01\xba'),    # MPEG program stream
        header.startswith(b'\x00\x00\x01\xb3'),    # MPEG video sequence
        header[0] == 0x47,                         # MPEG-TS (sync byte)
        header.startswith(b'FLV'),                 # Flash Video
        header.startswith(b'0&\xb2u'),             # ASF/WMV (30 26 B2 75)
    )
    return any(checks)


# ── Recorte não-destrutivo (logos/avatar) ──────────────────────────────────────
# Guardamos SEMPRE a imagem original + os dados de enquadramento (crop). Estas
# helpers abrem/verificam/re-encodam a imagem enviada, descartando payload/EXIF.

def sanitize_image(f, *, fmt='PNG', max_dim=2000, bg=(255, 255, 255), max_bytes=8 * 1024 * 1024):
    """Abre, VALIDA e re-encoda uma imagem em WebP (descarta payload/EXIF/GPS/ICC),
    limitando a maior dimensão a `max_dim`. Devolve um ContentFile pronto para
    `.save()`. Levanta ValidationError se o arquivo não for uma imagem válida.

    `fmt` é histórico e hoje só decide a TRANSPARÊNCIA: 'JPEG' achata sobre `bg`
    (campos que não podem ter alfa, como a foto de perfil); qualquer outro valor
    preserva o alfa. O formato gravado é sempre WebP — ver core/images.py."""
    processed = imgsvc.process_image(
        f,
        max_dim=max_dim,
        max_bytes=max_bytes,
        flatten_bg=tuple(bg) if fmt == 'JPEG' else None,
    )
    return processed.content


def parse_crop(raw):
    """Lê o JSON de enquadramento {u,v,du,dv,fw,fh} enviado pelo cliente. Devolve um
    dict só com números válidos, ou {} se inválido/ausente."""
    import json
    if not raw:
        return {}
    try:
        d = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(d, dict):
            return {}
    except (ValueError, TypeError):
        return {}
    out = {}
    for k in ('u', 'v', 'du', 'dv', 'fw', 'fh'):
        v = d.get(k)
        if isinstance(v, (int, float)):
            out[k] = float(v)
    return out

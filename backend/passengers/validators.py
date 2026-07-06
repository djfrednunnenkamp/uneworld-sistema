"""
Validação segura de uploads de documentos.
Estratégia em 4 camadas para prevenir ataques via arquivos maliciosos.
"""
import io
import os
from django.core.exceptions import ValidationError
from PIL import Image, UnidentifiedImageError

MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB

ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.pdf'}

# Magic bytes das extensões permitidas
MAGIC_SIGNATURES = {
    b'\xff\xd8\xff':       'image',  # JPEG
    b'\x89PNG\r\n\x1a\n': 'image',  # PNG
    b'%PDF':               'pdf',    # PDF
}

MAX_IMAGE_PIXELS = 50_000_000  # 50 MP — proteção contra image bombs


def _detect_type(header: bytes) -> str | None:
    # WEBP: contêiner RIFF ('RIFF' + 4 bytes de tamanho + 'WEBP').
    if header[:4] == b'RIFF' and header[8:12] == b'WEBP':
        return 'image'
    for sig, kind in MAGIC_SIGNATURES.items():
        if header.startswith(sig):
            return kind
    return None


def _kinds_label(allowed_exts, allow_images=True):
    """Rótulo legível com os formatos realmente aceitos (ex.: 'JPEG, PNG, WEBP
    ou PDF') — deixa as mensagens de erro específicas."""
    exts = allowed_exts if allow_images else {'.pdf'}
    names = []
    if exts & {'.jpg', '.jpeg'}: names.append('JPEG')
    if '.png' in exts:  names.append('PNG')
    if '.webp' in exts: names.append('WEBP')
    if '.pdf' in exts:  names.append('PDF')
    if not names: return 'arquivo'
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} ou {names[-1]}"


def validate_document_file(file, allowed_exts=None, allow_images=True):
    """
    Valida e (para imagens) re-processa um arquivo uploaded.
    Retorna o InMemoryUploadedFile limpo ou levanta ValidationError.

    allowed_exts/allow_images restringem os tipos aceitos (ex.: só PDF no
    contrato assinado: allowed_exts={'.pdf'}, allow_images=False).
    """
    allowed_exts = set(allowed_exts) if allowed_exts else set(ALLOWED_EXTENSIONS)
    kinds_label = _kinds_label(allowed_exts, allow_images)

    # Camada 1 — tamanho
    if file.size > MAX_FILE_SIZE:
        raise ValidationError(
            f'Arquivo muito grande ({file.size // 1024 // 1024} MB). Máximo: 15 MB.'
        )

    # Camada 1 — extensão
    ext = os.path.splitext(file.name or '')[1].lower()
    if ext not in allowed_exts:
        raise ValidationError(
            f'Extensão "{ext}" não permitida. Use: {kinds_label}.'
        )

    # Camada 2 — magic bytes
    file.seek(0)
    header = file.read(16)
    file.seek(0)

    detected = _detect_type(header)
    if detected is None:
        raise ValidationError(
            f'Arquivo rejeitado: o conteúdo não corresponde a um {kinds_label} válido.'
        )
    if detected == 'image' and not allow_images:
        raise ValidationError('Apenas arquivos PDF são aceitos aqui.')

    # Extensão × magic bytes devem ser compatíveis
    if detected == 'pdf' and ext not in ('.pdf',):
        raise ValidationError('Conteúdo PDF com extensão de imagem. Arquivo rejeitado.')
    if detected == 'image' and ext == '.pdf':
        raise ValidationError('Conteúdo de imagem com extensão .pdf. Arquivo rejeitado.')

    # Camada 3 — re-processamento via Pillow (apenas para imagens)
    if detected == 'image':
        file.seek(0)
        raw = file.read()
        file.seek(0)
        try:
            img = Image.open(io.BytesIO(raw))
            img.verify()                         # valida estrutura sem decodificar pixels
        except (UnidentifiedImageError, Exception):
            raise ValidationError('Imagem inválida ou corrompida.')

        # Re-abre após verify() (que fecha o stream)
        img = Image.open(io.BytesIO(raw))

        # Proteção contra image bomb
        w, h = img.size
        if w * h > MAX_IMAGE_PIXELS:
            raise ValidationError(
                f'Imagem muito grande ({w}×{h} px). Máximo: 50 megapixels.'
            )

        # Converte para RGB/RGBA limpo (remove EXIF, metadados e payloads).
        # Salva no formato da extensão: JPEG (sem alfa), PNG ou WEBP (com alfa).
        clean_format = 'JPEG' if ext in ('.jpg', '.jpeg') else 'WEBP' if ext == '.webp' else 'PNG'
        if clean_format == 'JPEG':
            # JPEG não suporta canal alfa — qualquer modo com transparência
            # (RGBA, LA, P-com-transparência) precisa virar RGB antes de salvar,
            # senão o Pillow levanta OSError ("cannot write mode RGBA as JPEG")
            if img.mode not in ('RGB', 'L'):
                img = img.convert('RGB')
        elif img.mode not in ('RGB', 'RGBA', 'L'):
            img = img.convert('RGB')

        out = io.BytesIO()
        if clean_format == 'JPEG':
            img.save(out, format='JPEG', optimize=True, quality=90)
        elif clean_format == 'WEBP':
            img.save(out, format='WEBP', quality=90)
        else:
            img.save(out, format='PNG', optimize=True)
        out.seek(0)

        # Substitui o conteúdo do arquivo pelo limpo
        file.seek(0)
        file.truncate(0)
        file.write(out.read())
        file.seek(0)

    return file


# ── Vídeo (galeria de roteiros) ──────────────────────────────────────────────
MAX_VIDEO_SIZE = 200 * 1024 * 1024  # 200 MB
VIDEO_EXTENSIONS = {'.mp4', '.webm', '.mov', '.m4v', '.ogv'}
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


def validate_media_file(file):
    """Valida IMAGEM (jpg/png, reprocessada) OU VÍDEO (mp4/webm/…) para galerias
    (hotel/barco/roteiro). Determina o tipo pela EXTENSÃO real — nunca confia no
    content-type enviado pelo cliente. Retorna 'image' ou 'video'."""
    ext = os.path.splitext(file.name or '')[1].lower()
    if ext in VIDEO_EXTENSIONS:
        validate_video_file(file)
        return 'video'
    validate_document_file(file, allowed_exts={'.jpg', '.jpeg', '.png', '.webp'}, allow_images=True)
    return 'image'


def validate_video_file(file):
    """Valida um upload de VÍDEO (extensão, tamanho e magic bytes do contêiner).
    Não re-processa o conteúdo (só imagens são reprocessadas). Levanta
    ValidationError se algo estiver fora do esperado."""
    ext = os.path.splitext(file.name or '')[1].lower()
    if ext not in VIDEO_EXTENSIONS:
        raise ValidationError(
            f'Extensão "{ext}" não permitida. Vídeos aceitos: MP4, WebM, MOV, M4V, OGV.'
        )
    if file.size > MAX_VIDEO_SIZE:
        raise ValidationError(
            f'Vídeo muito grande ({file.size // 1024 // 1024} MB). Máximo: 200 MB.'
        )
    file.seek(0)
    header = file.read(16)
    file.seek(0)
    is_mp4 = len(header) >= 8 and header[4:8] in _MP4_ATOMS
    is_webm = header.startswith(b'\x1aE\xdf\xa3')   # EBML (WebM/MKV)
    is_ogg = header.startswith(b'OggS')             # OGG (OGV)
    if not (is_mp4 or is_webm or is_ogg):
        raise ValidationError('Arquivo rejeitado: o conteúdo não parece um vídeo válido.')
    return file

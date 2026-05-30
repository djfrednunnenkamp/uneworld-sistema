"""
Validação segura de uploads de documentos.
Estratégia em 4 camadas para prevenir ataques via arquivos maliciosos.
"""
import io
import os
from django.core.exceptions import ValidationError
from PIL import Image, UnidentifiedImageError

MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB

ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.pdf'}

# Magic bytes das extensões permitidas
MAGIC_SIGNATURES = {
    b'\xff\xd8\xff':       'image',  # JPEG
    b'\x89PNG\r\n\x1a\n': 'image',  # PNG
    b'%PDF':               'pdf',    # PDF
}

MAX_IMAGE_PIXELS = 50_000_000  # 50 MP — proteção contra image bombs


def _detect_type(header: bytes) -> str | None:
    for sig, kind in MAGIC_SIGNATURES.items():
        if header.startswith(sig):
            return kind
    return None


def validate_document_file(file):
    """
    Valida e (para imagens) re-processa um arquivo uploaded.
    Retorna o InMemoryUploadedFile limpo ou levanta ValidationError.
    """
    # Camada 1 — tamanho
    if file.size > MAX_FILE_SIZE:
        raise ValidationError(
            f'Arquivo muito grande ({file.size // 1024 // 1024} MB). Máximo: 15 MB.'
        )

    # Camada 1 — extensão
    ext = os.path.splitext(file.name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValidationError(
            f'Extensão "{ext}" não permitida. Use: JPEG, PNG ou PDF.'
        )

    # Camada 2 — magic bytes
    file.seek(0)
    header = file.read(16)
    file.seek(0)

    detected = _detect_type(header)
    if detected is None:
        raise ValidationError(
            'Arquivo rejeitado: o conteúdo não corresponde a um JPEG, PNG ou PDF válido.'
        )

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

        # Converte para RGB/RGBA limpo (remove EXIF, metadados e payloads)
        clean_format = 'JPEG' if ext in ('.jpg', '.jpeg') else 'PNG'
        if img.mode not in ('RGB', 'RGBA', 'L'):
            img = img.convert('RGB')

        out = io.BytesIO()
        save_kwargs = {'format': clean_format, 'optimize': True}
        if clean_format == 'JPEG':
            save_kwargs['quality'] = 90
        img.save(out, **save_kwargs)
        out.seek(0)

        # Substitui o conteúdo do arquivo pelo limpo
        file.seek(0)
        file.truncate(0)
        file.write(out.read())
        file.seek(0)

    return file

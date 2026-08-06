"""Serviço CENTRAL de processamento de imagem do sistema.

Todo upload de imagem do UneWorld passa por aqui — avatar, logos (branding,
agência, companhia aérea), foto de passageiro, imagem de destino, galeria e
lâminas do roteiro, pontos do mapa, mídia de hotel/barco, confirmação de voo do
voucher, comprovante em imagem do contrato. Não existe um segundo pipeline: os
módulos chamam `process_image()` (ou os funis de `passengers.validators`, que
delegam para cá).

    UPLOAD → validação → decodificação → normalização → remoção de metadados
           → conversão WebP → storage → banco guarda a referência

Por que WebP: é o formato canônico dos arquivos NOVOS. Arquivos antigos (JPEG/
PNG/WebP já no S3) continuam sendo servidos como estão — nada é reconvertido
automaticamente (ver o comando `converter_imagens_webp`).

SEGURANÇA (o backend nunca confia no nome nem no Content-Type do navegador):
  - assinatura (magic bytes) do conteúdo real, não a extensão;
  - decodificação de verdade pelo Pillow (verify + load) — arquivo que não abre
    é rejeitado, inclusive truncado/corrompido;
  - limites de bytes, de lado, de megapixels e guarda de decompression bomb;
  - EXIF/GPS/comentários/ICC não sobrevivem: a saída é re-encodada a partir dos
    pixels decodificados, então nenhum byte do arquivo original é devolvido ao
    navegador;
  - o nome no storage é gerado pelo servidor (uuid), nunca derivado do nome
    enviado — sem path traversal.
"""
from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError

logger = logging.getLogger(__name__)

# HEIC/HEIF (fotos de iPhone/iPad) exigem o pillow-heif; AVIF já vem no Pillow
# ≥ 11.3. O registro é feito UMA vez, aqui, e o resto do sistema só usa Pillow.
try:  # pragma: no cover - depende do ambiente
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIF_SUPPORTED = True
except Exception:  # pragma: no cover - ambiente sem a lib
    HEIF_SUPPORTED = False

try:
    from PIL import features

    AVIF_SUPPORTED = bool(features.check('avif'))
except Exception:  # pragma: no cover
    AVIF_SUPPORTED = False


# ── Limites (configuráveis pelo settings/.env) ───────────────────────────────

def _cfg(name, default):
    return getattr(settings, name, default)


#: Bytes máximos do arquivo ENVIADO (antes de processar).
MAX_UPLOAD_BYTES = _cfg('IMAGE_UPLOAD_MAX_BYTES', 25 * 1024 * 1024)
#: Megapixels máximos da imagem decodificada (guarda de image bomb).
MAX_PIXELS = _cfg('IMAGE_MAX_PIXELS', 50_000_000)
#: Lado máximo aceito na ENTRADA (barra imagens absurdamente alongadas).
MAX_INPUT_SIDE = _cfg('IMAGE_MAX_INPUT_SIDE', 20_000)
#: Qualidade do WebP. 88 preserva bem fotografia de destino (uso da operadora)
#: sem inflar o arquivo. Configurável por IMAGE_WEBP_QUALITY.
WEBP_QUALITY = _cfg('IMAGE_WEBP_QUALITY', 88)
#: Esforço do encoder (0–6). 6 = melhor compressão para a mesma qualidade.
WEBP_METHOD = _cfg('IMAGE_WEBP_METHOD', 6)

#: Presets de saída — o lado maior da imagem final por tipo de uso. Evita que
#: cada módulo invente o seu número.
PRESETS = {
    'photo':  _cfg('IMAGE_MAX_DIMENSION', 4000),   # fotos de destino/galeria/roteiro
    'logo':   1600,                                # logos e assinaturas
    'avatar': 1600,                                # foto de perfil / passageiro
    'thumb':  600,                                 # miniaturas
}

CONTENT_TYPE = 'image/webp'
OUTPUT_EXT = '.webp'

#: Extensões aceitas na ENTRADA. Só formatos raster que o pipeline sabe decodificar.
#: BMP/TIFF ficam de fora de propósito: o sistema nunca os aceitou e não há
#: demanda — não se amplia superfície de ataque sem necessidade.
INPUT_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.heif', '.gif'}

#: Rótulo para as mensagens de erro e para o front.
INPUT_LABEL = 'JPG, PNG, WebP, AVIF, HEIC/HEIF ou GIF'


# ── 1. Validação: o conteúdo REAL, não o nome ────────────────────────────────

# Marcas ISO-BMFF (caixa 'ftyp') de HEIC/HEIF/AVIF.
_BMFF_BRANDS = {
    b'avif', b'avis',                                    # AVIF
    b'heic', b'heix', b'heim', b'heis', b'hevc', b'hevx',  # HEIC
    b'mif1', b'msf1',                                    # HEIF genérico
}


def sniff_image_kind(header: bytes) -> str | None:
    """Identifica o formato pela ASSINATURA do arquivo. Devolve 'jpeg', 'png',
    'gif', 'webp', 'avif', 'heif' — ou None se não for imagem conhecida."""
    if len(header) < 12:
        return None
    if header.startswith(b'\xff\xd8\xff'):
        return 'jpeg'
    if header.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
    if header.startswith(b'GIF87a') or header.startswith(b'GIF89a'):
        return 'gif'
    if header[:4] == b'RIFF' and header[8:12] == b'WEBP':
        return 'webp'
    if header[4:8] == b'ftyp':
        brand = header[8:12]
        if brand in _BMFF_BRANDS:
            return 'avif' if brand in (b'avif', b'avis') else 'heif'
    return None


def _read_head(file, n=32) -> bytes:
    pos = file.tell() if hasattr(file, 'tell') else 0
    file.seek(0)
    head = file.read(n)
    file.seek(pos if isinstance(pos, int) else 0)
    return head or b''


def validate_image(file, *, max_bytes=None) -> str:
    """Primeira barreira: tamanho + assinatura real. Devolve o formato detectado.
    NÃO decodifica ainda (isso é `decode_image`). Levanta ValidationError."""
    max_bytes = max_bytes or MAX_UPLOAD_BYTES
    size = getattr(file, 'size', None)
    if size is not None and size <= 0:
        raise ValidationError('Arquivo vazio.')
    if size and size > max_bytes:
        raise ValidationError(
            f'Imagem muito grande ({size // 1024 // 1024} MB). '
            f'Máximo: {max_bytes // 1024 // 1024} MB.'
        )
    kind = sniff_image_kind(_read_head(file))
    if kind is None:
        raise ValidationError(
            f'O conteúdo do arquivo não é uma imagem válida. Use {INPUT_LABEL}.'
        )
    if kind == 'heif' and not HEIF_SUPPORTED:
        raise ValidationError(
            'Este servidor não consegue processar fotos HEIC/HEIF no momento. '
            'Envie a foto em JPG, PNG ou WebP.'
        )
    if kind == 'avif' and not AVIF_SUPPORTED:
        raise ValidationError(
            'Este servidor não consegue processar imagens AVIF no momento. '
            'Envie a imagem em JPG, PNG ou WebP.'
        )
    return kind


# ── 2. Decodificação ─────────────────────────────────────────────────────────

def decode_image(raw: bytes) -> Image.Image:
    """Abre a imagem DE VERDADE. `verify()` pega estrutura falsificada; `load()`
    pega truncamento/corrupção que só aparece ao ler os pixels. Devolve a imagem
    já carregada. Levanta ValidationError."""
    # Guarda de decompression bomb do próprio Pillow (o limite fica um pouco
    # acima do nosso, para o erro sair com a nossa mensagem).
    limite_anterior = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = int(MAX_PIXELS * 1.5)
    try:
        try:
            probe = Image.open(io.BytesIO(raw))
            probe.verify()
        except Image.DecompressionBombError:
            raise ValidationError('Imagem rejeitada: dimensões suspeitas (decompression bomb).')
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError, MemoryError):
            raise ValidationError('Imagem inválida ou corrompida.')

        # verify() consome o arquivo — reabre para trabalhar.
        try:
            img = Image.open(io.BytesIO(raw))
            w, h = img.size
            if w <= 0 or h <= 0:
                raise ValidationError('Imagem inválida (dimensões vazias).')
            if w > MAX_INPUT_SIDE or h > MAX_INPUT_SIDE:
                raise ValidationError(
                    f'Imagem muito grande ({w}×{h} px). Lado máximo: {MAX_INPUT_SIDE} px.'
                )
            if w * h > MAX_PIXELS:
                raise ValidationError(
                    f'Imagem muito grande ({w}×{h} px = {w * h // 1_000_000} MP). '
                    f'Máximo: {MAX_PIXELS // 1_000_000} megapixels.'
                )
            img.load()          # aqui estoura se estiver truncada
        except ValidationError:
            raise
        except Image.DecompressionBombError:
            raise ValidationError('Imagem rejeitada: dimensões suspeitas (decompression bomb).')
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError, MemoryError):
            raise ValidationError('Imagem inválida ou corrompida.')
        return img
    finally:
        Image.MAX_IMAGE_PIXELS = limite_anterior


# ── 3. Normalização ──────────────────────────────────────────────────────────

def _to_srgb(img: Image.Image) -> Image.Image:
    """Se a imagem trouxer um perfil ICC diferente de sRGB, converte as CORES
    para sRGB antes de descartar o perfil — assim tirar o metadado não muda o
    que o usuário vê. Sem ICC (o caso comum), não faz nada."""
    icc = img.info.get('icc_profile')
    if not icc or img.mode not in ('RGB', 'RGBA'):
        return img
    try:
        from PIL import ImageCms
        origem = ImageCms.getOpenProfile(io.BytesIO(icc))
        destino = ImageCms.createProfile('sRGB')
        modo = img.mode
        img = ImageCms.profileToProfile(img, origem, destino, outputMode=modo) or img
    except Exception:
        # Perfil quebrado/exótico: seguimos sem converter (o perfil é descartado
        # de qualquer forma na hora de salvar).
        logger.debug('ICC não convertido; perfil descartado.', exc_info=True)
    return img


def normalize_image(img: Image.Image, *, max_dim: int, flatten_bg=None) -> Image.Image:
    """Deixa a imagem pronta para o encoder:
      - aplica a ORIENTAÇÃO do EXIF (foto de celular deitada) antes de o EXIF ir
        embora;
      - GIF/APNG animado: usa o primeiro quadro (o sistema não exibe animação
        nesses campos — decisão documentada, não introduzimos suporte novo);
      - normaliza o modo para RGB/RGBA preservando transparência;
      - reduz proporcionalmente até `max_dim` (nunca AUMENTA nem distorce).
    `flatten_bg=(r,g,b)` achata a transparência sobre essa cor (para campos que
    não podem ter alfa, como a foto de perfil)."""
    # Animado → primeiro quadro.
    if getattr(img, 'n_frames', 1) > 1:
        try:
            img.seek(0)
        except (EOFError, OSError):
            pass

    img = ImageOps.exif_transpose(img) or img
    img = _to_srgb(img)

    tem_alfa = img.mode in ('RGBA', 'LA', 'PA') or (
        img.mode == 'P' and 'transparency' in img.info
    )
    if flatten_bg is not None:
        if tem_alfa:
            img = img.convert('RGBA')
            base = Image.new('RGB', img.size, tuple(flatten_bg))
            base.paste(img, mask=img.split()[-1])
            img = base
        else:
            img = img.convert('RGB')
    elif tem_alfa:
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
    elif img.mode != 'RGB':
        img = img.convert('RGB')

    if max_dim and max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)   # mantém a proporção
    return img


# ── 4. Conversão ─────────────────────────────────────────────────────────────

def convert_to_webp(img: Image.Image, *, quality=None) -> bytes:
    """Codifica em WebP. Não repassa `img.info`, então EXIF, GPS, comentários,
    ICC e qualquer payload escondido no arquivo original ficam de fora."""
    buf = io.BytesIO()
    img.save(
        buf,
        format='WEBP',
        quality=int(quality or WEBP_QUALITY),
        method=int(WEBP_METHOD),
        exif=b'',
        icc_profile=None,
    )
    buf.seek(0)
    return buf.read()


# ── Resultado ────────────────────────────────────────────────────────────────

@dataclass
class ProcessedImage:
    """Imagem já validada, normalizada e convertida — pronta para o storage."""
    content: ContentFile
    width: int
    height: int
    size: int
    content_type: str = CONTENT_TYPE
    original_name: str = ''
    source_format: str = ''

    @property
    def name(self) -> str:
        """Nome sugerido (o caminho real quem gera é o `upload_to` do campo,
        sempre com uuid do servidor)."""
        base = os.path.splitext(os.path.basename(self.original_name or 'imagem'))[0]
        base = ''.join(c for c in base if c.isalnum() or c in ' -_')[:60].strip() or 'imagem'
        return base + OUTPUT_EXT


def process_image(file, *, preset='photo', max_dim=None, quality=None,
                  flatten_bg=None, max_bytes=None) -> ProcessedImage:
    """O pipeline inteiro, de ponta a ponta. É a única porta de entrada que os
    módulos precisam conhecer.

    `preset` escolhe o lado máximo da saída ('photo' | 'logo' | 'avatar' |
    'thumb'); `max_dim` sobrepõe o preset quando o campo tiver uma regra própria.
    """
    original_name = getattr(file, 'name', '') or ''
    kind = validate_image(file, max_bytes=max_bytes)

    file.seek(0)
    raw = file.read()
    file.seek(0)
    if not raw:
        raise ValidationError('Arquivo vazio.')

    img = decode_image(raw)
    animado = getattr(img, 'n_frames', 1) > 1
    img = normalize_image(
        img,
        max_dim=max_dim or PRESETS.get(preset, PRESETS['photo']),
        flatten_bg=flatten_bg,
    )
    data = convert_to_webp(img, quality=quality)
    if animado:
        logger.info('Imagem animada (%s) convertida usando o primeiro quadro.', kind)
    return ProcessedImage(
        content=ContentFile(data),
        width=img.width,
        height=img.height,
        size=len(data),
        original_name=original_name,
        source_format=kind,
    )


# ── 5. Storage ───────────────────────────────────────────────────────────────

def upload_processed_image(field_file, processed: ProcessedImage, *, save=True,
                           replace=True):
    """Grava a imagem processada num FileField/ImageField, na ORDEM SEGURA:
    sobe a nova, confirma, atualiza a referência e só então descarta a antiga —
    nunca ao contrário (senão uma falha no meio deixaria o campo apontando para
    um arquivo que já não existe).

    O nome final vem do `upload_to` do campo (uuid gerado pelo servidor); o nome
    enviado pelo usuário nunca vira caminho.
    """
    anterior = field_file.name if field_file else ''
    field_file.save(processed.name, processed.content, save=save)
    if replace and anterior and anterior != field_file.name:
        try:
            field_file.storage.delete(anterior)
        except Exception:
            # Não é fatal: a referência nova já está gravada. Um órfão no S3 é
            # melhor do que perder a imagem por causa de uma exclusão que falhou.
            logger.warning('Não foi possível remover a imagem antiga %s', anterior, exc_info=True)
    return field_file


# ── Aviso de ambiente ────────────────────────────────────────────────────────

def check_image_codecs(app_configs=None, **kwargs):
    """System check do Django: avisa se o SERVIDOR não tem HEIC/AVIF.

    Existe porque o risco real aqui é o clássico "funciona na minha máquina": a
    dependência entra no requirements, mas a imagem de produção fica velha e as
    fotos de iPhone passam a ser recusadas em silêncio. Como WARNING (e não
    ERROR), aparece no `manage.py check` e na subida do servidor sem travar o
    deploy."""
    from django.core.checks import Warning as CheckWarning
    problemas = []
    if not HEIF_SUPPORTED:
        problemas.append(CheckWarning(
            'Sem suporte a HEIC/HEIF: fotos de iPhone/iPad serão recusadas.',
            hint='Instale pillow-heif (já está em requirements.txt) e reconstrua a imagem.',
            id='core.images.W001',
        ))
    if not AVIF_SUPPORTED:
        problemas.append(CheckWarning(
            'Sem suporte a AVIF: imagens .avif serão recusadas.',
            hint='Pillow >= 11.3 traz AVIF embutido; confira a versão instalada.',
            id='core.images.W002',
        ))
    return problemas

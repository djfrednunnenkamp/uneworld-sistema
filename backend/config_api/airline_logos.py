"""Utilitários da logo de companhia aérea — normalização (320×160 WebP com
transparência) e download da Kiwi pelo código IATA. Usado pelo AirlineViewSet e
pelo seed (importar da internet), sem depender de views (evita import circular).

A validação/decodificação do arquivo enviado é do serviço central (core.images);
aqui só fica o enquadramento no canvas fixo, que é regra deste campo."""
import io

import requests
from django.core.files.base import ContentFile

LOGO_SIZE = (320, 160)   # todas as logos ficam neste tamanho (fundo transparente)


def normalize_logo_bytes(raw_bytes):
    """Ajusta qualquer imagem para 320×160 WebP (fundo transparente), centralizada.
    Levanta ValueError se a imagem for inválida.

    A decodificação passa pelo core.images (magic bytes, anti image-bomb, arquivo
    truncado), então um `.png` que na verdade é outra coisa não entra aqui."""
    from django.core.exceptions import ValidationError
    from PIL import Image
    from core import images as imgsvc
    try:
        img = imgsvc.decode_image(raw_bytes).convert('RGBA')
    except ValidationError as e:
        raise ValueError(e.messages[0] if e.messages else 'imagem inválida')
    except Exception:
        raise ValueError('imagem inválida')
    img.thumbnail(LOGO_SIZE, Image.LANCZOS)
    canvas = Image.new('RGBA', LOGO_SIZE, (0, 0, 0, 0))
    canvas.paste(img, ((LOGO_SIZE[0] - img.width) // 2, (LOGO_SIZE[1] - img.height) // 2), img)
    out = io.BytesIO()
    out.write(imgsvc.convert_to_webp(canvas))
    return ContentFile(out.getvalue())


def download_kiwi_bytes(iata):
    """Baixa o PNG da logo na Kiwi pelo IATA. Retorna bytes ou None."""
    code = (iata or '').strip().upper()
    if not code:
        return None
    url = f'https://images.kiwi.com/airlines/128/{code}.png'
    try:
        resp = requests.get(url, timeout=10, headers={'User-Agent': 'UneWorld/1.0'})
        if resp.status_code == 200 and resp.content:
            return resp.content
    except Exception:
        pass
    return None


def normalized_kiwi_logo(iata):
    """Baixa da Kiwi e normaliza. Retorna ContentFile (320×160 PNG) ou None.
    Seguro para rodar em threads (só rede + Pillow, sem tocar no banco)."""
    raw = download_kiwi_bytes(iata)
    if not raw:
        return None
    try:
        return normalize_logo_bytes(raw)
    except ValueError:
        return None


def save_airline_logo(airline, content_file):
    """Grava a logo. SUBSTITUIÇÃO SEGURA: a antiga só é removida do storage
    depois que a nova já está gravada e a referência persistida."""
    antiga = airline.logo if airline.logo else None
    nome_antigo = antiga.name if antiga else ''
    airline.logo.save('logo.webp', content_file, save=True)
    if nome_antigo and nome_antigo != airline.logo.name:
        try:
            antiga.storage.delete(nome_antigo)
        except Exception:
            import logging
            logging.getLogger(__name__).warning('Logo antiga %s não removida', nome_antigo, exc_info=True)

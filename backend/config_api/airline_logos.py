"""Utilitários da logo de companhia aérea — normalização (320×160 PNG) e download
da Kiwi pelo código IATA. Usado pelo AirlineViewSet e pelo seed (importar da
internet), sem depender de views (evita import circular)."""
import io

import requests
from django.core.files.base import ContentFile

LOGO_SIZE = (320, 160)   # todas as logos ficam neste tamanho (PNG transparente)


def normalize_logo_bytes(raw_bytes):
    """Ajusta qualquer imagem para 320×160 PNG (fundo transparente), centralizada.
    Levanta ValueError se a imagem for inválida."""
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(raw_bytes)).convert('RGBA')
    except Exception:
        raise ValueError('imagem inválida')
    img.thumbnail(LOGO_SIZE, Image.LANCZOS)
    canvas = Image.new('RGBA', LOGO_SIZE, (0, 0, 0, 0))
    canvas.paste(img, ((LOGO_SIZE[0] - img.width) // 2, (LOGO_SIZE[1] - img.height) // 2), img)
    out = io.BytesIO()
    canvas.save(out, format='PNG', optimize=True)
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
    """Grava a logo (removendo a antiga)."""
    if airline.logo:
        airline.logo.delete(save=False)
    airline.logo.save('logo.png', content_file, save=True)

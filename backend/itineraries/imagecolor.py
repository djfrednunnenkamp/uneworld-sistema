"""Detecção da cor dominante de uma imagem, para o filtro por cor da Galeria.
Reduz a imagem, quantiza para poucas cores e pega a mais frequente; classifica
numa faixa de cor nomeada (vermelho, azul, verde…) via HSV."""
import colorsys

from PIL import Image


def _bucket(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    if v < 0.16:
        return 'black'
    if s < 0.13:
        return 'white' if v > 0.82 else 'gray'
    hd = h * 360
    # Marrom = laranja escuro/dessaturado.
    if (hd < 45 or hd >= 350) and v < 0.55 and s < 0.9:
        return 'brown'
    if hd < 15 or hd >= 345:
        return 'red'
    if hd < 45:
        return 'orange'
    if hd < 66:
        return 'yellow'
    if hd < 155:
        return 'green'
    if hd < 195:
        return 'teal'
    if hd < 255:
        return 'blue'
    if hd < 290:
        return 'purple'
    return 'pink'


# Faixas de cor disponíveis (ordem de exibição no filtro) + amostra hex.
COLOR_BUCKETS = [
    ('red', '#dc2626'), ('orange', '#ea580c'), ('yellow', '#eab308'),
    ('green', '#16a34a'), ('teal', '#0d9488'), ('blue', '#2563eb'),
    ('purple', '#7c3aed'), ('pink', '#db2777'), ('brown', '#92400e'),
    ('white', '#f8fafc'), ('gray', '#6b7280'), ('black', '#111827'),
]


def dominant_color(source):
    """`source`: caminho, file-like ou PIL.Image. Retorna (hex, bucket) ou ('', '').

    Escolhe a cor pela frequência PONDERADA pela saturação — assim uma área
    colorida (céu azul, vegetação) vence um grande fundo branco/cinza; mas uma
    imagem realmente neutra ainda resulta em branco/cinza/preto."""
    try:
        img = source if isinstance(source, Image.Image) else Image.open(source)
        img = img.convert('RGB')
        img.thumbnail((90, 90))
        q = img.quantize(colors=12)
        palette = q.getpalette()
        colors = q.getcolors() or []                    # [(count, index), …]
        if not colors:
            return '', ''
        best, best_score = None, -1.0
        for count, idx in colors:
            r, g, b = palette[idx * 3:idx * 3 + 3]
            _, s, _ = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
            score = count * (0.16 + s)                  # satura pesa; neutro só se não houver cor
            if score > best_score:
                best_score, best = score, (r, g, b)
        r, g, b = best
        return '#%02x%02x%02x' % (r, g, b), _bucket(r, g, b)
    except Exception:
        return '', ''

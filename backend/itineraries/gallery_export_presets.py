"""Matriz de exportação de vídeo da Galeria — FONTE ÚNICA DA VERDADE (backend).

O frontend só envia ENUMS (container/codec/áudio/resolução/qualidade); NUNCA
argumentos de FFmpeg. Aqui validamos a combinação contra a allowlist e montamos o
comando (lista de args, sem shell). Também descreve as opções para a UI
(`options_payload`) e valida a saída (`validate_output`).

Segurança: só constrói comandos a partir desta allowlist; qualquer combinação fora
dela é rejeitada (nunca confia no cliente).
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess

from django.conf import settings

# Versão do esquema de config — muda o hash quando a matriz/args mudam (invalida cache).
# v2: cadência adaptativa + seletor de taxa de quadros (frame_rate) + brand mp42.
PRESET_SCHEMA_VERSION = 2

# ── Contêineres → codecs de vídeo permitidos ────────────────────────────────────
CONTAINERS = {
    'mp4':  {'label': 'MP4',  'ext': '.mp4',  'mime': 'video/mp4',
             'codecs': ['h264_baseline', 'h264_main', 'h264_high', 'hevc', 'av1']},
    'webm': {'label': 'WebM', 'ext': '.webm', 'mime': 'video/webm',
             'codecs': ['vp9', 'av1']},
    'mov':  {'label': 'MOV',  'ext': '.mov',  'mime': 'video/quicktime',
             'codecs': ['h264_high', 'hevc', 'prores_proxy', 'prores_lt', 'prores_422']},
    'mkv':  {'label': 'MKV',  'ext': '.mkv',  'mime': 'video/x-matroska',
             'codecs': ['h264_high', 'hevc', 'vp9', 'av1']},
}

# ── Codecs de vídeo (família + rótulo + aviso) ──────────────────────────────────
VIDEO_CODECS = {
    'h264_baseline': {'label': 'H.264 — compatibilidade máxima', 'family': 'h264', 'warn': False,
                      'hint': 'Maior compatibilidade. Recomendado para computadores e aparelhos mais antigos.'},
    'h264_main':     {'label': 'H.264 Main', 'family': 'h264', 'warn': False,
                      'hint': 'Bom equilíbrio entre compatibilidade e tamanho.'},
    'h264_high':     {'label': 'H.264 High', 'family': 'h264', 'warn': False,
                      'hint': 'Melhor compressão e qualidade em dispositivos modernos.'},
    'hevc':          {'label': 'H.265/HEVC', 'family': 'hevc', 'warn': True,
                      'hint': 'Arquivos menores, mas pode não abrir em aparelhos antigos.'},
    'av1':           {'label': 'AV1', 'family': 'av1', 'warn': True,
                      'hint': 'Compressão moderna. A conversão pode demorar bem mais.'},
    'vp9':           {'label': 'VP9', 'family': 'vp9', 'warn': False,
                      'hint': 'Boa opção para navegadores e Linux.'},
    'prores_proxy':  {'label': 'ProRes 422 Proxy', 'family': 'prores', 'warn': True, 'prores': 0,
                      'hint': 'Edição profissional. Gera arquivos grandes.'},
    'prores_lt':     {'label': 'ProRes 422 LT', 'family': 'prores', 'warn': True, 'prores': 1,
                      'hint': 'Edição profissional. Gera arquivos grandes.'},
    'prores_422':    {'label': 'ProRes 422', 'family': 'prores', 'warn': True, 'prores': 2,
                      'hint': 'Edição profissional. Gera arquivos grandes.'},
}

# ── Áudio permitido por família de vídeo/contêiner ──────────────────────────────
AUDIO_CODECS = {
    'aac':    {'label': 'AAC'},
    'opus':   {'label': 'Opus'},
    'vorbis': {'label': 'Vorbis'},
    'pcm':    {'label': 'PCM (sem compressão)'},
    'none':   {'label': 'Sem áudio'},
}


def audio_options(container, video_codec):
    """Áudios válidos p/ a combinação (sempre inclui 'none')."""
    if container == 'webm':
        opts = ['opus', 'vorbis']
    elif container == 'mkv':
        opts = ['aac', 'opus']
    elif container == 'mov' and VIDEO_CODECS[video_codec]['family'] == 'prores':
        opts = ['aac', 'pcm']
    else:                        # mp4 / mov h264|hevc | outros
        opts = ['aac']
    return opts + ['none']


# ── Qualidade → CRF por família (referências ajustáveis) ────────────────────────
QUALITY_CRF = {
    'h264': {'compact': 28, 'balanced': 23, 'high': 19, 'max': 16},
    'hevc': {'compact': 30, 'balanced': 26, 'high': 22, 'max': 18},
    'vp9':  {'compact': 38, 'balanced': 32, 'high': 27, 'max': 22},
    'av1':  {'compact': 38, 'balanced': 32, 'high': 27, 'max': 22},
}
QUALITY_LABELS = [('compact', 'Compacta'), ('balanced', 'Equilibrada'),
                  ('high', 'Alta'), ('max', 'Máxima')]

# Alturas de resolução oferecidas (nunca amplia; filtradas pela origem).
RESOLUTIONS = [('original', 'Original'), ('2160', '2160p (4K)'),
               ('1080', '1080p'), ('720', '720p'), ('480', '480p')]

# Taxa de quadros oferecida. 'auto'/'original' PRESERVAM a cadência real da origem
# (não inflam nem duplicam quadros — ver política em services/video.py). As fixas
# só devem ser oferecidas com aviso quando MAIORES que a cadência da origem (o
# frontend usa `warn`/`hint` calculados em options_payload).
FRAME_RATES = [('auto', 'Automática'), ('original', 'Original'),
               ('24', '24 fps'), ('25', '25 fps'), ('30', '30 fps'), ('60', '60 fps')]
_FRAME_RATE_VALUES = {v for v, _ in FRAME_RATES}

DEFAULT_CONFIG = {'container': 'mp4', 'video_codec': 'h264_baseline', 'audio_codec': 'aac',
                  'resolution': 'original', 'quality': 'balanced', 'frame_rate': 'auto'}


class ExportOptionError(Exception):
    """Combinação inválida (rejeitada pela allowlist)."""


# ── Validação/canonicalização das opções vindas do cliente ──────────────────────

def normalize_config(payload, *, source_height=None):
    """Valida os ENUMS do cliente e devolve a config CANÔNICA (ou levanta
    ExportOptionError). `source_height` filtra resoluções maiores que a origem."""
    container = str(payload.get('container') or DEFAULT_CONFIG['container']).lower()
    if container not in CONTAINERS:
        raise ExportOptionError('Formato inválido.')
    vcodec = str(payload.get('video_codec') or '').lower()
    if vcodec not in CONTAINERS[container]['codecs']:
        raise ExportOptionError('Codec de vídeo inválido para este formato.')
    acodec = str(payload.get('audio_codec') or 'none').lower()
    if acodec not in audio_options(container, vcodec):
        raise ExportOptionError('Áudio inválido para esta combinação.')
    resolution = str(payload.get('resolution') or 'original').lower()
    if resolution not in {r[0] for r in RESOLUTIONS}:
        raise ExportOptionError('Resolução inválida.')
    if resolution != 'original' and source_height and int(resolution) > int(source_height):
        raise ExportOptionError('Resolução maior que a do vídeo original.')
    family = VIDEO_CODECS[vcodec]['family']
    if family == 'prores':
        quality = 'na'          # ProRes usa profile, não CRF
    else:
        quality = str(payload.get('quality') or 'balanced').lower()
        if quality not in QUALITY_CRF[family]:
            raise ExportOptionError('Qualidade inválida.')
    frame_rate = str(payload.get('frame_rate') or 'auto').lower()
    if frame_rate not in _FRAME_RATE_VALUES:
        raise ExportOptionError('Taxa de quadros inválida.')
    return {'container': container, 'video_codec': vcodec, 'audio_codec': acodec,
            'resolution': resolution, 'quality': quality, 'frame_rate': frame_rate}


def config_hash(video_id, config):
    """Hash determinístico (video + config + versão do esquema) para dedup/cache."""
    payload = {'v': PRESET_SCHEMA_VERSION, 'video': int(video_id), **config}
    blob = json.dumps(payload, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(blob.encode()).hexdigest()


def container_ext(config):
    return CONTAINERS[config['container']]['ext']


def container_mime(config):
    return CONTAINERS[config['container']]['mime']


def config_summary(config):
    """Resumo curto p/ UI/nome do arquivo (ex.: 'MP4 · H.264 High · 1080p · Alta')."""
    c = CONTAINERS[config['container']]['label']
    v = VIDEO_CODECS[config['video_codec']]['label'].split('—')[0].strip()
    res = 'Original' if config['resolution'] == 'original' else f"{config['resolution']}p"
    q = dict(QUALITY_LABELS).get(config['quality'], '')
    parts = [c, v, res] + ([q] if q else [])
    fr = config.get('frame_rate', 'auto')
    if fr not in ('auto', 'original', '', None):
        parts.append(f'{fr} fps')
    return ' · '.join(parts)


# ── Construção do comando FFmpeg (SÓ da allowlist) ──────────────────────────────

def _scale_vf(config, family):
    max_h = None
    if config['resolution'] != 'original':
        max_h = int(config['resolution'])
    # Escala p/ a altura alvo SEM ampliar (min com a origem via 'min(h,ih)'), dims pares.
    if max_h:
        base = f"scale=-2:'min({max_h},ih)':flags=lanczos,"
    else:
        base = ''
    base += "scale=trunc(iw/2)*2:trunc(ih/2)*2"
    if family == 'prores':
        return base + ',format=yuv422p10le'
    return base + ',format=yuv420p'


def _video_args(config):
    vc = config['video_codec']
    info = VIDEO_CODECS[vc]
    family = info['family']
    q = config['quality']
    args = []
    if family == 'h264':
        crf = QUALITY_CRF['h264'][q]
        prof = {'h264_baseline': 'baseline', 'h264_main': 'main', 'h264_high': 'high'}[vc]
        args += ['-c:v', 'libx264', '-profile:v', prof, '-level', '4.0', '-crf', str(crf),
                 '-preset', getattr(settings, 'VIDEO_PRESET', 'medium')]
        if prof == 'baseline':
            args += ['-x264-params', 'cabac=0:bframes=0:ref=1']
        if config['container'] in ('mp4', 'mov'):
            args += ['-tag:v', 'avc1']
    elif family == 'hevc':
        crf = QUALITY_CRF['hevc'][q]
        args += ['-c:v', 'libx265', '-crf', str(crf), '-preset', 'medium']
        if config['container'] in ('mp4', 'mov'):
            args += ['-tag:v', 'hvc1']    # hvc1 = compat Apple
    elif family == 'av1':
        crf = QUALITY_CRF['av1'][q]
        args += ['-c:v', 'libaom-av1', '-crf', str(crf), '-b:v', '0',
                 '-cpu-used', str(getattr(settings, 'VIDEO_AV1_CPU_USED', 6)), '-row-mt', '1']
    elif family == 'vp9':
        crf = QUALITY_CRF['vp9'][q]
        args += ['-c:v', 'libvpx-vp9', '-crf', str(crf), '-b:v', '0', '-row-mt', '1',
                 '-deadline', 'good', '-cpu-used', str(getattr(settings, 'VIDEO_VP9_CPU_USED', 2))]
    elif family == 'prores':
        args += ['-c:v', 'prores_ks', '-profile:v', str(info['prores'])]
    return args, family


def _audio_args(config):
    a = config['audio_codec']
    if a == 'none':
        return ['-an']
    if a == 'aac':
        return ['-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '128k']
    if a == 'opus':
        return ['-c:a', 'libopus', '-b:a', '128k']
    if a == 'vorbis':
        return ['-c:a', 'libvorbis', '-q:a', '5']
    if a == 'pcm':
        return ['-c:a', 'pcm_s16le']
    return ['-an']


def build_command(ffmpeg, src, dst, config, *, target_fps=None):
    """Monta a lista de args do FFmpeg para a config (allowlist). Sem shell.

    A cadência de saída segue a política ADAPTATIVA (`video.plan_target_fps`):
    'auto'/'original' preservam a taxa real da origem; um valor fixo (24/25/30/60)
    vence. `target_fps` explícito (legado) ainda tem prioridade máxima.
    """
    from .services import video as vsvc
    vargs, family = _video_args(config)
    vf = _scale_vf(config, family)
    override = target_fps if target_fps else config.get('frame_rate', 'auto')
    fps = vsvc.plan_target_fps(src, override=override)
    cmd = [ffmpeg, '-y', '-loglevel', 'error', '-nostdin', '-nostats',
           '-fflags', '+genpts', '-i', src, '-map', '0:v:0']
    if config['audio_codec'] != 'none':
        cmd += ['-map', '0:a?']
    cmd += ['-vf', vf, '-fps_mode', 'cfr', '-r', fps]
    cmd += vargs + _audio_args(config)
    if config['container'] in ('mp4', 'mov'):
        cmd += ['-movflags', '+faststart']
    if config['container'] == 'mp4':
        cmd += ['-brand', 'mp42']     # casa com o contêiner que abre no player estrito
    cmd += ['-max_muxing_queue_size', '1024', '-progress', 'pipe:1', dst]
    return cmd


# ── Validação da saída ──────────────────────────────────────────────────────────

_FAMILY_CODEC = {'h264': 'h264', 'hevc': 'hevc', 'av1': 'av1', 'vp9': 'vp9', 'prores': 'prores'}
_CONTAINER_FMT = {'mp4': ('mp4', 'mov'), 'mov': ('mov', 'mp4'), 'webm': ('webm', 'matroska'),
                  'mkv': ('matroska', 'webm')}


def validate_output(path, config):
    """Confirma que a saída bate com a config (contêiner/codec/pix_fmt/duração) e
    decodifica sem erro. Levanta video.VideoError se algo falhar."""
    from .services import video as vsvc
    info = vsvc.probe(path)
    family = VIDEO_CODECS[config['video_codec']]['family']
    if not any(fmt in info.format_name for fmt in _CONTAINER_FMT[config['container']]):
        raise vsvc.VideoError(f'Contêiner inesperado ({info.format_name}).')
    if info.codec != _FAMILY_CODEC[family]:
        raise vsvc.VideoError(f'Codec inesperado ({info.codec}).')
    if family == 'prores':
        if not (info.pix_fmt or '').startswith('yuv422'):
            raise vsvc.VideoError(f'Pixel format inesperado no ProRes ({info.pix_fmt}).')
    elif info.pix_fmt not in ('yuv420p', 'yuvj420p'):
        raise vsvc.VideoError(f'Pixel format inesperado ({info.pix_fmt}).')
    if not info.duration or info.duration <= 0:
        raise vsvc.VideoError('Duração inválida.')
    if not (info.width and info.height):
        raise vsvc.VideoError('Dimensões inválidas.')
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        raise vsvc.VideoError('Arquivo vazio.')
    if not vsvc.decode_ok(path):
        raise vsvc.VideoError('A saída não pôde ser decodificada.')
    return info


# ── Payload de opções para a UI ─────────────────────────────────────────────────

def _frame_rate_list(source_fps=None):
    """Opções de taxa de quadros para a UI. Marca `warn` nas taxas fixas MAIORES que
    a cadência da origem (converter ~9fps→60fps só duplica quadros e incha o arquivo);
    o frontend mostra o aviso e só aplica se o usuário confirmar."""
    src = None
    try:
        src = float(source_fps) if source_fps else None
    except (TypeError, ValueError):
        src = None
    out = []
    for value, label in FRAME_RATES:
        item = {'value': value, 'label': label, 'warn': False, 'hint': ''}
        if value == 'auto':
            item['hint'] = 'Preserva a cadência real do vídeo (recomendado).'
        elif value == 'original':
            item['hint'] = 'Mantém a taxa de quadros original.'
        elif src:
            fixed = float(value)
            if fixed > src * 1.5:
                item['warn'] = True
                item['hint'] = f'A origem tem cerca de {src:.0f} fps; converter para {value} fps apenas duplica quadros e aumenta o arquivo.'
            elif fixed < src * 0.6:
                item['hint'] = f'Reduz de ~{src:.0f} fps para {value} fps (pode ficar menos fluido).'
        out.append(item)
    return out


def options_payload(*, source_height=None, source_fps=None):
    """Descreve a matriz para o modal (contêineres → codecs → áudios), resoluções
    filtradas pela origem, qualidades, taxas de quadros e o default. O backend é a
    fonte da verdade."""
    def res_list():
        out = []
        for value, label in RESOLUTIONS:
            if value == 'original':
                out.append({'value': value, 'label': label})
            elif not source_height or int(value) <= int(source_height):
                out.append({'value': value, 'label': label})
        return out

    containers = []
    for cval, cinfo in CONTAINERS.items():
        codecs = []
        for vc in cinfo['codecs']:
            vi = VIDEO_CODECS[vc]
            codecs.append({
                'value': vc, 'label': vi['label'], 'hint': vi['hint'], 'warn': vi['warn'],
                'family': vi['family'],
                'audio': [{'value': a, 'label': AUDIO_CODECS[a]['label']} for a in audio_options(cval, vc)],
                'uses_quality': vi['family'] != 'prores',
            })
        containers.append({'value': cval, 'label': cinfo['label'], 'ext': cinfo['ext'], 'codecs': codecs})

    return {
        'default': DEFAULT_CONFIG,
        'containers': containers,
        'resolutions': res_list(),
        'qualities': [{'value': v, 'label': l} for v, l in QUALITY_LABELS],
        'frame_rates': _frame_rate_list(source_fps),
    }

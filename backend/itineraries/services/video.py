"""Serviço de vídeo da Galeria — inspeção (ffprobe), normalização/conversão
(ffmpeg) e geração de thumbnail.

Filosofia:
  * Todo vídeo enviado é NORMALIZADO para um MP4 tocável em qualquer navegador:
    contêiner MP4, vídeo H.264/yuv420p, áudio AAC (quando houver), `+faststart`,
    dimensões pares, timestamps reconstruídos (genpts + CFR) e frame rate estável.
  * Nunca confia na extensão: o ffprobe é a fonte da verdade sobre o conteúdo.
  * Segurança: os binários são chamados com lista de argumentos (nunca shell),
    com timeout por etapa. Nomes de arquivo do usuário não entram na linha de
    comando (o Django já salva com nome uuid), mas passamos caminhos absolutos.

Sem ffmpeg/ffprobe instalados, `probe`/`normalize`/`thumbnail` levantam
`FFmpegNotAvailable` — o orquestrador marca o registro como 'failed' com uma
mensagem clara em vez de servir um arquivo quebrado.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from fractions import Fraction

from django.conf import settings

logger = logging.getLogger(__name__)

# Extensões de ENTRADA aceitas (o ffmpeg lê muito mais do que servimos). A saída é
# SEMPRE .mp4/H.264. Mantido em sincronia com passengers.validators.VIDEO_EXTENSIONS.
INPUT_VIDEO_EXTENSIONS = {
    '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.ogv', '.ogg',
    '.mpeg', '.mpg', '.3gp', '.3g2', '.wmv', '.flv', '.ts', '.mts', '.m2ts',
}

# pixel formats que o H.264 baseline/main tocam bem no navegador.
_BROWSER_SAFE_PIX_FMTS = {'yuv420p', 'yuvj420p'}


class VideoError(Exception):
    """Falha de processamento de vídeo com mensagem já sanitizada p/ o usuário."""


class FFmpegNotAvailable(VideoError):
    """ffmpeg/ffprobe não estão instalados/acessíveis."""


class ProbeResult:
    """Resumo da inspeção de um arquivo de vídeo (o que precisamos)."""

    def __init__(self, raw: dict):
        self.raw = raw
        fmt = raw.get('format', {}) or {}
        streams = raw.get('streams', []) or []
        self.format_name = fmt.get('format_name', '') or ''
        self.video = next((s for s in streams if s.get('codec_type') == 'video'), None)
        self.audio = next((s for s in streams if s.get('codec_type') == 'audio'), None)
        self.duration = _to_float(fmt.get('duration')) or (
            _to_float(self.video.get('duration')) if self.video else None)
        self.codec = (self.video or {}).get('codec_name', '') or ''
        self.pix_fmt = (self.video or {}).get('pix_fmt', '') or ''
        self.width = _to_int((self.video or {}).get('width'))
        self.height = _to_int((self.video or {}).get('height'))
        self.rotation = _rotation_of(self.video) if self.video else 0

    @property
    def has_video(self) -> bool:
        return self.video is not None

    @property
    def has_audio(self) -> bool:
        return self.audio is not None

    @property
    def display_dims(self):
        """(w, h) já considerando rotação de 90/270°."""
        w, h = self.width or 0, self.height or 0
        if self.rotation in (90, 270):
            return h, w
        return w, h


# ── binários ────────────────────────────────────────────────────────────────────

def _bin(name_setting: str, default: str) -> str:
    path = getattr(settings, name_setting, default) or default
    resolved = shutil.which(path) if os.path.basename(path) == path else (path if os.path.exists(path) else None)
    if not resolved:
        raise FFmpegNotAvailable(
            'O processamento de vídeo está indisponível no servidor (ffmpeg/ffprobe '
            'não encontrados). Instale o FFmpeg para converter vídeos.')
    return resolved


def ffmpeg_available() -> bool:
    try:
        _bin('FFMPEG_BIN', 'ffmpeg')
        _bin('FFPROBE_BIN', 'ffprobe')
        return True
    except FFmpegNotAvailable:
        return False


def resolved_binaries() -> dict:
    """Caminhos resolvidos de ffmpeg/ffprobe (ou None) — para log/diagnóstico. Usa
    o MESMO PATH do processo Django (não do terminal)."""
    def _try(setting, default):
        try:
            return _bin(setting, default)
        except FFmpegNotAvailable:
            return None
    return {'ffmpeg': _try('FFMPEG_BIN', 'ffmpeg'), 'ffprobe': _try('FFPROBE_BIN', 'ffprobe'),
            'PATH': os.environ.get('PATH', '')}


def _run(cmd: list[str], timeout: int, step: str) -> subprocess.CompletedProcess:
    """Executa um binário (lista de args, sem shell) com timeout. Levanta VideoError
    com stderr sanitizado se falhar."""
    try:
        proc = subprocess.run(
            cmd, capture_output=True, timeout=timeout,
            check=False, text=True, errors='replace',
        )
    except subprocess.TimeoutExpired as e:
        raise VideoError(f'Tempo esgotado ao {step} (limite {timeout}s).') from e
    except (OSError, ValueError) as e:
        raise VideoError(f'Falha ao executar o processamento ({step}).') from e
    if proc.returncode != 0:
        tail = _tail(proc.stderr)
        logger.warning('ffmpeg/%s falhou (rc=%s): %s', step, proc.returncode, tail)
        raise VideoError(f'Falha ao {step}: {tail}')
    return proc


def _tail(text: str, lines: int = 4) -> str:
    """Últimas linhas do stderr (mensagem técnica curta, sem caminhos internos)."""
    if not text:
        return 'erro desconhecido'
    parts = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    tail = ' | '.join(parts[-lines:])[:400]
    # Não vaza caminhos absolutos do servidor.
    return tail.replace(str(getattr(settings, 'MEDIA_ROOT', '')), '<media>').replace(str(getattr(settings, 'BASE_DIR', '')), '<app>')


# ── inspeção ──────────────────────────────────────────────────────────────────

def probe(path: str) -> ProbeResult:
    """Inspeciona o arquivo com ffprobe (JSON). Levanta VideoError se não for um
    vídeo legível."""
    ffprobe = _bin('FFPROBE_BIN', 'ffprobe')
    proc = _run(
        [ffprobe, '-v', 'error', '-print_format', 'json',
         '-show_format', '-show_streams', path],
        timeout=getattr(settings, 'FFPROBE_TIMEOUT', 60), step='inspecionar o vídeo')
    try:
        data = json.loads(proc.stdout or '{}')
    except json.JSONDecodeError as e:
        raise VideoError('Não foi possível ler as informações do vídeo.') from e
    result = ProbeResult(data)
    if not result.has_video:
        raise VideoError('O arquivo não contém uma faixa de vídeo válida.')
    return result


def decode_ok(path: str) -> bool:
    """Decodifica o arquivo inteiro descartando a saída (-f null). Retorna True se
    não houver erro FATAL de decodificação. Avisos de timestamp não contam como
    fatais aqui — o objetivo é detectar bytes truncados/corrompidos."""
    ffmpeg = _bin('FFMPEG_BIN', 'ffmpeg')
    try:
        proc = subprocess.run(
            [ffmpeg, '-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'],
            capture_output=True, timeout=getattr(settings, 'FFMPEG_TIMEOUT', 1800),
            check=False, text=True, errors='replace')
    except (subprocess.TimeoutExpired, OSError):
        return False
    return proc.returncode == 0


# ── política adaptativa de frame rate ───────────────────────────────────────────
#
# Investigação forense (roteiro #467): o MP4 normalizado NÃO abria no reprodutor
# padrão do Ubuntu, mas o ORIGINAL abria — apesar de bitstream H.264 IDÊNTICO
# (Constrained Baseline / level 4.0 / avc1 / yuv420p / refs=1 / sem B-frames). A
# ÚNICA diferença real era TEMPORAL + contêiner: forçávamos 30fps CFR (2339 quadros,
# ~1600 DUPLICADOS de uma origem de ~8,9fps) e o brand `isom`; o original tem a
# cadência real (~8,88fps, 692 quadros) e brand `mp42`. Reproduzir a cadência da
# origem (em vez de inflar para 30fps) e casar o brand faz o arquivo gerado ficar
# ESTRUTURALMENTE igual ao que comprovadamente abre. Ver §16 do relatório.
#
# `r_frame_rate` é INUTILIZÁVEL como alvo (vem `10000/1` em telas gravadas); o campo
# confiável é `avg_frame_rate` = quadros/duração real.

# Taxas "padrão" (inclui variantes NTSC) — se a cadência real ficar muito perto de
# uma delas, encaixamos (uma origem 30fps real continua exatamente 30fps).
_STD_RATES = [Fraction(24000, 1001), Fraction(24), Fraction(25), Fraction(30000, 1001),
              Fraction(30), Fraction(50), Fraction(60000, 1001), Fraction(60)]


def _parse_rate(s) -> Fraction | None:
    """'a/b' → Fraction positiva; None se ausente/zero/absurda ('0/0', 'N/A')."""
    try:
        f = Fraction(s)
    except (ValueError, ZeroDivisionError, TypeError):
        return None
    return f if f > 0 else None


def _fps_str(fr: Fraction) -> str:
    """Fraction → 'num/den' exato para `-r` e para o filtro `fps=` (sem drift)."""
    fr = Fraction(fr).limit_denominator(1_000_000)
    return f'{fr.numerator}/{fr.denominator}'


def _probe_rate_fields(src: str) -> dict:
    """avg/r_frame_rate + nb_frames + duração do 1º stream de vídeo (p/ o plano de fps)."""
    ffprobe = _bin('FFPROBE_BIN', 'ffprobe')
    proc = _run(
        [ffprobe, '-v', 'error', '-select_streams', 'v:0', '-show_entries',
         'stream=avg_frame_rate,r_frame_rate,nb_frames,duration:format=duration',
         '-of', 'json', src],
        timeout=getattr(settings, 'FFPROBE_TIMEOUT', 60), step='inspecionar a cadência do vídeo')
    try:
        data = json.loads(proc.stdout or '{}')
    except json.JSONDecodeError:
        return {}
    streams = data.get('streams') or []
    st = streams[0] if streams else {}
    fmt = data.get('format') or {}
    return {
        'avg': st.get('avg_frame_rate'), 'r': st.get('r_frame_rate'),
        'nb_frames': _to_int(st.get('nb_frames')),
        'duration': _to_float(st.get('duration')) or _to_float(fmt.get('duration')),
    }


def plan_target_fps(src: str, *, override=None, max_fps: int | None = None,
                    fallback: int | None = None) -> str:
    """Decide a taxa de quadros CFR de saída PRESERVANDO a cadência real da origem
    (em vez de forçar um valor fixo). Retorna string 'num/den' para o ffmpeg.

    Ordem de decisão:
      1. `override` explícito (export avançado: 24/25/30/60…) vence, limitado a `max_fps`.
         'auto'/'original'/None → política adaptativa abaixo.
      2. `avg_frame_rate` da origem (quadros/duração real) — NUNCA `r_frame_rate`.
      3. Se avg inválido/absurdo, calcula nb_frames/duração.
      4. Último recurso: `fallback` (30).
    Nunca AMPLIA além de `max_fps` (não cria 30fps de uma origem ~9fps → evita ~1600
    quadros duplicados) e encaixa numa taxa padrão quando está a <2% dela.
    """
    max_fps = max_fps or getattr(settings, 'VIDEO_MAX_FPS', 60)
    fallback = fallback or getattr(settings, 'VIDEO_TARGET_FPS', 30)

    if override not in (None, '', 'auto', 'original'):
        ov = _parse_rate(override)
        if ov:
            return _fps_str(min(ov, Fraction(max_fps)))

    try:
        fields = _probe_rate_fields(src)
    except VideoError:
        fields = {}

    rate = _parse_rate(fields.get('avg'))
    if rate is None or rate > 240:      # avg ausente/absurdo → conta real de quadros
        nb, dur = fields.get('nb_frames'), fields.get('duration')
        if nb and dur and dur > 0:
            rate = Fraction(nb) / Fraction(dur).limit_denominator(100_000)
    if rate is None or rate <= 0:
        rate = Fraction(fallback)

    rate = min(rate, Fraction(max_fps))
    for std in _STD_RATES:              # encaixa em taxa padrão se muito perto
        if abs(float(rate) - float(std)) <= float(std) * 0.02:
            rate = std
            break
    if rate < Fraction(1):
        rate = Fraction(1)
    return _fps_str(rate)


# ── conversão / normalização ──────────────────────────────────────────────────

def normalize(src: str, dst: str, *, target_fps: int | None = None,
              max_height: int | None = None, crf: int | None = None,
              preset: str | None = None, on_progress=None) -> None:
    """Converte `src` em um MP4 tocável no navegador, gravando em `dst`.

    Correções aplicadas SEMPRE (a origem pode ter timestamps ruins como o exemplo
    com DTS não-monotônico):
      * `-fflags +genpts` reconstrói PTS ausentes/duplicados;
      * CFR na cadência REAL da origem (`plan_target_fps`) — elimina DTS não-monotônico
        SEM inflar para 30fps nem duplicar quadros; preserva ~9fps se a origem é ~9fps;
      * `format=yuv420p` garante pixel format compatível;
      * dimensões forçadas a pares (libx264 exige);
      * `-movflags +faststart` move o moov atom para o início (streaming/seek);
      * áudio → AAC quando existir; sem áudio é aceito normalmente.
    Não amplia vídeos pequenos (só reduz se passar de `max_height`).

    `on_progress(processed_seconds, speed)` (opcional) é chamado enquanto o FFmpeg
    trabalha, com o tempo de vídeo já processado (s) e a velocidade (× tempo real),
    para a barra de progresso real (via `-progress pipe:1`).
    """
    ffmpeg = _bin('FFMPEG_BIN', 'ffmpeg')
    # Cadência de saída ADAPTATIVA: preserva a taxa real da origem (não força 30fps —
    # ver comentário da política acima). Um `target_fps` explícito (export avançado)
    # ainda manda; None → adaptativo.
    fps = plan_target_fps(src, override=target_fps)
    max_height = max_height or getattr(settings, 'VIDEO_MAX_HEIGHT', 1080)
    crf = crf if crf is not None else getattr(settings, 'VIDEO_CRF', 23)
    preset = preset or getattr(settings, 'VIDEO_PRESET', 'medium')

    # Filtro de vídeo: 1) reduz p/ max_height só se maior (sem ampliar), mantendo a
    # proporção; 2) força dimensões PARES; 3) CFR na cadência real; 4) yuv420p. O
    # ffmpeg aplica a rotação do metadado automaticamente (autorotate) e reescreve limpo.
    vf = (
        f"scale=-2:'min({max_height},ih)':flags=lanczos,"
        f"scale=trunc(iw/2)*2:trunc(ih/2)*2,"
        f"fps={fps},format=yuv420p"
    )
    cmd = [
        ffmpeg, '-y', '-loglevel', 'error', '-nostdin', '-nostats',
        '-fflags', '+genpts',
        '-i', src,
        '-map', '0:v:0', '-map', '0:a?',
        '-vf', vf,
        '-fps_mode', 'cfr', '-r', fps,
        # H.264 CONSTRAINED BASELINE (a versão de MÁXIMA compatibilidade — abre no
        # reprodutor padrão do Ubuntu e em aparelhos antigos): sem B-frames, refs=1,
        # CABAC desligado. yuv420p 8-bit, tag avc1, áudio AAC-LC. faststart.
        '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '4.0', '-tag:v', 'avc1',
        '-x264-params', 'cabac=0:bframes=0:ref=1',
        '-preset', preset, '-crf', str(crf),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '128k', '-ac', '2',
        '-movflags', '+faststart',
        # Brand `mp42` (não `isom`): casa com o contêiner do arquivo que comprovadamente
        # abre no player do Ubuntu — demuxers estritos (VA-API/v4l2) toleram melhor.
        '-brand', 'mp42',
        '-max_muxing_queue_size', '1024',
        '-progress', 'pipe:1',   # relatório máquina-legível de progresso no stdout
        dst,
    ]
    _run_with_progress(cmd, timeout=getattr(settings, 'FFMPEG_TIMEOUT', 1800),
                       step='converter o vídeo', on_progress=on_progress)
    if not os.path.exists(dst) or os.path.getsize(dst) == 0:
        raise VideoError('A conversão não gerou um arquivo válido.')


def _run_with_progress(cmd, timeout, step, on_progress=None):
    """Roda o ffmpeg lendo `-progress pipe:1` (stdout) linha a linha para reportar
    progresso, enquanto acumula o stderr para a mensagem de erro. Mata o processo
    no timeout. Sem shell — lista de argumentos."""
    import time
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, errors='replace', bufsize=1)
    except (OSError, ValueError) as e:
        raise VideoError(f'Falha ao executar o processamento ({step}).') from e

    deadline = time.monotonic() + timeout
    out_us = 0
    speed = None
    try:
        for line in proc.stdout:            # bloqueia por linha; ffmpeg emite blocos
            if time.monotonic() > deadline:
                proc.kill()
                raise VideoError(f'Tempo esgotado ao {step} (limite {timeout}s).')
            line = line.strip()
            if not line or '=' not in line:
                continue
            key, _, val = line.partition('=')
            if key in ('out_time_us', 'out_time_ms'):
                # out_time_ms é, historicamente, microssegundos no ffmpeg — tratamos
                # os dois como µs (out_time_us é o canônico).
                try:
                    out_us = int(val)
                except ValueError:
                    pass
            elif key == 'speed':
                v = val.replace('x', '').strip()
                try:
                    speed = float(v) if v not in ('', 'N/A') else speed
                except ValueError:
                    pass
            elif key == 'progress':
                if on_progress:
                    try:
                        on_progress(max(0.0, out_us / 1_000_000.0), speed)
                    except Exception:   # callback nunca derruba a conversão
                        logger.debug('on_progress falhou', exc_info=True)
                if val == 'end':
                    break
        # Espera o processo terminar e coleta o resto do stderr.
        try:
            proc.wait(timeout=max(1, int(deadline - time.monotonic())))
        except subprocess.TimeoutExpired:
            proc.kill()
            raise VideoError(f'Tempo esgotado ao {step} (limite {timeout}s).')
    finally:
        stderr = ''
        try:
            stderr = proc.stderr.read() or ''
        except Exception:
            pass
        try:
            proc.stdout.close(); proc.stderr.close()
        except Exception:
            pass
    if proc.returncode not in (0, None) and proc.returncode != 0:
        tail = _tail(stderr)
        logger.warning('ffmpeg/%s falhou (rc=%s): %s', step, proc.returncode, tail)
        raise VideoError(f'Falha ao {step}: {tail}')


def normalize_webm(src: str, dst: str, *, target_fps: int | None = None,
                   max_height: int | None = None, crf: int | None = None,
                   bitrate: str | None = None, cpu_used: int | None = None,
                   deadline: str | None = None, on_progress=None) -> None:
    """Gera a versão WebM **VP8/Vorbis** — a mais compatível com players Linux
    (GStreamer padrão do Ubuntu: `vp8dec`/`vorbisdec` vêm em plugins-good/base, que
    todo Ubuntu tem; VP9/Opus exigem plugins-bad/opus que NEM sempre estão presentes).
    Mesmas correções de timestamp/escala/pixel format do MP4. Áudio Vorbis quando
    houver; sem áudio é aceito normalmente."""
    ffmpeg = _bin('FFMPEG_BIN', 'ffmpeg')
    fps = plan_target_fps(src, override=target_fps)   # mesma cadência adaptativa do MP4
    max_height = max_height or getattr(settings, 'VIDEO_MAX_HEIGHT', 1080)
    crf = crf if crf is not None else getattr(settings, 'VIDEO_VP8_CRF', 10)
    bitrate = bitrate or getattr(settings, 'VIDEO_VP8_BITRATE', '1M')
    cpu_used = cpu_used if cpu_used is not None else getattr(settings, 'VIDEO_VP8_CPU_USED', 2)
    deadline = deadline or getattr(settings, 'VIDEO_VP8_DEADLINE', 'good')
    vf = (
        f"scale=-2:'min({max_height},ih)':flags=lanczos,"
        f"scale=trunc(iw/2)*2:trunc(ih/2)*2,"
        f"fps={fps},format=yuv420p"
    )
    cmd = [
        ffmpeg, '-y', '-loglevel', 'error', '-nostdin', '-nostats',
        '-fflags', '+genpts',
        '-i', src,
        '-map', '0:v:0', '-map', '0:a?',
        '-vf', vf,
        # VP8 (libvpx): -crf + -b:v definem a qualidade em modo VBR limitado.
        '-c:v', 'libvpx', '-crf', str(crf), '-b:v', bitrate,
        '-deadline', deadline, '-cpu-used', str(cpu_used),
        '-pix_fmt', 'yuv420p',
        '-c:a', 'libvorbis', '-q:a', '4',
        '-progress', 'pipe:1',
        dst,
    ]
    _run_with_progress(cmd, timeout=getattr(settings, 'VIDEO_WEBM_TIMEOUT', 3600),
                       step='converter para WebM', on_progress=on_progress)
    if not os.path.exists(dst) or os.path.getsize(dst) == 0:
        raise VideoError('A conversão WebM não gerou um arquivo válido.')


def make_thumbnail(src: str, dst: str, *, duration: float | None = None,
                   max_width: int = 640) -> None:
    """Extrai uma thumbnail JPEG de um frame REAL (evita o frame 0, que costuma ser
    preto). Escolhe ~10% da duração, limitado à faixa [1s, 10s]. Para vídeos muito
    curtos, cai para 0."""
    ffmpeg = _bin('FFMPEG_BIN', 'ffmpeg')
    if duration and duration > 0:
        ts = min(10.0, max(1.0, duration * 0.1))
        if duration < 1.2:
            ts = duration / 2.0
    else:
        ts = 1.0
    cmd = [
        ffmpeg, '-y', '-loglevel', 'error', '-nostdin',
        '-ss', f'{ts:.3f}', '-i', src,
        '-frames:v', '1',
        '-vf', f"scale='min({max_width},iw)':-2:flags=lanczos",
        '-q:v', '3',
        dst,
    ]
    try:
        _run(cmd, timeout=getattr(settings, 'THUMBNAIL_TIMEOUT', 120), step='gerar a miniatura')
    except VideoError:
        # 2ª tentativa no começo do vídeo (origem curtíssima / seek falhou).
        _run([ffmpeg, '-y', '-loglevel', 'error', '-nostdin', '-i', src,
              '-frames:v', '1', '-vf', f"scale='min({max_width},iw)':-2", '-q:v', '3', dst],
             timeout=getattr(settings, 'THUMBNAIL_TIMEOUT', 120), step='gerar a miniatura')
    if not os.path.exists(dst) or os.path.getsize(dst) == 0:
        raise VideoError('Não foi possível gerar a miniatura do vídeo.')


def validate_output(path: str) -> ProbeResult:
    """Valida o MP4 já convertido antes de publicá-lo no player. Confirma: MP4 com
    faixa de vídeo H.264, pixel format do navegador, duração > 0, dimensões válidas
    e decodificação sem erro fatal. Levanta VideoError se algo falhar."""
    info = probe(path)
    if 'mp4' not in info.format_name and 'mov' not in info.format_name:
        raise VideoError('O arquivo convertido não é um MP4 válido.')
    if info.codec != 'h264':
        raise VideoError(f'Codec inesperado após a conversão ({info.codec or "?"}).')
    if info.pix_fmt not in _BROWSER_SAFE_PIX_FMTS:
        raise VideoError(f'Pixel format incompatível após a conversão ({info.pix_fmt or "?"}).')
    if not info.duration or info.duration <= 0:
        raise VideoError('O vídeo convertido tem duração inválida.')
    if not info.width or not info.height:
        raise VideoError('O vídeo convertido tem dimensões inválidas.')
    if not decode_ok(path):
        raise VideoError('O vídeo convertido não pôde ser decodificado.')
    return info


def validate_output_webm(path: str) -> ProbeResult:
    """Valida o WebM (VP8) já convertido: contêiner WebM/Matroska, vídeo VP8 (aceita
    VP9 por compatibilidade com arquivos antigos), pixel format do navegador, duração
    > 0, dimensões válidas e decodificação sem erro fatal. Levanta VideoError se algo
    falhar."""
    info = probe(path)
    if 'webm' not in info.format_name and 'matroska' not in info.format_name:
        raise VideoError('O arquivo convertido não é um WebM válido.')
    if info.codec not in ('vp8', 'vp9'):
        raise VideoError(f'Codec inesperado no WebM ({info.codec or "?"}).')
    if info.pix_fmt not in _BROWSER_SAFE_PIX_FMTS:
        raise VideoError(f'Pixel format incompatível no WebM ({info.pix_fmt or "?"}).')
    if not info.duration or info.duration <= 0:
        raise VideoError('O WebM convertido tem duração inválida.')
    if not info.width or not info.height:
        raise VideoError('O WebM convertido tem dimensões inválidas.')
    if not decode_ok(path):
        raise VideoError('O WebM convertido não pôde ser decodificado.')
    return info


# ── util ──────────────────────────────────────────────────────────────────────

def _to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _rotation_of(stream: dict) -> int:
    """Rotação (0/90/180/270) a partir de tags ou side_data (display matrix)."""
    tags = stream.get('tags', {}) or {}
    rot = _to_int(tags.get('rotate'))
    if rot is None:
        for sd in stream.get('side_data_list', []) or []:
            if 'rotation' in sd:
                rot = _to_int(sd.get('rotation'))
                break
    if rot is None:
        return 0
    return abs(int(rot)) % 360

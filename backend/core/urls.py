import os
import re
import mimetypes

from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.http import FileResponse, HttpResponse, HttpResponseNotFound
from django.utils._os import safe_join

from .views import validate_email, healthz


def _serve_email_logo(request):
    # Logo dos e-mails — servido pelo próprio backend (o frontend agora é um
    # repositório separado, então o arquivo vive aqui em core/assets/).
    logo_path = settings.BASE_DIR / 'core' / 'assets' / 'logo-email.png'
    return FileResponse(open(logo_path, 'rb'), content_type='image/png')


_RANGE_RE = re.compile(r'bytes=(\d+)-(\d*)', re.I)


def _serve_media_range(request, path):
    """Serve /media/ em DESENVOLVIMENTO com suporte a HTTP Range (206).

    O django.views.static.serve devolve o arquivo inteiro (200, sem Accept-Ranges).
    O <video> do navegador PRECISA de Range para pegar os metadados/primeiro frame
    e para tocar/buscar — sem isso, o vídeo da Galeria fica preto e não roda. Em
    produção o /media é servido pelo nginx do backend (Range nativo); isto é só o
    espelho disso para o ambiente de desenvolvimento (DEBUG)."""
    try:
        full = safe_join(settings.MEDIA_ROOT, path)
    except Exception:
        return HttpResponseNotFound()
    if not os.path.isfile(full):
        return HttpResponseNotFound()
    ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
    size = os.path.getsize(full)
    m = _RANGE_RE.match(request.headers.get('Range') or '')
    if m:
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            resp = HttpResponse(status=416)
            resp['Content-Range'] = f'bytes */{size}'
            return resp
        length = end - start + 1
        with open(full, 'rb') as f:
            f.seek(start)
            data = f.read(length)
        resp = HttpResponse(data, status=206, content_type=ctype)
        resp['Content-Range'] = f'bytes {start}-{end}/{size}'
        resp['Content-Length'] = str(length)
    else:
        resp = FileResponse(open(full, 'rb'), content_type=ctype)
        resp['Content-Length'] = str(size)
    resp['Accept-Ranges'] = 'bytes'
    # Sem isto, o navegador cacheia a resposta heuristicamente (Last-Modified sem
    # Cache-Control) e, se cacheou uma versão SEM Range no passado, serve ela do
    # cache e o vídeo trava preto. no-cache = sempre revalida antes de reusar.
    resp['Cache-Control'] = 'no-cache'
    return resp


urlpatterns = [
    path('assets/logo.png', _serve_email_logo, name='email-logo'),
    path('healthz', healthz, name='healthz'),
    path('admin/', admin.site.urls),
    path('api/auth/', include('django.contrib.auth.urls')),
    path('api/validate-email/', validate_email, name='validate-email'),
    path('api/users/',     include('users_api.urls')),
    path('api/dashboard/', include('dashboard.urls')),
    path('api/agencies/',  include('agencies.urls')),
    path('api/passengers/', include('passengers.urls')),
    path('api/trips/', include('trips.urls')),
    path('api/config/',   include('config_api.urls')),
    path('api/audit/',    include('audit.urls')),
    path('api/agenda/',   include('agenda.urls')),
    path('api/contracts/', include('contracts.urls')),
    path('api/itineraries/', include('itineraries.urls')),
    path('api/laminas/', include('laminas.urls')),
    path('api/drive/', include('drive.urls')),
    path('api/vouchers/', include('vouchers.urls')),
]

# Servir /media/ pelo Django é APENAS para desenvolvimento local (DEBUG=True). Em
# produção (DEBUG=False) NÃO expomos /media/ — documentos sensíveis (CPF, RG,
# passaporte, contratos assinados) só saem por views autenticadas e com permissão
# (ex.: /api/passengers/documents/<id>/download/, /api/contracts/<id>/signed-file/).
# O nginx também bloqueia /media/ público (ver frontend/nginx.conf) como 2ª camada.
# static() já retornaria [] com DEBUG=False; o if deixa a intenção explícita (A-11).
if settings.DEBUG:
    # Range-capable (206) — necessário para tocar vídeo da Galeria no navegador.
    urlpatterns += [re_path(r'^media/(?P<path>.*)$', _serve_media_range)]

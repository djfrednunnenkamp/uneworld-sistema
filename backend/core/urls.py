from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import FileResponse

from .views import validate_email, healthz


def _serve_email_logo(request):
    # Logo dos e-mails — servido pelo próprio backend (o frontend agora é um
    # repositório separado, então o arquivo vive aqui em core/assets/).
    logo_path = settings.BASE_DIR / 'core' / 'assets' / 'logo-email.png'
    return FileResponse(open(logo_path, 'rb'), content_type='image/png')


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
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import FileResponse

from .views import validate_email


def _serve_email_logo(request):
    logo_path = settings.BASE_DIR.parent / 'frontend' / 'public' / 'logo-email.png'
    return FileResponse(open(logo_path, 'rb'), content_type='image/png')


urlpatterns = [
    path('assets/logo.png', _serve_email_logo, name='email-logo'),
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
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

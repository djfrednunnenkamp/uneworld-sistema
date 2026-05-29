from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/', include('django.contrib.auth.urls')),
    path('api/dashboard/', include('dashboard.urls')),
    path('api/agencies/',  include('agencies.urls')),
    path('api/passengers/', include('passengers.urls')),
    path('api/trips/', include('trips.urls')),
    path('api/meetings/', include('meetings.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

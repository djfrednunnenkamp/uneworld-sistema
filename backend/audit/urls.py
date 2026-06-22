from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import AuditLogViewSet, log_page_view, log_upload

router = DefaultRouter()
router.register('logs', AuditLogViewSet, basename='auditlog')

urlpatterns = [
    path('page-view/', log_page_view),
    path('log-upload/', log_upload),
    path('', include(router.urls)),
]

"""Rate limiting dos endpoints públicos sensíveis (auditoria IDS — A-04).

Throttles nativos do DRF (SimpleRateThrottle), um por escopo, todos chaveados
pelo IP REAL do cliente. Atrás de Cloudflare/nginx o IP do cliente vem no início
do X-Forwarded-For — usamos a MESMA lógica do AuditMiddleware (audit.middleware)
para não punir todo mundo pelo IP do proxy.

Só as views que aplicam explicitamente estes throttles (via @throttle_classes)
são limitadas; os endpoints internos normais não são afetados. As taxas vêm de
DEFAULT_THROTTLE_RATES em settings."""
from rest_framework.throttling import SimpleRateThrottle


def client_ip(request):
    """IP real do cliente. Confia no X-Forwarded-For (primeiro item) porque o
    tráfego chega sempre via nginx/Cloudflare; cai para REMOTE_ADDR em dev."""
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


class _IPScopedThrottle(SimpleRateThrottle):
    """Base: limita por (escopo, IP do cliente). A taxa é lida de
    DEFAULT_THROTTLE_RATES[self.scope]."""
    def get_cache_key(self, request, view):
        ident = client_ip(request)
        if not ident:
            return None  # sem IP identificável → não dá pra limitar com segurança
        return self.cache_format % {'scope': self.scope, 'ident': ident}


class LoginRateThrottle(_IPScopedThrottle):
    scope = 'login'


class PasswordResetRateThrottle(_IPScopedThrottle):
    scope = 'password_reset'


class InviteRateThrottle(_IPScopedThrottle):
    scope = 'invite'


class WebhookRateThrottle(_IPScopedThrottle):
    scope = 'webhook'

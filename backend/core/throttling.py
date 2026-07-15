"""Rate limiting dos endpoints públicos sensíveis (auditoria IDS — A-04).

Throttles nativos do DRF (SimpleRateThrottle), um por escopo, todos chaveados
pelo IP REAL do cliente. Atrás de Cloudflare/nginx o IP do cliente vem no início
do X-Forwarded-For — usamos a MESMA lógica do AuditMiddleware (audit.middleware)
para não punir todo mundo pelo IP do proxy.

Só as views que aplicam explicitamente estes throttles (via @throttle_classes)
são limitadas; os endpoints internos normais não são afetados. As taxas vêm de
DEFAULT_THROTTLE_RATES em settings."""
from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


def client_ip(request):
    """IP real do cliente para rate-limit/auditoria.

    O X-Forwarded-For é uma lista "cliente, proxy1, proxy2, …": o proxy mais
    próximo do Django ACRESCENTA à direita. O item da ESQUERDA é fornecido pelo
    cliente e pode ser forjado — usá-lo (como antes) deixava o atacante trocar a
    chave de rate-limit a cada request, burlando o limite de brute-force. Pegamos
    o IP a `TRUSTED_PROXY_COUNT` posições a partir da DIREITA (o que o nosso proxy
    de fato observou). Default 1 = um nginx na frente; ajuste para 2 atrás de
    Cloudflare→nginx. Cai para REMOTE_ADDR em dev (sem proxy)."""
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        parts = [p.strip() for p in xff.split(',') if p.strip()]
        if parts:
            n = getattr(settings, 'TRUSTED_PROXY_COUNT', 1) or 1
            return parts[-min(n, len(parts))]
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

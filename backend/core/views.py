from django.db import connection
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .email_validation import check_email


@csrf_exempt
def healthz(request):
    """Health check para o Docker/monitoramento (público, sem auth). Verifica que
    o processo está de pé E que as dependências críticas respondem: banco (SELECT 1)
    e cache/Redis. Retorna 200 {status:ok} ou 503 com o que falhou. Não expõe
    detalhes sensíveis. Usado pelo healthcheck do compose e por uptime externo."""
    checks = {}
    ok = True
    try:
        with connection.cursor() as c:
            c.execute('SELECT 1')
            c.fetchone()
        checks['db'] = 'ok'
    except Exception:
        checks['db'] = 'fail'
        ok = False
    try:
        cache.set('healthz', '1', 5)
        checks['cache'] = 'ok' if cache.get('healthz') == '1' else 'fail'
        ok = ok and checks['cache'] == 'ok'
    except Exception:
        checks['cache'] = 'fail'
        ok = False
    return JsonResponse({'status': 'ok' if ok else 'degraded', 'checks': checks},
                        status=200 if ok else 503)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def validate_email(request):
    """Verifica um e-mail (formato + domínio MX) e sugere correção de domínio.

    GET /api/validate-email/?email=fulano@gmial.com
    -> {valid, reason, suggestion, suggested_email}

    Usado pelos formulários ao sair do campo de e-mail, para avisar na hora
    quando o domínio não existe ou parece digitado errado.
    """
    return Response(check_email(request.GET.get('email', '')))

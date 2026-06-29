from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .email_validation import check_email


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

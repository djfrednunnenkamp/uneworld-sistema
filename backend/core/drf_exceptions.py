from rest_framework.views import exception_handler as drf_exception_handler
from rest_framework.exceptions import NotAuthenticated, AuthenticationFailed
from rest_framework import status


def exception_handler(exc, context):
    """
    Com `SessionAuthentication`, o DRF responde **403** para requisições NÃO
    autenticadas (sessão expirada/ausente) — o MESMO status de "sem permissão".
    Isso impede o front de distinguir "faça login de novo" de "você não tem
    permissão para isso".

    Aqui forçamos **401** quando o problema é falta de autenticação, deixando o
    403 exclusivamente para permissão negada de verdade. Assim o front pode, ao
    ver 401, derrubar o usuário para a tela de login automaticamente.
    """
    response = drf_exception_handler(exc, context)
    if response is not None and isinstance(exc, (NotAuthenticated, AuthenticationFailed)):
        response.status_code = status.HTTP_401_UNAUTHORIZED
    return response

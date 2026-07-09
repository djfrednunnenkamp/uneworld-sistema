import threading

_local = threading.local()


def get_current_user():
    return getattr(_local, 'user', None)


def get_current_ip():
    return getattr(_local, 'ip', None)


class AuditMiddleware:
    """Armazena o usuário e IP da requisição atual em thread-local para uso nos sinais."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            _local.user = request.user if request.user.is_authenticated else None
        except Exception:
            _local.user = None

        # IP real do cliente com a MESMA lógica anti-spoof do rate-limit (pega o
        # IP observado pelo proxy confiável, não o item forjável da esquerda do XFF).
        from core.throttling import client_ip
        _local.ip = client_ip(request)

        try:
            return self.get_response(request)
        finally:
            # Threads de worker são reaproveitadas entre requisições. Se não limparmos,
            # uma requisição posterior que não passe por aqui (ou sinais disparados depois)
            # herdam o usuário/IP da requisição anterior — atribuindo ações ao usuário errado.
            _local.user = None
            _local.ip = None

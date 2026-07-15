import asyncio
import logging


class SkipClientCancelled(logging.Filter):
    """Descarta o ruído de CancelledError que aparece quando o cliente desconecta
    no meio da requisição (ex.: uma aba fechada cancela as requisições em
    andamento, ou o usuário navega antes da resposta chegar).

    Não é um erro da aplicação — a resposta já foi abandonada pelo cliente —,
    então esses tracebacks só poluem o console. Erros reais (com outra exceção)
    continuam passando normalmente."""

    def filter(self, record):
        exc = record.exc_info[1] if record.exc_info else None
        if isinstance(exc, asyncio.CancelledError):
            return False
        try:
            msg = record.getMessage()
        except Exception:
            msg = ''
        if 'CancelledError' in msg:
            return False
        return True

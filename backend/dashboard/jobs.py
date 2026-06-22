"""Execução de tarefas longas (importações da internet) em background,
com progresso reportado em tempo real via WebSocket (grupo 'dashboard').

Uso:
    from dashboard.jobs import run_job

    def view(request):
        def task(progress):
            progress(0, total)
            ... progress(i, total) a cada item ...
            return {'created': n}
        job_id = run_job('vaccines', 'Vacinas', task)
        return Response({'job_id': job_id}, status=202)
"""
import threading
import uuid
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

GROUP = 'dashboard'


def _send(payload):
    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(GROUP, {'type': 'dashboard.job', **payload})


def run_job(kind, label, fn):
    """Executa fn(progress_callback) numa thread daemon, reportando progresso.

    fn deve chamar progress_callback(done, total) periodicamente e pode
    devolver um dict (mesclado no evento final de status='done')."""
    job_id = uuid.uuid4().hex[:10]

    def progress(done, total):
        _send({'job_id': job_id, 'kind': kind, 'label': label,
               'done': done, 'total': max(total, done, 1), 'status': 'running'})

    def runner():
        progress(0, 1)
        try:
            result = fn(progress) or {}
            _send({'job_id': job_id, 'kind': kind, 'label': label, 'status': 'done', **result})
            # Avisa as telas abertas para recarregar a seção (uma única vez, no final)
            async_to_sync(get_channel_layer().group_send)(GROUP, {'type': 'dashboard.refresh', 'scope': 'config'}) \
                if get_channel_layer() else None
        except Exception as e:
            _send({'job_id': job_id, 'kind': kind, 'label': label, 'status': 'error', 'error': str(e)})

    threading.Thread(target=runner, daemon=True).start()
    return job_id

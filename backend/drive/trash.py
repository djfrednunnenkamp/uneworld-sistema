"""Lixeira do Drive: soft-delete em cascata, restauração e expurgo automático.

Excluir um nó manda ele E toda a subárvore (pastas/arquivos dentro) para os
"Excluídos", sem apagar nada do banco nem do disco. Fica 30 dias e é apagado de
vez pelo expurgo (agenda/scheduler chama purge_expired de hora em hora). Dá pra
restaurar a qualquer momento nesse meio-tempo.
"""
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone


def _subtree(node):
    """node + todos os descendentes (pastas e arquivos), incluindo os já excluídos."""
    out = [node]
    stack = [node]
    while stack:
        n = stack.pop()
        kids = list(n.children.all())
        out.extend(kids)
        stack.extend(kids)
    return out


def soft_delete(node):
    """Manda o nó e a subárvore para a lixeira, no mesmo instante (um 'delete')."""
    from .models import DriveNode
    now = timezone.now()
    nodes = _subtree(node)
    for n in nodes:
        n.is_deleted = True
        n.deleted_at = now
    DriveNode.objects.bulk_update(nodes, ['is_deleted', 'deleted_at'])
    return len(nodes)


def restore(node):
    """Tira o nó e a subárvore da lixeira. Se a pasta-mãe também estiver na lixeira
    (ou não existir mais), reancora na raiz para não ficar preso num pai excluído."""
    from .models import DriveNode
    nodes = _subtree(node)
    for n in nodes:
        n.is_deleted = False
        n.deleted_at = None
    if node.parent_id and node.parent.is_deleted:
        node.parent = None
    DriveNode.objects.bulk_update(nodes, ['is_deleted', 'deleted_at'])
    node.save(update_fields=['parent'])
    return len(nodes)


def delete_subtree_files(node):
    """Best-effort: apaga os arquivos físicos do nó e descendentes (file, thumb,
    versões). Usado só no expurgo definitivo — o soft-delete NÃO toca em arquivos."""
    for n in _subtree(node):
        if n.file:
            try: n.file.delete(save=False)
            except Exception: pass
        if n.thumb:
            try: n.thumb.delete(save=False)
            except Exception: pass
        for v in n.versions.all():
            if v.file:
                try: v.file.delete(save=False)
                except Exception: pass
            if v.changes_file:
                try: v.changes_file.delete(save=False)
                except Exception: pass


def purge_expired(days=30):
    """Apaga DE VEZ (arquivos + banco) os itens na lixeira há mais de `days` dias.
    Só percorre as RAÍZES da lixeira (pai não excluído): o delete em cascata do
    banco leva os descendentes junto. Retorna quantas raízes foram expurgadas."""
    from .models import DriveNode
    cutoff = timezone.now() - timedelta(days=days)
    roots = (DriveNode.objects
             .filter(is_deleted=True, deleted_at__lt=cutoff)
             .filter(Q(parent__isnull=True) | Q(parent__is_deleted=False)))
    count = 0
    for node in list(roots):
        delete_subtree_files(node)
        node.delete()   # cascata do banco apaga os filhos
        count += 1
    return count

"""Limpeza dos arquivos físicos de mídia.

O Django NÃO apaga o arquivo do disco quando o registro é excluído nem quando o
FileField/ImageField é trocado por outro. Este módulo conecta sinais para os
modelos que guardam arquivos e resolve isso:

  • post_delete → apaga o arquivo quando o registro é EXCLUÍDO DE VERDADE. Isso
    inclui a cascata do `purge` (exclusão definitiva). O soft-delete (que só
    marca is_deleted=True, sem chamar .delete()) NÃO dispara nada — então um
    contrato na lixeira mantém o PDF; só o purge o remove.
  • pre_save → quando o arquivo de um registro existente é substituído por outro,
    apaga o arquivo antigo (evita órfãos ao trocar, ex.: assinatura do CEO/foto).

Registrado em dashboard/apps.py ready().
"""
import logging

from django.db.models.signals import post_delete, pre_save
from django.apps import apps as django_apps

logger = logging.getLogger(__name__)

# label do modelo -> campos de arquivo
_FILE_FIELDS = {
    'contracts.Contract':          ('signed_file', 'payment_receipt'),
    'config_api.OperatingCompany': ('ceo_signature',),
    'trips.Destination':           ('image',),
    'itineraries.ItineraryImage':  ('image',),
    'passengers.Passenger':        ('photo',),
    'passengers.PassengerDocument': ('file',),
}

_handlers = []  # mantém referências fortes (weak=False não basta p/ closures)


def _delete_file(fieldfile):
    """Remove o arquivo do storage. storage.delete() é idempotente (ignora
    arquivo inexistente), então é seguro chamar sempre."""
    try:
        if fieldfile and fieldfile.name:
            fieldfile.storage.delete(fieldfile.name)
    except Exception:
        # Best-effort: a falha não interrompe a operação principal, mas fica um
        # arquivo órfão no storage — registra para observabilidade/limpeza.
        logger.warning('Falha ao remover arquivo físico do storage (%s).',
                       getattr(fieldfile, 'name', '?'), exc_info=True)


def delete_fieldfile(fieldfile, context=''):
    """Best-effort: remove o arquivo físico via FieldFile.delete(save=False).

    Usado nos pontos que trocam/podem arquivos manualmente (avatar, logo, versões
    do Drive, expurgo). A falha NÃO interrompe a ação principal — só gera um
    arquivo órfão no storage, então apenas registra em log (antes era engolida
    com `except: pass`, sem qualquer rastro)."""
    if not fieldfile:
        return
    try:
        fieldfile.delete(save=False)
    except Exception:
        logger.warning('Falha ao remover arquivo físico%s.',
                       f' ({context})' if context else '', exc_info=True)


def _make_post_delete(fields):
    def handler(sender, instance, **kwargs):
        for f in fields:
            _delete_file(getattr(instance, f, None))
    return handler


def _make_pre_save(fields):
    def handler(sender, instance, **kwargs):
        if not instance.pk:
            return   # criação: não há arquivo antigo
        try:
            old = sender.objects.get(pk=instance.pk)
        except sender.DoesNotExist:
            return
        for f in fields:
            old_ff = getattr(old, f, None)
            old_name = getattr(old_ff, 'name', None)
            new_name = getattr(getattr(instance, f, None), 'name', None)
            if old_name and old_name != new_name:
                _delete_file(old_ff)
    return handler


def register_file_cleanup():
    for label, fields in _FILE_FIELDS.items():
        model = django_apps.get_model(label)
        pd, ps = _make_post_delete(fields), _make_pre_save(fields)
        _handlers.extend([pd, ps])
        post_delete.connect(pd, sender=model, weak=False, dispatch_uid=f'filecleanup_pd_{label}')
        pre_save.connect(ps, sender=model, weak=False, dispatch_uid=f'filecleanup_ps_{label}')

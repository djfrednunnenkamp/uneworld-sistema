import tempfile
from io import BytesIO

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.test import TestCase, override_settings

from users_api.permissions import get_user_permissions
from audit.models import AuditLog, AuditActorAvatar
from audit.tracking import log_event
from audit.retention import prune_orphan_avatars

_MEDIA = tempfile.mkdtemp()


def _png(color=(1, 2, 3)):
    from PIL import Image
    b = BytesIO()
    Image.new('RGB', (4, 4), color).save(b, 'PNG')
    return b.getvalue()


@override_settings(MEDIA_ROOT=_MEDIA)
class AvatarSnapshotTest(TestCase):
    """A foto do autor é CONGELADA no momento do log: trocar/remover a foto depois
    não altera os logs antigos; a mesma foto é compartilhada (dedupe); e a cópia é
    removida do banco quando o último log que a referencia é apagado."""

    def _mk(self, username):
        u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
        get_user_permissions(u)
        return u

    def _set_avatar(self, user, data):
        perms = get_user_permissions(user)
        perms.avatar.save('avatar.png', ContentFile(data), save=True)
        return User.objects.get(pk=user.pk)   # limpa o cache do relacionamento

    def test_freezes_and_dedupes(self):
        u = self._set_avatar(self._mk('actor'), _png())
        log_event('update', model_name='Contract', model_label='Contrato', user=u)
        l1 = AuditLog.objects.latest('id')
        self.assertIsNotNone(l1.actor_avatar_id)
        # Segundo log com a MESMA foto → reaproveita a mesma cópia (dedupe).
        log_event('update', model_name='Contract', model_label='Contrato', user=u)
        l2 = AuditLog.objects.latest('id')
        self.assertEqual(l2.actor_avatar_id, l1.actor_avatar_id)
        self.assertEqual(AuditActorAvatar.objects.count(), 1)

    def test_changing_photo_keeps_old_log_frozen(self):
        u = self._set_avatar(self._mk('actor2'), _png((10, 20, 30)))
        log_event('update', model_name='Contract', model_label='Contrato', user=u)
        old = AuditLog.objects.latest('id')
        old_avatar_id = old.actor_avatar_id
        old_url = old.actor_avatar.image.url
        # Troca a foto e loga de novo → snapshot NOVO; o log antigo NÃO muda.
        u = self._set_avatar(u, _png((200, 100, 50)))
        log_event('update', model_name='Contract', model_label='Contrato', user=u)
        new = AuditLog.objects.latest('id')
        self.assertNotEqual(new.actor_avatar_id, old_avatar_id)
        old.refresh_from_db()
        self.assertEqual(old.actor_avatar_id, old_avatar_id)
        self.assertEqual(old.actor_avatar.image.url, old_url)
        self.assertEqual(AuditActorAvatar.objects.count(), 2)

    def test_gc_removes_photo_after_last_log(self):
        u = self._set_avatar(self._mk('actor3'), _png((7, 7, 7)))
        log_event('update', model_name='Contract', model_label='Contrato', user=u)
        log_event('update', model_name='Contract', model_label='Contrato', user=u)
        self.assertEqual(AuditActorAvatar.objects.count(), 1)
        logs = list(AuditLog.objects.filter(model_name='Contract').order_by('id'))
        # Apaga UM log → ainda há outro referenciando a foto → NÃO remove.
        logs[0].delete()
        self.assertEqual(prune_orphan_avatars(), 0)
        self.assertEqual(AuditActorAvatar.objects.count(), 1)
        # Apaga o ÚLTIMO log que usa a foto → agora sim é removida do banco.
        logs[1].delete()
        self.assertEqual(prune_orphan_avatars(), 1)
        self.assertEqual(AuditActorAvatar.objects.count(), 0)

    def test_no_avatar_no_snapshot(self):
        u = self._mk('actor4')   # sem foto
        log_event('update', model_name='Contract', model_label='Contrato', user=u)
        self.assertIsNone(AuditLog.objects.latest('id').actor_avatar_id)

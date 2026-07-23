"""Selo "Público · pendente" (has_unpublished_changes) via /set-pending/.

O FRONT é a autoridade do diff (compara a foto publicada com o estado vivo, com
toda a normalização). Quando esse diff zera — o usuário reverteu tudo de volta ao
publicado — o selo tem que voltar sozinho para "publicado". Esta action é o que
grava esse desligamento (e o religamento) no back.
"""
from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from users_api.models import UserPermissions
from itineraries.models import Itinerary


def make_user(username, superuser=False, **perms):
    u = User.objects.create_user(username=username, email=f'{username}@x.com', password='pw12345678')
    if superuser:
        u.is_superuser = True; u.is_staff = True; u.save()
    p, _ = UserPermissions.objects.get_or_create(user=u)
    for k, v in perms.items():
        setattr(p, k, v)
    p.save()
    return u


class SetPendingTest(APITestCase):
    def setUp(self):
        self.editor = make_user('editor', roteiros_edit=True)
        self.client.force_authenticate(self.editor)
        self.it = Itinerary.objects.create(name='Sel', base_currency='USD',
                                           is_published=True, has_unpublished_changes=True)

    def _post(self, pending):
        return self.client.post(f'/api/itineraries/{self.it.id}/set-pending/', {'pending': pending}, format='json')

    def test_clears_flag_when_diff_empty(self):
        r = self._post(False)
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()['has_unpublished_changes'])
        self.it.refresh_from_db()
        self.assertFalse(self.it.has_unpublished_changes)

    def test_sets_flag_when_diff_returns(self):
        self.it.has_unpublished_changes = False; self.it.save()
        r = self._post(True)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['has_unpublished_changes'])
        self.it.refresh_from_db()
        self.assertTrue(self.it.has_unpublished_changes)

    def test_noop_when_not_published(self):
        self.it.is_published = False; self.it.has_unpublished_changes = False; self.it.save()
        r = self._post(True)
        self.assertEqual(r.status_code, 200)
        self.it.refresh_from_db()
        # Roteiro não publicado não tem estado "pendente" — nada muda.
        self.assertFalse(self.it.has_unpublished_changes)

    def test_requires_edit_permission(self):
        viewer = make_user('viewer', roteiros_view=True)
        self.client.force_authenticate(viewer)
        r = self._post(False)
        self.assertEqual(r.status_code, 403)
        self.it.refresh_from_db()
        self.assertTrue(self.it.has_unpublished_changes)   # não mexeu

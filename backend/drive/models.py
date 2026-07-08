import os
import uuid
from django.db import models
from django.contrib.auth.models import User


def drive_upload_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()
    return f"drive/{instance.owner_id}/{uuid.uuid4().hex}{ext}"


def drive_thumb_path(instance, filename):
    return f"drive/thumbs/{instance.owner_id}/{uuid.uuid4().hex}.png"


def drive_version_path(instance, filename):
    node = instance.node
    ext = os.path.splitext(node.file.name)[1].lower() if (node and node.file) else '.dat'
    owner = node.owner_id if node else 0
    return f"drive/versions/{owner}/{uuid.uuid4().hex}{ext}"


class DriveNode(models.Model):
    """Um item do "Drive" do usuário: uma PASTA ou um ARQUIVO. Cada nó pertence a
    um dono e pode estar dentro de uma pasta (parent). PRIVADO por padrão — só o
    dono vê — mas pode ser compartilhado com outros usuários (shared_with) e, se
    DRIVE_SUPERUSER_ACCESS estiver ligado, o superusuário vê tudo."""
    KIND_CHOICES = [('folder', 'Pasta'), ('file', 'Arquivo')]

    owner  = models.ForeignKey(User, on_delete=models.CASCADE, related_name='drive_nodes')
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.CASCADE, related_name='children')
    kind   = models.CharField(max_length=10, choices=KIND_CHOICES)
    name   = models.CharField(max_length=255)

    file          = models.FileField(upload_to=drive_upload_path, null=True, blank=True)
    original_name = models.CharField(max_length=255, blank=True)
    file_size     = models.PositiveBigIntegerField(default=0)
    mime_type     = models.CharField(max_length=150, blank=True)
    # Miniatura (snapshot da 1ª página) gerada sob demanda pelo OnlyOffice.
    # Invalidada (apagada) sempre que o conteúdo muda.
    thumb         = models.FileField(upload_to=drive_thumb_path, null=True, blank=True)

    shared_with = models.ManyToManyField(User, blank=True, related_name='drive_shared_with_me')

    # Muda a cada salvamento vindo do OnlyOffice → invalida o cache do editor.
    edit_key = models.CharField(max_length=40, blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # Pastas antes de arquivos ('folder' > 'file' → -kind), depois por nome.
        ordering = ['-kind', 'name']

    def __str__(self):
        return f'{self.get_kind_display()}: {self.name}'

    @property
    def is_image(self):
        return (self.mime_type or '').startswith('image/')

    def can_access(self, user):
        """O usuário pode ver/abrir este nó? Dono, ou compartilhado com ele (direto
        ou por uma pasta-mãe compartilhada), ou superusuário com acesso liberado."""
        if not user or not getattr(user, 'is_authenticated', False):
            return False
        if self.owner_id == user.id:
            return True
        from django.conf import settings
        if getattr(user, 'is_superuser', False) and getattr(settings, 'DRIVE_SUPERUSER_ACCESS', False):
            return True
        node = self
        seen = 0
        while node is not None and seen < 100:
            if node.shared_with.filter(pk=user.id).exists():
                return True
            node = node.parent
            seen += 1
        return False


class DriveNodeVersion(models.Model):
    """Snapshot de uma versão de um arquivo do Drive (histórico estilo Google Docs).
    Guardado a cada salvamento vindo do editor (e na criação/upload), com quem
    editou e quando. Permite restaurar o arquivo para aquele ponto."""
    node       = models.ForeignKey(DriveNode, on_delete=models.CASCADE, related_name='versions')
    file       = models.FileField(upload_to=drive_version_path)
    file_size  = models.PositiveBigIntegerField(default=0)
    edited_by  = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='drive_versions')
    edited_by_name = models.CharField(max_length=255, blank=True)   # nome no momento (caso o usuário suma)
    note       = models.CharField(max_length=255, blank=True)       # ex.: "Criado", "Restaurado da versão de …"
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def __str__(self):
        return f'v{self.id} de {self.node_id}'

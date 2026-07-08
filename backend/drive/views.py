import io
import os
import urllib.request
import zipfile
from django.conf import settings
from django.core.files.base import ContentFile
from django.db.models import Q
from django.http import FileResponse, Http404
from django.utils.crypto import get_random_string
from django.views.decorators.csrf import csrf_exempt
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser

from itineraries import blank_office, onlyoffice
from users_api.permissions import RequirePermission, has_any_perm
from .models import DriveNode, DriveNodeVersion
from .serializers import DriveNodeSerializer, _user_label


def _safe(name):
    """Nome seguro para entrada de zip: sem barras nem componentes de caminho."""
    return (name or 'arquivo').replace('/', '_').replace('\\', '_').strip() or 'arquivo'


def snapshot_version(node, user=None, name='', note='', max_keep=50):
    """Guarda uma cópia do conteúdo ATUAL do arquivo como uma versão do histórico.
    Chamar DEPOIS de gravar node.file. Poda mantendo as `max_keep` mais recentes."""
    if not node.file:
        return None
    try:
        fh = node.file.open('rb'); content = fh.read(); fh.close()
    except Exception:
        return None
    label = name or (_user_label(user) if user else '')
    v = DriveNodeVersion(
        node=node,
        edited_by=user if (user and getattr(user, 'is_authenticated', False)) else None,
        edited_by_name=label, note=note, file_size=len(content),
        doc_key=get_random_string(20))
    v.file.save(f'{node.id}.dat', ContentFile(content), save=True)
    # Poda versões antigas (guarda só as mais recentes).
    for old in list(node.versions.all()[max_keep:]):
        try: old.file.delete(save=False)
        except Exception: pass
        old.delete()
    return v


def _breadcrumb(folder):
    crumb, node, seen = [], folder, 0
    while node is not None and seen < 100:
        crumb.insert(0, {'id': node.id, 'name': node.name})
        node = node.parent
        seen += 1
    return crumb


class DriveNodeViewSet(viewsets.ModelViewSet):
    """Drive do usuário — pastas e arquivos, privados por padrão."""
    serializer_class   = DriveNodeSerializer
    permission_classes = [IsAuthenticated]
    parser_classes     = [JSONParser, MultiPartParser, FormParser]

    def get_permissions(self):
        # Cada ação exige a permissão de Documentos correspondente. "Ver" é a base;
        # criar/enviar/editar/compartilhar/excluir/apagar têm as suas. Superusuário
        # passa em qualquer uma (has_any_perm/RequirePermission já tratam isso).
        a = self.action
        if a == 'create':                     # criar PASTA — quem cria docs OU envia arquivos
            need = ('documentos_create', 'documentos_upload')
        elif a == 'create_blank':
            need = ('documentos_create',)
        elif a == 'upload':
            need = ('documentos_upload',)
        elif a in ('share', 'shareable_users', 'transfer'):
            need = ('documentos_share',)
        elif a == 'destroy':
            need = ('documentos_delete',)
        elif a == 'purge':
            need = ('documentos_purge',)
        elif a in ('update', 'partial_update', 'restore_version'):
            need = ('documentos_edit',)
        else:
            # list/retrieve/config/download/preview/history/details/thumb/restore…
            need = ('documentos_view',)
        return [IsAuthenticated(), RequirePermission(*need)()]

    def get_queryset(self):
        # Ações que mexem no próprio nó operam só sobre os do dono e FORA da lixeira
        # (item excluído não pode ser aberto/editado/baixado). A leitura de arquivos
        # compartilhados passa por can_access nas actions de download.
        return DriveNode.objects.filter(owner=self.request.user, is_deleted=False)

    def _accessible_folder(self, parent_id):
        """Devolve a pasta se o usuário pode acessá-la, senão None."""
        if not parent_id:
            return None
        f = DriveNode.objects.filter(pk=parent_id, kind='folder', is_deleted=False).first()
        if f and f.can_access(self.request.user):
            return f
        return False   # explicit "not allowed / not found"

    def list(self, request):
        u = request.user
        # Lixeira: itens excluídos do dono. Mostra só as RAÍZES (pai não excluído):
        # excluir uma pasta manda o conteúdo junto, e ele aparece "dentro" dela — não
        # solto na lista. Ordena pelos excluídos mais recentes.
        if request.query_params.get('deleted'):
            qs = (DriveNode.objects.filter(owner=u, is_deleted=True)
                  .filter(Q(parent__isnull=True) | Q(parent__is_deleted=False))
                  .order_by('-deleted_at'))
            return Response({'breadcrumb': [], 'folder': None, 'trash': True,
                             'nodes': DriveNodeSerializer(qs, many=True, context={'request': request}).data})
        if request.query_params.get('shared'):
            qs = DriveNode.objects.filter(shared_with=u, is_deleted=False).distinct()
            return Response({'breadcrumb': [], 'folder': None, 'shared': True,
                             'nodes': DriveNodeSerializer(qs, many=True, context={'request': request}).data})
        parent_id = request.query_params.get('parent') or None
        folder = self._accessible_folder(parent_id)
        if folder is False:
            return Response({'error': 'Pasta não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        children = (folder.children.filter(is_deleted=False) if folder
                    else DriveNode.objects.filter(owner=u, parent__isnull=True, is_deleted=False))
        return Response({
            'breadcrumb': _breadcrumb(folder),
            'folder': ({'id': folder.id, 'name': folder.name, 'is_owner': folder.owner_id == u.id} if folder else None),
            'nodes': DriveNodeSerializer(children, many=True, context={'request': request}).data,
        })

    def create(self, request, *args, **kwargs):
        """Cria uma PASTA. { name, parent? }"""
        name = (request.data.get('name') or 'Nova pasta').strip()[:255]
        folder = self._accessible_folder(request.data.get('parent'))
        if folder is False:
            return Response({'error': 'Pasta inválida.'}, status=status.HTTP_400_BAD_REQUEST)
        node = DriveNode.objects.create(owner=request.user, kind='folder', name=name, parent=folder or None)
        return Response(DriveNodeSerializer(node, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def upload(self, request):
        """Upload de arquivo(s). multipart: file (um ou vários), parent?"""
        folder = self._accessible_folder(request.data.get('parent'))
        if folder is False:
            return Response({'error': 'Pasta inválida.'}, status=status.HTTP_400_BAD_REQUEST)
        files = request.FILES.getlist('file') or ([request.FILES['file']] if 'file' in request.FILES else [])
        if not files:
            return Response({'error': 'Nenhum arquivo enviado.'}, status=status.HTTP_400_BAD_REQUEST)
        # Sem "enviar não-Office", só Word/Excel/PowerPoint. Qualquer outro tipo
        # (imagem, PDF, zip…) exige documentos_upload_any.
        if not has_any_perm(request.user, 'documentos_upload_any'):
            blocked = [f.name for f in files if onlyoffice.office_document_type(f.name) not in ('word', 'cell', 'slide')]
            if blocked:
                return Response({'error': 'Você só pode enviar Word, Excel ou PowerPoint. '
                                          'Sem permissão para enviar outros tipos (imagem, PDF, zip…).'},
                                status=status.HTTP_403_FORBIDDEN)
        created = []
        for f in files:
            node = DriveNode(owner=request.user, kind='file', parent=folder or None,
                             name=f.name, original_name=f.name,
                             file_size=getattr(f, 'size', 0) or 0,
                             mime_type=getattr(f, 'content_type', '') or '')
            node.file.save(f.name, f, save=False)
            node.save()
            if onlyoffice.office_document_type(node.name or ''):
                snapshot_version(node, user=request.user, note='Enviado')
            from audit.tracking import log_event
            log_event('upload', model_name='DriveNode', model_label='Documento',
                      object_id=node.id, object_repr=node.name, user=request.user)
            created.append(node)
        return Response(DriveNodeSerializer(created, many=True, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='create_blank')
    def create_blank(self, request):
        """Cria um documento Office EM BRANCO (Word/Excel/PowerPoint) já no Drive,
        pronto para editar no navegador. body: { parent?, kind, name? }.
        kind = word|cell|slide."""
        kind = request.data.get('kind')
        ext = blank_office.KIND_EXT.get(kind)
        if not ext:
            return Response({'error': 'Tipo inválido (use word, cell ou slide).'}, status=status.HTTP_400_BAD_REQUEST)
        folder = self._accessible_folder(request.data.get('parent'))
        if folder is False:
            return Response({'error': 'Pasta inválida.'}, status=status.HTTP_400_BAD_REQUEST)
        default = {'word': 'Documento', 'cell': 'Planilha', 'slide': 'Apresentação'}[kind]
        name = (request.data.get('name') or '').strip() or default
        if not name.lower().endswith('.' + ext):
            name = f'{name}.{ext}'
        content = blank_office.blank_file(kind)
        node = DriveNode(owner=request.user, kind='file', parent=folder or None,
                         name=name, original_name=name, file_size=len(content))
        node.file.save(f'novo.{ext}', ContentFile(content), save=False)
        node.save()
        snapshot_version(node, user=request.user, note='Criado')
        from audit.tracking import log_event
        log_event('create', model_name='DriveNode', model_label='Documento',
                  object_id=node.id, object_repr=node.name, user=request.user)
        return Response(DriveNodeSerializer(node, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='config')
    def config(self, request, pk=None):
        """Config assinada para abrir o arquivo no editor OnlyOffice no navegador."""
        node = DriveNode.objects.filter(pk=pk, kind='file').first()
        if node is None or not node.file:
            raise Http404
        if not node.can_access(request.user):
            return Response({'detail': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)
        if not onlyoffice.is_configured():
            return Response({'detail': 'Editor OnlyOffice não configurado.'}, status=status.HTTP_409_CONFLICT)
        # Nível de acesso: o DONO edita se tiver documentos_edit; quem recebeu o
        # compartilhamento usa o NÍVEL concedido (ver / comentar / editar).
        if node.owner_id == request.user.id:
            can_edit = has_any_perm(request.user, 'documentos_edit')
            can_comment = can_edit
        else:
            level = node.share_level_for(request.user)
            can_edit = (level == 'edit')
            can_comment = (level in ('edit', 'comment'))
        try:
            return Response(onlyoffice.build_editor_config(
                doc_key=f'drive{node.id}', edit_key=node.edit_key,
                fname=node.name or node.file.name, file_url=node.file.url,
                callback_url=f'/api/drive/{node.id}/callback/',
                user=request.user, user_can_edit=can_edit, can_comment=can_comment,
                allow_download=False))   # Drive: tudo fica virtual, sem baixar
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def partial_update(self, request, *args, **kwargs):
        """Renomear ({name}) e/ou mover ({parent})."""
        node = self.get_object()   # só do dono (get_queryset)
        if 'name' in request.data:
            node.name = (request.data.get('name') or node.name).strip()[:255] or node.name
        if 'parent' in request.data:
            new_parent = self._accessible_folder(request.data.get('parent'))
            if new_parent is False:
                return Response({'error': 'Pasta de destino inválida.'}, status=status.HTTP_400_BAD_REQUEST)
            # Evita mover uma pasta para dentro dela mesma / de um descendente.
            p, seen = new_parent, 0
            while p is not None and seen < 100:
                if p.id == node.id:
                    return Response({'error': 'Não é possível mover para dentro da própria pasta.'},
                                    status=status.HTTP_400_BAD_REQUEST)
                p = p.parent; seen += 1
            node.parent = new_parent or None
        node.save()
        return Response(DriveNodeSerializer(node, context={'request': request}).data)

    def destroy(self, request, *args, **kwargs):
        # SOFT delete: manda o nó (e a subárvore) para a lixeira. Nada é apagado do
        # disco agora — o expurgo automático faz isso 30 dias depois. Dá pra restaurar.
        node = self.get_object()
        from audit.tracking import log_event
        from . import trash
        trash.soft_delete(node)
        from dashboard.signals import broadcast_drive
        broadcast_drive()   # soft-delete usa bulk_update → sem signal automático
        log_event('delete', model_name='DriveNode',
                  model_label='Pasta' if node.kind == 'folder' else 'Documento',
                  object_id=node.id, object_repr=node.name, user=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        """Tira o item (e a subárvore) da lixeira. Só o dono, e só o que está lá."""
        node = DriveNode.objects.filter(owner=request.user, pk=pk, is_deleted=True).first()
        if not node:
            return Response({'error': 'Item não encontrado na lixeira.'}, status=status.HTTP_404_NOT_FOUND)
        from audit.tracking import log_event
        from . import trash
        trash.restore(node)
        log_event('restore', model_name='DriveNode',
                  model_label='Pasta' if node.kind == 'folder' else 'Documento',
                  object_id=node.id, object_repr=node.name, user=request.user)
        return Response(DriveNodeSerializer(node, context={'request': request}).data)

    @action(detail=True, methods=['delete'], url_path='purge')
    def purge(self, request, pk=None):
        """Apaga DE VEZ um item da lixeira, antes dos 30 dias. Requer documentos_purge
        (só o dono, e só o que está na lixeira). Leva arquivos + subárvore junto."""
        node = DriveNode.objects.filter(owner=request.user, pk=pk, is_deleted=True).first()
        if not node:
            return Response({'error': 'Item não encontrado na lixeira.'}, status=status.HTTP_404_NOT_FOUND)
        from audit.tracking import log_event
        from . import trash
        log_event('purge', model_name='DriveNode',
                  model_label='Pasta' if node.kind == 'folder' else 'Documento',
                  object_id=node.id, object_repr=node.name, user=request.user)
        trash.delete_subtree_files(node)
        node.delete()   # cascata do banco leva os descendentes
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _delete_files(self, node):
        """Apaga os arquivos físicos do nó e descendentes (best-effort)."""
        stack = [node]
        while stack:
            n = stack.pop()
            stack.extend(list(n.children.all()))
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

    @action(detail=False, methods=['get'], url_path='shareable_users')
    def shareable_users(self, request):
        """Usuários para os seletores de compartilhar/transferir. Requer
        documentos_share (via get_permissions), exceto o próprio, ativos.
        ?perm=view → quem pode USAR o Drive (documentos_view) — para TRANSFERIR a
        propriedade. Padrão → quem pode RECEBER compartilhamentos (documentos_receive)."""
        from django.contrib.auth.models import User
        need = 'documentos_view' if request.query_params.get('perm') == 'view' else 'documentos_receive'
        qs = (User.objects.filter(is_active=True)
              .filter(Q(is_superuser=True) | Q(**{f'permissions__{need}': True}))
              .exclude(id=request.user.id).distinct().order_by('username'))
        out = [{'id': u.id, 'full_name': (f'{u.first_name} {u.last_name}'.strip() or u.username),
                'username': u.username, 'email': u.email,
                'avatar_url': (u.permissions.avatar.url if getattr(u, 'permissions', None) and u.permissions.avatar else None)}
               for u in qs.select_related('permissions')]
        return Response(out)

    @action(detail=True, methods=['post'])
    def share(self, request, pk=None):
        """Compartilha o nó. body: { shares: [{user, level}] } (level = view|comment|edit)
        ou { user_ids: [...] } (compat, level 'view'). Só o dono, e só com quem tem
        permissão de RECEBER compartilhamentos (documentos_receive)."""
        node = self.get_object()
        from django.contrib.auth.models import User
        raw = request.data.get('shares')
        if raw is None:
            raw = [{'user': uid, 'level': 'view'} for uid in (request.data.get('user_ids') or [])]
        wanted = {}
        for s in raw:
            uid = s.get('user') if isinstance(s, dict) else s
            lvl = (s.get('level') if isinstance(s, dict) else 'view') or 'view'
            if lvl not in ('view', 'comment', 'edit'):
                lvl = 'view'
            try:
                wanted[int(uid)] = lvl
            except (TypeError, ValueError):
                continue
        wanted.pop(node.owner_id, None)
        users = list(User.objects.filter(id__in=list(wanted.keys())))
        blocked = [u for u in users if not has_any_perm(u, 'documentos_receive')]
        if blocked:
            names = ', '.join(_user_label(u) for u in blocked)
            return Response({'error': f'Sem permissão para receber documentos compartilhados: {names}.'},
                            status=status.HTTP_400_BAD_REQUEST)
        node.shared_with.set(users)
        node.share_levels = {str(u.id): wanted[u.id] for u in users}
        node.save(update_fields=['share_levels'])
        return Response(DriveNodeSerializer(node, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def transfer(self, request, pk=None):
        """Transfere a PROPRIEDADE do nó (e de toda a subárvore) para outro usuário.
        Só o dono; o alvo precisa poder usar o Drive (documentos_view). O item vai
        para a RAIZ do novo dono (aparece em "Meus arquivos" dele, não em
        "Compartilhados"); o dono antigo perde o acesso."""
        node = self.get_object()   # get_queryset garante que é do dono e fora da lixeira
        from django.contrib.auth.models import User
        from . import trash
        from dashboard.signals import broadcast_drive
        target = User.objects.filter(id=request.data.get('user_id')).first()
        if not target or target.id == node.owner_id:
            return Response({'error': 'Escolha um usuário válido (diferente do dono atual).'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not has_any_perm(target, 'documentos_view'):
            return Response({'error': f'{_user_label(target)} não tem acesso ao Meus Documentos.'},
                            status=status.HTTP_400_BAD_REQUEST)
        nodes = trash._subtree(node)
        for n in nodes:
            n.owner = target
        DriveNode.objects.bulk_update(nodes, ['owner'])   # muda o dono da subárvore
        # O novo dono não fica "compartilhado" consigo mesmo; e o item vai pra raiz dele.
        node.shared_with.remove(target)
        if isinstance(node.share_levels, dict):
            node.share_levels.pop(str(target.id), None)
        node.parent = None
        node.save(update_fields=['parent', 'share_levels'])
        broadcast_drive()   # bulk_update não dispara signal
        from audit.tracking import log_event
        log_event('update', model_name='DriveNode',
                  model_label='Pasta' if node.kind == 'folder' else 'Documento',
                  object_id=node.id, object_repr=f'{node.name} → {_user_label(target)}', user=request.user)
        return Response({'ok': True, 'new_owner': _user_label(target)})

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        return self._serve(pk, request, inline=False)

    @action(detail=True, methods=['get'])
    def preview(self, request, pk=None):
        return self._serve(pk, request, inline=True)

    # ── Histórico NATIVO do OnlyOffice (realce das mudanças dentro do documento) ──
    @action(detail=True, methods=['get'], url_path='history')
    def history(self, request, pk=None):
        """Lista de versões no formato do refreshHistory do OnlyOffice."""
        node = DriveNode.objects.filter(pk=pk, kind='file').first()
        if node is None:
            raise Http404
        if not node.can_access(request.user):
            return Response({'error': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)
        from django.utils import timezone
        vers = list(node.versions.all().order_by('created_at', 'id'))   # mais antiga → mais nova
        history = []
        for idx, v in enumerate(vers, start=1):
            entry = {
                'created': timezone.localtime(v.created_at).strftime('%Y-%m-%d %H:%M:%S'),
                'key': v.doc_key or f'drive{node.id}ver{v.id}',
                'user': {'id': str(v.edited_by_id or ''), 'name': v.edited_by_name or 'Alguém'},
                'version': idx,
                'id': v.id,   # extra (o OnlyOffice ignora) — o front usa p/ restaurar
            }
            if v.changes_json:
                entry['changes'] = v.changes_json
                entry['serverVersion'] = v.server_version or ''
            history.append(entry)
        return Response({'currentVersion': len(vers), 'history': history})

    @action(detail=True, methods=['get'], url_path='history_data')
    def history_data(self, request, pk=None):
        """Dados de uma versão (setHistoryData do OnlyOffice): url + changesUrl +
        previous, tudo assinado com JWT. O DS usa isso para realçar as mudanças."""
        node = DriveNode.objects.filter(pk=pk, kind='file').first()
        if node is None:
            raise Http404
        if not node.can_access(request.user):
            return Response({'error': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)
        vers = list(node.versions.all().order_by('created_at', 'id'))
        try:
            n = int(request.query_params.get('version'))
        except (TypeError, ValueError):
            n = 0
        if n < 1 or n > len(vers):
            return Response({'error': 'Versão inválida.'}, status=status.HTTP_400_BAD_REQUEST)
        v = vers[n - 1]
        ext = os.path.splitext(node.name or node.file.name)[1].lower().lstrip('.')
        data = {
            'fileType': ext,
            'version': n,
            'key': v.doc_key or f'drive{node.id}ver{v.id}',
            'url': onlyoffice._backend(v.file.url),
        }
        if n > 1 and v.changes_file:
            prev = vers[n - 2]
            data['changesUrl'] = onlyoffice._backend(v.changes_file.url)
            data['previous'] = {
                'key': prev.doc_key or f'drive{node.id}ver{prev.id}',
                'url': onlyoffice._backend(prev.file.url),
            }
        secret = getattr(settings, 'ONLYOFFICE_JWT_SECRET', '')
        if secret:
            data['token'] = onlyoffice.jwt_encode(data, secret)
        return Response(data)

    @action(detail=True, methods=['post'], url_path='restore_version')
    def restore_version(self, request, pk=None):
        """Restaura o arquivo para uma versão do histórico. Só o dono."""
        node = self.get_object()   # get_queryset = só do dono
        if node.kind != 'file' or not node.file:
            return Response({'error': 'Item inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        v = node.versions.filter(pk=request.data.get('version')).first()
        if not v or not v.file:
            return Response({'error': 'Versão inválida.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            fh = v.file.open('rb'); content = fh.read(); fh.close()
        except Exception:
            return Response({'error': 'Não foi possível ler a versão.'}, status=status.HTTP_400_BAD_REQUEST)
        node.file.save(node.file.name.split('/')[-1], ContentFile(content), save=False)
        node.file_size = len(content)
        node.edit_key = get_random_string(12)   # força o editor a recarregar o conteúdo
        if node.thumb:
            try: node.thumb.delete(save=False)
            except Exception: pass
            node.thumb = None
        node.save(update_fields=['file', 'file_size', 'edit_key', 'thumb', 'updated_at'])
        from django.utils import timezone
        snapshot_version(node, user=request.user,
                         note=f'Restaurado da versão de {timezone.localtime(v.created_at):%d/%m/%Y %H:%M}')
        return Response({'ok': True})

    @action(detail=True, methods=['get'], url_path='download_zip')
    def download_zip(self, request, pk=None):
        """Baixa uma PASTA inteira como .zip (recursivo, preservando subpastas).
        Monta o zip em memória para ter Content-Length e a barra de % funcionar."""
        folder = DriveNode.objects.filter(pk=pk, kind='folder').first()
        if folder is None:
            raise Http404
        if not folder.can_access(request.user):
            return Response({'error': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)

        buf = io.BytesIO()
        names = set()   # evita nomes duplicados dentro do mesmo caminho
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            def walk(node, prefix, depth):
                if depth > 60:
                    return
                for child in node.children.all():
                    if child.kind == 'folder':
                        walk(child, f'{prefix}{_safe(child.name)}/', depth + 1)
                    elif child.file:
                        arc = f'{prefix}{_safe(child.name)}'
                        n, i = arc, 1
                        while n in names:      # "arquivo (2).ext" se repetir
                            base, ext = os.path.splitext(arc)
                            n = f'{base} ({i}){ext}'; i += 1
                        names.add(n)
                        try:
                            with child.file.open('rb') as fh:
                                z.writestr(n, fh.read())
                        except Exception:
                            pass
            walk(folder, f'{_safe(folder.name)}/', 0)
        buf.seek(0)
        from urllib.parse import quote
        resp = FileResponse(buf, as_attachment=True, content_type='application/zip')
        resp['Content-Disposition'] = f"attachment; filename*=UTF-8''{quote(folder.name + '.zip')}"
        return resp

    @action(detail=True, methods=['get'])
    def details(self, request, pk=None):
        """Informações completas de um item (para o pop-up "Ver detalhes"). Pasta:
        inclui quantos itens e o tamanho total (recursivo)."""
        node = DriveNode.objects.filter(pk=pk).first()
        if node is None:
            raise Http404
        if not node.can_access(request.user):
            return Response({'error': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)
        # Localização: caminho das pastas-mãe (Início / Pasta / …).
        crumb, p, seen = [], node.parent, 0
        while p is not None and seen < 100:
            crumb.insert(0, p.name); p = p.parent; seen += 1
        location = ' / '.join(['Início'] + crumb)

        data = {
            'id': node.id, 'kind': node.kind, 'name': node.name,
            'ext': (os.path.splitext(node.original_name or node.name or '')[1] or '').lower().lstrip('.'),
            'mime_type': node.mime_type or '',
            'created_at': node.created_at.isoformat() if node.created_at else None,
            'updated_at': node.updated_at.isoformat() if node.updated_at else None,
            'owner_name': _user_label(node.owner) if node.owner_id else '',
            'is_owner': node.owner_id == request.user.id,
            'shared_with': [_user_label(u) for u in node.shared_with.all()],
            'location': location,
        }
        if node.kind == 'file':
            data['file_size'] = node.file_size or 0
        else:
            # Pasta: conta itens e soma tamanhos (recursivo).
            n_files = n_folders = total = 0
            stack, seen = [node], 0
            while stack and seen < 100000:
                cur = stack.pop(); seen += 1
                for ch in cur.children.all():
                    if ch.kind == 'folder':
                        n_folders += 1; stack.append(ch)
                    else:
                        n_files += 1; total += (ch.file_size or 0)
            data['item_count'] = n_files + n_folders
            data['file_count'] = n_files
            data['folder_count'] = n_folders
            data['total_size'] = total
        return Response(data)

    @action(detail=True, methods=['get'])
    def thumb(self, request, pk=None):
        """Miniatura (PNG) do conteúdo — Word/Excel/PPT/PDF. Gera sob demanda na
        primeira visualização (via OnlyOffice) e guarda; regenera após edição."""
        node = DriveNode.objects.filter(pk=pk, kind='file').first()
        if node is None or not node.file:
            raise Http404
        if not node.can_access(request.user):
            return Response({'error': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)
        if not node.thumb:
            ext = os.path.splitext(node.name or node.file.name)[1].lower().lstrip('.')
            png = onlyoffice.render_thumbnail(
                file_url=node.file.url, ext=ext,
                doc_key=f'drivethumb{node.id}v{node.edit_key or "0"}', title=node.name or node.file.name)
            if not png:
                raise Http404
            node.thumb.save(f'{node.id}.png', ContentFile(png), save=False)
            node.save(update_fields=['thumb'])
        try:
            fh = node.thumb.open('rb')
        except Exception:
            raise Http404
        return FileResponse(fh, content_type='image/png')

    def _clear_thumb(self, node):
        if node.thumb:
            try: node.thumb.delete(save=False)
            except Exception: pass
        node.thumb = None

    def _serve(self, pk, request, inline):
        node = DriveNode.objects.filter(pk=pk, kind='file').first()
        if node is None or not node.file:
            raise Http404
        if not node.can_access(request.user):
            return Response({'error': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            fh = node.file.open('rb')
        except Exception:
            raise Http404
        resp = FileResponse(fh, content_type=node.mime_type or 'application/octet-stream')
        disp = 'inline' if inline else 'attachment'
        fname = node.original_name or node.name or f'arquivo{os.path.splitext(node.file.name)[1]}'
        from urllib.parse import quote
        resp['Content-Disposition'] = f"{disp}; filename*=UTF-8''{quote(fname)}"
        return resp


@csrf_exempt
@api_view(['POST'])
@authentication_classes([])          # o Document Server chama sem sessão de usuário
@permission_classes([AllowAny])      # protegido pela assinatura JWT, não por login
def drive_document_callback(request, pk):
    """Callback do OnlyOffice: ao salvar, o DS envia o arquivo editado aqui e nós
    sobrescrevemos o nó do Drive."""
    node = DriveNode.objects.filter(pk=pk, kind='file').first()
    if not node:
        return Response({'error': 1})
    payload = request.data or {}

    secret = getattr(settings, 'ONLYOFFICE_JWT_SECRET', '')
    if secret:
        token = payload.get('token') or (request.headers.get('Authorization', '').replace('Bearer ', '') or '')
        try:
            decoded = onlyoffice.jwt_decode(token, secret)
            payload = decoded.get('payload', decoded)
        except Exception:
            return Response({'error': 1})

    # status 2 = pronto para salvar; 6 = force save (salvamento manual/intermediário).
    if payload.get('status') in (2, 6):
        file_url = payload.get('url')
        if file_url:
            try:
                with urllib.request.urlopen(file_url, timeout=30) as resp:
                    content = resp.read()
                node.file.save(node.file.name.split('/')[-1], ContentFile(content), save=False)
                node.file_size = len(content)
                node.edit_key = get_random_string(12)
                # Conteúdo mudou → miniatura antiga não vale mais; será regerada.
                if node.thumb:
                    try: node.thumb.delete(save=False)
                    except Exception: pass
                    node.thumb = None
                node.save(update_fields=['file', 'file_size', 'edit_key', 'thumb', 'updated_at'])
                # Guarda a versão no histórico, atribuindo a quem editou.
                from django.contrib.auth.models import User as _User
                editor, ename = None, ''
                for uid in reversed(payload.get('users') or []):
                    if str(uid).isdigit():
                        editor = _User.objects.filter(pk=int(uid)).first()
                        if editor: break
                history = payload.get('history') or {}
                for ch in reversed(history.get('changes') or []):
                    nm = (ch.get('user') or {}).get('name')
                    if nm: ename = nm; break
                v = snapshot_version(node, user=editor, name=ename)
                # Guarda os "changes" do OnlyOffice → realce das mudanças no histórico.
                if v:
                    v.server_version = str(history.get('serverVersion') or '')
                    v.changes_json = history.get('changes') or []
                    changesurl = payload.get('changesurl')
                    if changesurl:
                        try:
                            with urllib.request.urlopen(changesurl, timeout=30) as cr:
                                v.changes_file.save(f'{node.id}_changes.zip', ContentFile(cr.read()), save=False)
                        except Exception:
                            pass
                    v.save(update_fields=['server_version', 'changes_json', 'changes_file'])
            except Exception:
                return Response({'error': 1})
    return Response({'error': 0})

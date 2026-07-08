import os
from django.http import FileResponse, Http404
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser

from .models import DriveNode
from .serializers import DriveNodeSerializer


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

    def get_queryset(self):
        # Ações que mexem no próprio nó operam só sobre os do dono. A leitura de
        # arquivos compartilhados passa por can_access nas actions de download.
        return DriveNode.objects.filter(owner=self.request.user)

    def _accessible_folder(self, parent_id):
        """Devolve a pasta se o usuário pode acessá-la, senão None."""
        if not parent_id:
            return None
        f = DriveNode.objects.filter(pk=parent_id, kind='folder').first()
        if f and f.can_access(self.request.user):
            return f
        return False   # explicit "not allowed / not found"

    def list(self, request):
        u = request.user
        if request.query_params.get('shared'):
            qs = DriveNode.objects.filter(shared_with=u).distinct()
            return Response({'breadcrumb': [], 'folder': None, 'shared': True,
                             'nodes': DriveNodeSerializer(qs, many=True, context={'request': request}).data})
        parent_id = request.query_params.get('parent') or None
        folder = self._accessible_folder(parent_id)
        if folder is False:
            return Response({'error': 'Pasta não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        children = folder.children.all() if folder else DriveNode.objects.filter(owner=u, parent__isnull=True)
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
        created = []
        for f in files:
            node = DriveNode(owner=request.user, kind='file', parent=folder or None,
                             name=f.name, original_name=f.name,
                             file_size=getattr(f, 'size', 0) or 0,
                             mime_type=getattr(f, 'content_type', '') or '')
            node.file.save(f.name, f, save=False)
            node.save()
            created.append(node)
        return Response(DriveNodeSerializer(created, many=True, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)

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
        node = self.get_object()
        self._delete_files(node)
        node.delete()
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

    @action(detail=True, methods=['post'])
    def share(self, request, pk=None):
        """Compartilha o nó com usuários. { user_ids: [...] } — só o dono."""
        node = self.get_object()
        from django.contrib.auth.models import User
        ids = request.data.get('user_ids') or []
        users = User.objects.filter(id__in=ids).exclude(id=node.owner_id)
        node.shared_with.set(users)
        return Response(DriveNodeSerializer(node, context={'request': request}).data)

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        return self._serve(pk, request, inline=False)

    @action(detail=True, methods=['get'])
    def preview(self, request, pk=None):
        return self._serve(pk, request, inline=True)

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

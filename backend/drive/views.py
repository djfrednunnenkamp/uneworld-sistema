import os
import urllib.request
from django.conf import settings
from django.core.files.base import ContentFile
from django.http import FileResponse, Http404
from django.utils.crypto import get_random_string
from django.views.decorators.csrf import csrf_exempt
from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser

from itineraries import blank_office, onlyoffice
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
        # Edita quem é dono do arquivo; compartilhados abrem em modo leitura.
        user_can_edit = node.owner_id == request.user.id
        try:
            return Response(onlyoffice.build_editor_config(
                doc_key=f'drive{node.id}', edit_key=node.edit_key,
                fname=node.name or node.file.name, file_url=node.file.url,
                callback_url=f'/api/drive/{node.id}/callback/',
                user=request.user, user_can_edit=user_can_edit))
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
                node.save(update_fields=['file', 'file_size', 'edit_key', 'updated_at'])
            except Exception:
                return Response({'error': 1})
    return Response({'error': 0})

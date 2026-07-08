import io
import os
import urllib.request
import zipfile
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
from .models import DriveNode, DriveNodeVersion
from .serializers import DriveNodeSerializer, _user_label


def _safe(name):
    """Nome seguro para entrada de zip: sem barras nem componentes de caminho."""
    return (name or 'arquivo').replace('/', '_').replace('\\', '_').strip() or 'arquivo'


# ── Diff de conteúdo entre versões (estilo GitHub) ──
_W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def docx_text(fileobj):
    """Extrai o texto de um .docx (um parágrafo por linha). None se não der."""
    from xml.etree import ElementTree as ET
    try:
        with zipfile.ZipFile(fileobj) as z:
            xml = z.read('word/document.xml')
        root = ET.fromstring(xml)
    except Exception:
        return None
    lines = []
    for p in root.iter(f'{_W}p'):
        buf = []
        for node in p.iter():
            if node.tag == f'{_W}t':
                buf.append(node.text or '')
            elif node.tag == f'{_W}tab':
                buf.append('\t')
            elif node.tag in (f'{_W}br', f'{_W}cr'):
                buf.append('\n')
        lines.append(''.join(buf))
    return '\n'.join(lines)


def line_diff(old, new, ctx=3):
    """Diff linha a linha (add/del/ctx/skip) entre dois textos."""
    import difflib
    a, b = old.split('\n'), new.split('\n')
    out = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b).get_opcodes():
        if tag == 'equal':
            run = a[i1:i2]
            if len(run) > ctx * 2 + 1:
                for l in run[:ctx]: out.append({'type': 'ctx', 'text': l})
                out.append({'type': 'skip', 'count': len(run) - ctx * 2})
                for l in run[-ctx:]: out.append({'type': 'ctx', 'text': l})
            else:
                for l in run: out.append({'type': 'ctx', 'text': l})
        elif tag == 'delete':
            for l in a[i1:i2]: out.append({'type': 'del', 'text': l})
        elif tag == 'insert':
            for l in b[j1:j2]: out.append({'type': 'add', 'text': l})
        elif tag == 'replace':
            for l in a[i1:i2]: out.append({'type': 'del', 'text': l})
            for l in b[j1:j2]: out.append({'type': 'add', 'text': l})
    return out


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
        edited_by_name=label, note=note, file_size=len(content))
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
            if onlyoffice.office_document_type(node.name or ''):
                snapshot_version(node, user=request.user, note='Enviado')
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
            if n.thumb:
                try: n.thumb.delete(save=False)
                except Exception: pass
            for v in n.versions.all():
                if v.file:
                    try: v.file.delete(save=False)
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

    # ── Histórico de versões (estilo Google Docs) ──
    def _versions_payload(self, node, request):
        from django.utils import timezone
        out = []
        for v in node.versions.all():
            out.append({
                'id': v.id,
                'edited_by_name': v.edited_by_name or 'Alguém',
                'note': v.note,
                'file_size': v.file_size,
                'created_at': timezone.localtime(v.created_at).isoformat(),
                'download_url': f'/api/drive/{node.id}/version_download/?version={v.id}',
            })
        return {'versions': out, 'is_owner': node.owner_id == request.user.id}

    @action(detail=True, methods=['get'])
    def versions(self, request, pk=None):
        """Lista as versões (histórico) de um arquivo — quem editou e quando."""
        node = DriveNode.objects.filter(pk=pk, kind='file').first()
        if node is None:
            raise Http404
        if not node.can_access(request.user):
            return Response({'error': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)
        return Response(self._versions_payload(node, request))

    @action(detail=True, methods=['get'], url_path='version_download')
    def version_download(self, request, pk=None):
        """Baixa/abre o arquivo de uma versão específica."""
        node = DriveNode.objects.filter(pk=pk, kind='file').first()
        if node is None:
            raise Http404
        if not node.can_access(request.user):
            return Response({'error': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)
        v = node.versions.filter(pk=request.query_params.get('version')).first()
        if not v or not v.file:
            raise Http404
        try:
            fh = v.file.open('rb')
        except Exception:
            raise Http404
        from urllib.parse import quote
        resp = FileResponse(fh, content_type='application/octet-stream')
        resp['Content-Disposition'] = f"attachment; filename*=UTF-8''{quote(node.name or 'documento')}"
        return resp

    @action(detail=True, methods=['get'], url_path='version_diff')
    def version_diff(self, request, pk=None):
        """Diff de texto entre uma versão e o documento ATUAL (o que mudou daquela
        versão até agora). Só para .docx por enquanto."""
        node = DriveNode.objects.filter(pk=pk, kind='file').first()
        if node is None:
            raise Http404
        if not node.can_access(request.user):
            return Response({'error': 'Sem permissão.'}, status=status.HTTP_403_FORBIDDEN)
        v = node.versions.filter(pk=request.query_params.get('version')).first()
        if not v or not v.file:
            return Response({'error': 'Versão inválida.'}, status=status.HTTP_400_BAD_REQUEST)
        ext = os.path.splitext(node.name or '')[1].lower().lstrip('.')
        if ext != 'docx':
            return Response({'supported': False})
        try:
            old = docx_text(v.file.open('rb'))
            new = docx_text(node.file.open('rb'))
        except Exception:
            old = new = None
        if old is None or new is None:
            return Response({'supported': False})
        lines = line_diff(old, new)
        return Response({
            'supported': True,
            'lines': lines,
            'added':   sum(1 for l in lines if l['type'] == 'add'),
            'removed': sum(1 for l in lines if l['type'] == 'del'),
        })

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
        return Response(self._versions_payload(node, request))

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
                for ch in reversed((payload.get('history') or {}).get('changes') or []):
                    nm = (ch.get('user') or {}).get('name')
                    if nm: ename = nm; break
                snapshot_version(node, user=editor, name=ename)
            except Exception:
                return Response({'error': 1})
    return Response({'error': 0})

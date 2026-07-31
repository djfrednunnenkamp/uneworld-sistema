import re
from django.contrib.auth.models import User
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from core.pagination import StandardResultsPagination
from core.soft_delete import SoftDeleteViewSetMixin
from core.merge import MergeViewSetMixin
from users_api.permissions import RequirePermission
from .models import Agency, AgencyMember
from .serializers import AgencySerializer, AgencyListSerializer
from core.search import AccentInsensitiveSearchFilter
from core.file_cleanup import delete_fieldfile

# Quem pode editar passageiros/listas precisa enxergar/buscar agências
# (AgencyPicker, autocomplete de agência responsável etc.), então essas
# permissões também liberam list/retrieve, além de agencies_view.
VIEW_PERMS = ['agencies_view', 'passengers_edit', 'passengers_view_full', 'lists_edit']


class AgencyViewSet(SoftDeleteViewSetMixin, MergeViewSetMixin, viewsets.ModelViewSet):
    queryset        = Agency.objects.all()
    pagination_class = StandardResultsPagination
    filter_backends = [AccentInsensitiveSearchFilter, filters.OrderingFilter]
    search_fields   = ['name', 'company_name', 'email', 'cnpj', 'responsible']
    ordering_fields = ['name', 'created_at']
    MERGE_LABEL = 'Agência'

    @property
    def MERGE_RELATED(self):
        from trips.models import ListEnrollment
        return [
            (ListEnrollment, 'agency', None),
            (AgencyMember,   'agency', ['user']),
        ]

    def get_serializer_class(self):
        return AgencyListSerializer if self.action == 'list' else AgencySerializer

    def get_queryset(self):
        from django.db.models import Q
        from users_api.permissions import agency_scope_ids
        qs = super().get_queryset().select_related('promoter')   # aplica o filtro de soft-delete (is_deleted)
        # Usuário de agência só enxerga a(s) própria(s) agência(s).
        scope = agency_scope_ids(self.request.user)
        if scope is not None:
            qs = qs.filter(id__in=scope)
        # Rascunhos são PRIVADOS de quem criou (listar/abrir/editar/descartar).
        qs = qs.filter(~Q(status='rascunho') | Q(created_by=self.request.user))
        # Na listagem, rascunhos ficam fora por padrão; ?status=rascunho traz só eles.
        if self.action == 'list':
            if self.request.query_params.get('status') == 'rascunho':
                qs = qs.filter(status='rascunho')
            else:
                qs = qs.exclude(status='rascunho')
        return qs

    def perform_create(self, serializer):
        agency = serializer.save(created_by=self.request.user)
        # Agência criada já ativa (sem passar por rascunho) → provisiona o admin.
        if agency.status != 'rascunho':
            from .provisioning import ensure_agency_admin_user
            ensure_agency_admin_user(agency, self.request.user)

    def perform_update(self, serializer):
        # Ao finalizar (rascunho → ativa/pendente/...), cria o usuário admin da
        # agência com o e-mail do cadastro. Transição evita reprovisionar em edições.
        was_draft = serializer.instance.status == 'rascunho'
        agency = serializer.save()
        if was_draft and agency.status != 'rascunho':
            from .provisioning import ensure_agency_admin_user
            ensure_agency_admin_user(agency, self.request.user)

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('agencies_delete')()]
        if self.action in ('create', 'update', 'partial_update', 'discard'):
            return [RequirePermission('agencies_edit')()]
        if self.action == 'merge':
            return [RequirePermission('agencies_edit')(), RequirePermission('agencies_delete')()]
        if self.action == 'check_cnpj':
            # Endpoint utilitário usado durante o fluxo de criação/edição
            return [RequirePermission(*VIEW_PERMS, 'agencies_edit')()]
        if self.action in ('list', 'retrieve'):
            # Quem faz contratos também precisa LER/buscar agências (o seletor de
            # agência do contrato). O get_queryset já limita o que cada um enxerga.
            return [RequirePermission(*VIEW_PERMS, 'contracts_view', 'contracts_edit')()]
        if self.action == 'members':
            if self.request.method == 'POST':
                return [RequirePermission('agencies_edit')()]
            return [RequirePermission(*VIEW_PERMS)()]
        if self.action == 'attachable_users':
            return [RequirePermission('agencies_edit')()]
        if self.action in ('autentique_config', 'self_update', 'logo'):
            # Admin da agência OU operadora — o gate fino é feito dentro da action.
            from rest_framework.permissions import IsAuthenticated
            return [IsAuthenticated()]
        return super().get_permissions()

    @action(detail=True, methods=['patch'], url_path='autentique-config')
    def autentique_config(self, request, pk=None):
        """Credenciais Autentique da agência (assinatura automática). Quem configura
        é SÓ o ADMIN DA AGÊNCIA (AgencyMember role='admin') — a operadora NÃO mexe no
        token (nunca precisa vê-lo). O token é write-only (entra, nunca volta). Só
        funciona depois que a operadora permitiu (auto_sign_allowed). Superuser é
        mantido como último recurso técnico, mas a UI não o oferece à operadora."""
        from users_api.permissions import agency_admin_ids
        agency = self.get_object()
        u = request.user
        is_admin_here = agency.id in (agency_admin_ids(u) or [])
        if not (is_admin_here or bool(getattr(u, 'is_superuser', False))):
            return Response({'error': 'Só o administrador da agência pode configurar a assinatura automática.'}, status=403)
        if not agency.auto_sign_allowed:
            return Response({'error': 'A operadora ainda não liberou a assinatura automática para esta agência.'}, status=400)
        data = request.data
        fields = []
        if 'auto_sign' in data:
            agency.auto_sign = bool(data.get('auto_sign')); fields.append('auto_sign')
        if 'autentique_email' in data:
            agency.autentique_email = (data.get('autentique_email') or '').strip(); fields.append('autentique_email')
        # Token: só grava se veio um valor não-vazio (em branco = mantém o atual).
        tok = data.get('autentique_token')
        if tok is not None and str(tok).strip():
            agency.autentique_token = str(tok).strip(); fields.append('autentique_token')
        if fields:
            agency.save(update_fields=fields)
        return Response(AgencySerializer(agency, context={'request': request}).data)

    # Campos que a PRÓPRIA agência (admin) pode editar na página "Minha Agência".
    # NÃO inclui comissão, status, tipo de cadastro nem a permissão de auto-assinatura
    # (auto_sign_allowed) — isso é controle da OPERADORA. Token/e-mail/auto_sign vão
    # pelo endpoint autentique-config; logo pelo endpoint logo.
    _SELF_EDIT_FIELDS = {
        'person_type', 'cnpj', 'cpf', 'company_name', 'name', 'last_name',
        'state_registration', 'municipal_registration', 'responsible',
        'phone', 'mobile', 'email', 'website',
        'cep', 'street', 'number', 'complement', 'neighborhood', 'city', 'state', 'country',
        'receives_mail', 'pix_key_type', 'pix_key', 'use_agency_pix', 'notes',
    }

    @action(detail=True, methods=['patch'], url_path='self-update')
    def self_update(self, request, pk=None):
        """Autoedição do cadastro pelo ADMIN DA AGÊNCIA (role='admin') — página "Minha
        Agência". Edita identidade/contatos/endereço/PIX/obs; IGNORA comissão, status,
        tipo de cadastro e auto_sign_allowed (controle da operadora)."""
        from users_api.permissions import agency_admin_ids
        agency = self.get_object()
        u = request.user
        if not (agency.id in (agency_admin_ids(u) or []) or bool(getattr(u, 'is_superuser', False))):
            return Response({'error': 'Só o administrador da agência pode editar os dados dela.'}, status=403)
        data = {k: v for k, v in request.data.items() if k in self._SELF_EDIT_FIELDS}
        ser = AgencySerializer(agency, data=data, partial=True, context={'request': request})
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    @action(detail=True, methods=['post', 'delete'], parser_classes=[MultiPartParser, FormParser])
    def logo(self, request, pk=None):
        """Upload/remoção da LOGO da agência. SEGURO: valida tamanho, verifica a
        imagem com Pillow e re-encoda como PNG (mantém transparência; descarta
        qualquer payload embutido). Nunca serve o arquivo enviado como veio."""
        from audit.tracking import log_event
        from users_api.permissions import agency_admin_ids, has_any_perm
        agency = self.get_object()
        # Operadora (agencies_edit/superuser) OU o admin DESTA agência (Minha Agência).
        if not (has_any_perm(request.user, 'agencies_edit')
                or bool(getattr(request.user, 'is_superuser', False))
                or agency.id in (agency_admin_ids(request.user) or [])):
            return Response({'error': 'Sem permissão para alterar a logo desta agência.'}, status=403)
        if request.method == 'DELETE':
            if agency.logo or agency.logo_original:
                if agency.logo:
                    delete_fieldfile(agency.logo, 'logo da agência')
                if agency.logo_original:
                    delete_fieldfile(agency.logo_original, 'logo original da agência')
                agency.logo = None; agency.logo_original = None; agency.logo_crop = {}
                agency._skip_audit_signal = True    # logamos como 'delete' de logo, não 'update'
                agency.save(update_fields=['logo', 'logo_original', 'logo_crop'])
                log_event('delete', model_name='Agency', model_label='Logo da agência',
                          object_id=agency.id, object_repr=f'Logo — {agency}', user=request.user)
            return Response(self.get_serializer(agency).data)

        f = request.FILES.get('logo') or request.FILES.get('file')
        if not f:
            return Response({'error': 'Nenhuma imagem enviada.'}, status=status.HTTP_400_BAD_REQUEST)
        if f.size > 5 * 1024 * 1024:
            return Response({'error': 'Imagem muito grande (máximo 5 MB).'}, status=status.HTTP_400_BAD_REQUEST)

        import io
        from PIL import Image, ImageOps, UnidentifiedImageError
        try:
            probe = Image.open(f)
            if (probe.format or '').upper() not in {'JPEG', 'PNG', 'WEBP', 'GIF', 'BMP'}:
                return Response({'error': 'Formato não suportado. Use PNG, JPG, WEBP ou GIF.'}, status=status.HTTP_400_BAD_REQUEST)
            probe.verify()
            f.seek(0)
            img = Image.open(f)
            img = ImageOps.exif_transpose(img)
            img = img.convert('RGBA')          # mantém transparência do logo
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
            return Response({'error': 'Arquivo de imagem inválido.'}, status=status.HTTP_400_BAD_REQUEST)

        img.thumbnail((512, 512))
        buf = io.BytesIO()
        img.save(buf, format='PNG', optimize=True)
        buf.seek(0)

        from django.core.files.base import ContentFile
        if agency.logo:
            delete_fieldfile(agency.logo, 'logo da agência')
        agency.logo.save(f'{agency.id}.png', ContentFile(buf.read()), save=False)
        update_fields = ['logo']

        # Não-destrutivo: guarda a logo ORIGINAL (para reabrir/desfazer) + o recorte.
        from passengers.validators import sanitize_image, parse_crop
        from django.core.exceptions import ValidationError as DjangoValidationError
        orig = request.FILES.get('original')
        if orig:
            try:
                cf = sanitize_image(orig, fmt='PNG', max_dim=1600, max_bytes=5 * 1024 * 1024)
            except DjangoValidationError:
                cf = None
            if cf is not None:
                if agency.logo_original:
                    delete_fieldfile(agency.logo_original, 'logo original da agência')
                agency.logo_original.save(f'{agency.id}_orig.png', cf, save=False)
                update_fields.append('logo_original')
        crop = parse_crop(request.data.get('crop'))
        if crop:
            agency.logo_crop = crop
            update_fields.append('logo_crop')

        agency._skip_audit_signal = True        # logamos como 'upload' de logo, não 'update'
        agency.save(update_fields=update_fields)
        log_event('upload', model_name='Agency', model_label='Logo da agência',
                  object_id=agency.id, object_repr=f'Logo — {agency}', user=request.user)
        return Response(self.get_serializer(agency).data)

    @action(detail=False, methods=['get'], url_path='check-cnpj')
    def check_cnpj(self, request):
        cnpj = request.query_params.get('cnpj', '').strip()
        if not cnpj:
            return Response({'error': 'CNPJ não informado.'}, status=400)
        digits = re.sub(r'\D', '', cnpj)
        from django.db.models import Q
        agency = (Agency.objects.filter(Q(cnpj=cnpj) | Q(cnpj=digits), is_deleted=False)
                  .exclude(cnpj='').exclude(status='rascunho').first())
        if agency:
            name = agency.company_name or agency.name or f'Agência #{agency.pk}'
            return Response({'exists': True, 'id': agency.id, 'name': name})
        return Response({'exists': False})

    @action(detail=True, methods=['delete'], url_path='discard')
    def discard(self, request, pk=None):
        """Descarta um RASCUNHO de agência — apaga de vez (nunca foi real)."""
        obj = self.get_object()
        if obj.status != 'rascunho':
            return Response({'error': 'Apenas rascunhos podem ser descartados.'}, status=400)
        obj.delete()
        return Response(status=204)

    # ── Membros ──────────────────────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='attachable-users')
    def attachable_users(self, request, pk=None):
        """Usuários que podem ser ANEXADOS a esta agência (para o popup "Adicionar").
        Dados mínimos (id/nome/e-mail/flags) — liberado por `agencies_edit`, sem
        precisar da permissão de gerência de usuários. Exclui: já-membros, inativos,
        superusuários e (para quem não é superusuário) contas staff (regra A-08)."""
        from users_api.permissions import agency_scope_ids
        agency = self.get_object()
        member_ids = set(agency.members.values_list('user_id', flat=True))
        is_super_actor = request.user.is_superuser
        out = []
        for u in User.objects.filter(is_active=True).order_by('first_name', 'username'):
            if u.id in member_ids:
                continue
            # Contas privilegiadas (staff/superusuário) só entram na lista para um
            # superusuário — só ele pode anexá-las (regra A-08). O front esconde os
            # superadmins por padrão, com um filtro para incluí-los.
            if (u.is_staff or u.is_superuser) and not is_super_actor:
                continue
            out.append({
                'id': u.id,
                'full_name': f'{u.first_name} {u.last_name}'.strip() or u.username,
                'email': u.email,
                'username': u.username,
                'is_staff': u.is_staff,
                'is_superuser': u.is_superuser,
                'is_agency_user': agency_scope_ids(u) is not None,
            })
        return Response(out)

    @action(detail=False, methods=['get'], url_path='promoters')
    def promoters(self, request):
        """Usuários marcados como PROMOTOR (UserPermissions.is_promoter) — para o
        combobox "Promotor" no cadastro da agência (controle da operadora). Dados
        mínimos (id/nome); liberado pela permissão do próprio viewset de agências."""
        out = [
            {'id': u.id, 'full_name': f'{u.first_name} {u.last_name}'.strip() or u.username}
            for u in User.objects.filter(is_active=True, permissions__is_promoter=True)
                                 .order_by('first_name', 'username')
        ]
        return Response(out)

    @action(detail=True, methods=['get', 'post'], url_path='members')
    def members(self, request, pk=None):
        """GET: lista membros. POST: adiciona membro."""
        agency = self.get_object()

        if request.method == 'GET':
            # Só lista usuários DE agência: exclui excluídos (soft-delete → aba
            # "Excluídos") e contas internas (staff/superusuário) — se um membro
            # virou interno, ele deixa de ser da agência e some daqui.
            members = agency.members.select_related('user', 'user__permissions').exclude(
                user__permissions__is_deleted=True).exclude(
                user__is_staff=True).exclude(user__is_superuser=True).all()
            return Response([{
                'id':         m.id,
                'user_id':    m.user.id,
                'email':      m.user.email,
                'first_name': m.user.first_name,
                'last_name':  m.user.last_name,
                'full_name':  f'{m.user.first_name} {m.user.last_name}'.strip() or m.user.email,
                'is_staff':   m.user.is_staff,
                'is_active':  m.user.is_active,
                'role':       m.role,
                'added_at':   m.added_at,
            } for m in members])

        # POST — adiciona membro por user_id ou email
        return self._add_member(request, agency)

    def _add_member(self, request, agency):
        role    = request.data.get('role', 'operator')
        user_id = request.data.get('user_id')
        email   = request.data.get('email', '').strip().lower()

        if user_id:
            user = User.objects.filter(pk=user_id).first()
        elif email:
            user = User.objects.filter(email__iexact=email).first()
        else:
            return Response({'error': 'Informe user_id ou email.'}, status=400)

        if not user:
            return Response({'error': 'Usuário não encontrado.'}, status=404)
        # A-08: o cadastro de membros exige só `agencies_edit` e aceita user_id/
        # email arbitrários. Membro de agência é informativo (não concede acesso),
        # mas mesmo assim NÃO deixamos anexar contas privilegiadas (staff/super)
        # por ID arbitrário — só um superusuário pode fazer isso. Evita usar a rota
        # para referenciar/vincular contas admin sem uma permissão forte.
        if (user.is_staff or user.is_superuser) and not request.user.is_superuser:
            return Response({'error': 'Você não tem permissão para adicionar este usuário.'}, status=403)
        if agency.members.filter(user=user).exists():
            return Response({'error': 'Usuário já pertence a esta agência.'}, status=400)
        m = AgencyMember.objects.create(agency=agency, user=user, role=role)
        # Anexar um usuário EXISTENTE faz ele ASSUMIR as permissões de agência:
        # se era conta interna (staff/superusuário), rebaixa para usuário comum e
        # aplica o perfil "padrão de agência". Só um superusuário chega aqui com uma
        # conta interna (A-08); e nunca rebaixa a si mesmo (evita se trancar fora).
        if request.data.get('apply_agency_profile'):
            from config_api.models import PermissionProfile
            from users_api.permissions import apply_profile
            if (user.is_superuser or user.is_staff) and user.pk != request.user.pk:
                user.is_superuser = False
                user.is_staff = False
                user.save(update_fields=['is_superuser', 'is_staff'])
            prof = PermissionProfile.objects.filter(is_agency_default=True, is_deleted=False).first()
            if prof and not user.is_superuser:
                apply_profile(user, prof)   # agora aplica (não é mais superusuário)
        return Response({'id': m.id, 'email': user.email,
                         'full_name': f'{user.first_name} {user.last_name}'.strip() or user.email,
                         'role': m.role, 'is_active': user.is_active}, status=201)

    # PATCH (alterar papel, ex.: tornar admin da agência) e DELETE (remover da
    # agência) na MESMA rota members/<id>. Precisam ficar numa única @action —
    # dois @action com o mesmo url_path geram padrões duplicados e um dos métodos
    # cai em 405 (o router usa o primeiro que casa a URL).
    @action(detail=True, methods=['patch', 'delete'], url_path=r'members/(?P<member_id>\d+)',
            permission_classes=[IsAdminUser])
    def member_detail(self, request, pk=None, member_id=None):
        agency = self.get_object()
        try:
            m = agency.members.get(id=member_id)
        except AgencyMember.DoesNotExist:
            return Response({'error': 'Membro não encontrado.'}, status=404)
        if request.method == 'DELETE':
            m.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        if 'role' in request.data:
            if request.data['role'] not in {c[0] for c in AgencyMember.ROLE_CHOICES}:
                return Response({'error': 'Função inválida.'}, status=400)
            m.role = request.data['role']
            m.save(update_fields=['role'])
        return Response({'id': m.id, 'role': m.role})

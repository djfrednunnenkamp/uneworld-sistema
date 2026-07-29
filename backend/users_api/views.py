from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.conf import settings
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.decorators import api_view, permission_classes, throttle_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from core.throttling import LoginRateThrottle, PasswordResetRateThrottle, InviteRateThrottle
from core.file_cleanup import delete_fieldfile
from .models import PasswordResetToken, InviteToken
from .email_service import send_reset_password, send_invite
from .permissions import PERMISSION_FIELDS, permissions_dict, has_any_perm, sync_is_staff, get_user_permissions, apply_profile, agency_scope_ids, agency_admin_ids, is_operadora_user, can_manage_agency_user, drop_agency_memberships_if_internal


def _password_error(new_pw, user=None):
    """Aplica os validadores oficiais do Django (AUTH_PASSWORD_VALIDATORS: tamanho
    mínimo, senha comum, só-numérica, similaridade com dados do usuário) — F-03.
    Devolve uma mensagem amigável (traduzida via USE_I18N/pt-br) para o frontend,
    ou None se a senha for aceita. Deve ser chamada ANTES de set_password()."""
    try:
        validate_password(new_pw, user)
        return None
    except DjangoValidationError as e:
        return ' '.join(e.messages)


def _has_visible_text(html):
    """O editor rico salva '<p><br></p>' (ou similar) quando "vazio" — sem
    isso, esse HTML passaria como "tem conteúdo" numa checagem ingênua."""
    import re
    return bool(re.sub(r'<[^>]*>', '', html or '').strip())


def _needs_terms_acceptance(perms):
    from config_api.models import TermsAndConditions
    terms = TermsAndConditions.get()
    if not _has_visible_text(terms.content):
        return False  # ainda não há termos cadastrados — nada pra aceitar
    if not perms.terms_accepted_at:
        return True
    return perms.terms_accepted_at < terms.updated_at


def _valid_job_role_id(v):
    """Normaliza o cargo recebido: só aceita um id de ConfigJobRole existente; senão
    None (limpa o cargo). Import local para evitar ciclo config_api ↔ users_api."""
    if not v:
        return None
    from config_api.models import ConfigJobRole
    return v if ConfigJobRole.objects.filter(id=v).exists() else None


def serialize_user(u, perms=None):
    perms = perms or get_user_permissions(u)
    scope = agency_scope_ids(u)   # None p/ interno/superusuário; lista de ids p/ usuário de agência
    return {
        # Usuário de agência: front usa isto para travar/auto-preencher a agência
        # (ex.: no contrato ele não escolhe agência, já é a dele).
        'is_agency_user': scope is not None,
        'agency_ids':     scope or [],
        # Agências do usuário (id+nome) — usado no filtro de Agência da lista de
        # Usuários. Só para usuário de agência (interno não entra no filtro).
        'agencies': ([{'id': am.agency_id, 'name': am.agency.display_name}
                      for am in u.agency_memberships.select_related('agency').all()]
                     if scope is not None else []),
        # Admin de agência: pode gerenciar os usuários da(s) agência(s) dele.
        'agency_admin_ids': agency_admin_ids(u),
        'is_agency_admin':  bool(agency_admin_ids(u)),
        # Conta de operadora (agência tipo 'operadora'): front mostra a galeria só
        # com as lâminas; backend também restringe (GalleryImageViewSet).
        'is_operadora':     is_operadora_user(u),
        'id':           u.id,
        'username':     u.username,
        'email':        u.email,
        'first_name':   u.first_name,
        'last_name':    u.last_name,
        'full_name':    f"{u.first_name} {u.last_name}".strip() or u.username,
        'phone':        perms.phone,
        'is_seller':    perms.is_seller,
        'seller_commission_percent': perms.seller_commission_percent,
        'job_role':      perms.job_role_id,
        'job_role_name': perms.job_role.name if perms.job_role_id else None,
        'show_on_site':  perms.show_on_site,
        'avatar_url':   perms.avatar.url if perms.avatar else None,
        'avatar_original_url': perms.avatar_original.url if perms.avatar_original else None,
        'avatar_crop':  perms.avatar_crop or {},
        'storage_limit_bytes': perms.storage_limit_bytes,
        'is_staff':     u.is_staff,
        'is_superuser': u.is_superuser,
        'is_active':    u.is_active,
        'has_account':  u.has_usable_password(),
        'date_joined':  u.date_joined,
        'last_login':   u.last_login,
        'updated_at':   perms.updated_at,
        'permissions':  permissions_dict(u),
        # Perfil de permissão vinculado (link vivo). null = permissões personalizadas.
        'profile_id':   perms.profile_id,
        'profile_name': perms.profile.name if perms.profile_id else None,
        'is_deleted':   perms.is_deleted,
        'deleted_at':   perms.deleted_at,
        'needs_terms_acceptance': _needs_terms_acceptance(perms),
        # Exclusão definitiva (purge) liberada por .env — o front só mostra o
        # botão quando isto é True E o usuário é superusuário.
        'allow_hard_delete': bool(getattr(settings, 'ALLOW_HARD_DELETE', False)),
    }


def _filter_grantable_permissions(actor, perms_data):
    """Restringe as chaves de data['permissions'] às que o ator já possui.

    Evita que um usuário com uma permissão ampla (ex.: o flag legado
    'manage_users') conceda a si mesmo ou a outros permissões que ele
    próprio não tem — só pode repassar o que já possui.
    """
    if actor.is_superuser:
        return perms_data
    actor_perms = get_user_permissions(actor)
    return {
        key: val for key, val in perms_data.items()
        if key in PERMISSION_FIELDS and getattr(actor_perms, key, False)
    }


def _apply_permissions(user, data, actor=None):
    """Atualiza UserPermissions a partir de data['permissions'] (dict de booleanos) e sincroniza is_staff."""
    perms_data = data.get('permissions')
    if perms_data is None:
        return
    if actor is not None:
        perms_data = _filter_grantable_permissions(actor, perms_data)
    perms = get_user_permissions(user)
    for key in PERMISSION_FIELDS:
        if key in perms_data:
            setattr(perms, key, bool(perms_data[key]))
    perms.save()
    sync_is_staff(user)


@api_view(['POST'])
@throttle_classes([LoginRateThrottle])
@permission_classes([AllowAny])
def login_view(request):
    email    = request.data.get('email', '').strip()
    password = request.data.get('password', '')
    if not email or not password:
        return Response({'error': 'Preencha e-mail e senha.'}, status=400)

    # Busca usuário pelo e-mail e autentica com o username interno
    try:
        user_obj = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        # Anti-enumeração por timing: roda o hasher mesmo sem usuário, para o tempo
        # de resposta não revelar se o e-mail existe (mesma técnica do ModelBackend).
        User().set_password(password)
        return Response({'error': 'E-mail ou senha inválidos.'}, status=400)
    except User.MultipleObjectsReturned:
        return Response({'error': 'E-mail ambíguo. Contate o administrador.'}, status=400)

    user = authenticate(request, username=user_obj.username, password=password)
    if user is None:
        return Response({'error': 'E-mail ou senha inválidos.'}, status=400)
    if not user.is_active:
        return Response({'error': 'Usuário desativado.'}, status=400)
    login(request, user)

    from audit.models import AuditLog
    from audit.middleware import get_current_ip
    from audit.tracking import user_display
    AuditLog.objects.create(
        user=user, user_display=user_display(user), action='login',
        model_name='User', model_label='Login', object_id=str(user.pk),
        object_repr='Entrou no sistema', ip_address=get_current_ip(),
    )

    return Response(serialize_user(user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    user = request.user
    if user.is_authenticated:
        from audit.models import AuditLog
        from audit.middleware import get_current_ip
        from audit.tracking import user_display
        AuditLog.objects.create(
            user=user, user_display=user_display(user), action='logout',
            model_name='User', model_label='Login', object_id=str(user.pk),
            object_repr='Saiu do sistema', ip_address=get_current_ip(),
        )
    logout(request)
    return Response({'message': 'Logout realizado com sucesso.'})


@ensure_csrf_cookie
@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def me_view(request):
    # @ensure_csrf_cookie: reemite o cookie csrftoken a cada boot do app (chamada
    # do /me). Sem isso, em navegador mobile o cookie pode faltar/expirar e os POSTs
    # (ex.: criar documento no Drive) falham com 403 CSRF enquanto os GET funcionam.
    user = request.user
    if request.method == 'PATCH':
        data = request.data
        if 'first_name' in data:
            user.first_name = (data['first_name'] or '').strip() if isinstance(data['first_name'], str) else ''
        if 'last_name' in data:
            user.last_name = (data['last_name'] or '').strip() if isinstance(data['last_name'], str) else ''
        if 'email' in data:
            if not isinstance(data['email'], str):
                return Response({'error': 'E-mail inválido.'}, status=400)
            new_email = data['email'].strip().lower()
            if new_email != user.email:
                if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
                    return Response({'error': 'E-mail já está em uso por outra conta.'}, status=400)
                user.email    = new_email
                user.username = new_email
        user.save()
        if 'phone' in data:
            perms = get_user_permissions(user)
            perms.phone = (data['phone'] or '').strip()
            perms.save(update_fields=['phone'])
    return Response(serialize_user(user))


# Formatos de imagem aceitos para a foto de perfil (o conteúdo é revalidado
# com Pillow e re-encodado como JPEG — não confiamos na extensão/mimetype).
_AVATAR_MAX_BYTES = 5 * 1024 * 1024          # 5 MB
_AVATAR_ALLOWED   = {'JPEG', 'PNG', 'WEBP', 'GIF', 'BMP'}


@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def me_avatar(request):
    """Upload/remoção da foto de perfil do próprio usuário. SEGURO: valida tamanho,
    abre e VERIFICA a imagem com Pillow, e a re-encoda como JPEG (descarta qualquer
    payload/EXIF embutido). Nunca serve o arquivo enviado como veio."""
    from audit.tracking import log_event, user_display
    perms = get_user_permissions(request.user)

    if request.method == 'DELETE':
        if perms.avatar or perms.avatar_original:
            if perms.avatar:
                delete_fieldfile(perms.avatar, 'avatar do usuário')
            if perms.avatar_original:
                delete_fieldfile(perms.avatar_original, 'avatar original do usuário')
            perms.avatar = None; perms.avatar_original = None; perms.avatar_crop = {}
            perms.save(update_fields=['avatar', 'avatar_original', 'avatar_crop'])
            log_event('delete', model_name='UserPermissions', model_label='Foto de perfil',
                      object_id=request.user.id, object_repr=f'Foto de perfil — {user_display(request.user)}', user=request.user)
        return Response(serialize_user(request.user))

    f = request.FILES.get('avatar') or request.FILES.get('file')
    if not f:
        return Response({'error': 'Nenhuma imagem enviada.'}, status=status.HTTP_400_BAD_REQUEST)
    if f.size > _AVATAR_MAX_BYTES:
        return Response({'error': 'Imagem muito grande (máximo 5 MB).'}, status=status.HTTP_400_BAD_REQUEST)

    import io
    from PIL import Image, ImageOps, UnidentifiedImageError
    try:
        # 1) verifica que é uma imagem íntegra do formato esperado.
        probe = Image.open(f)
        fmt = (probe.format or '').upper()
        if fmt not in _AVATAR_ALLOWED:
            return Response({'error': 'Formato não suportado. Use JPG, PNG, WEBP ou GIF.'}, status=status.HTTP_400_BAD_REQUEST)
        probe.verify()                       # detecta arquivo corrompido/falsificado
        # 2) reabre (verify invalida o objeto), normaliza orientação e fundo.
        f.seek(0)
        img = Image.open(f)
        img = ImageOps.exif_transpose(img)
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGBA')
            bg = Image.new('RGB', img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            img = bg
        else:
            img = img.convert('RGB')
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
        return Response({'error': 'Arquivo de imagem inválido.'}, status=status.HTTP_400_BAD_REQUEST)

    # 3) redimensiona (avatar não precisa ser grande) e re-encoda como JPEG.
    img.thumbnail((512, 512))
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=85, optimize=True)
    buf.seek(0)

    from django.core.files.base import ContentFile
    if perms.avatar:
        delete_fieldfile(perms.avatar, 'avatar do usuário')
    perms.avatar.save(f'{request.user.id}.jpg', ContentFile(buf.read()), save=False)
    update_fields = ['avatar']

    # Não-destrutivo: guarda a imagem ORIGINAL (para reabrir/desfazer) + o recorte.
    from passengers.validators import sanitize_image, parse_crop
    from django.core.exceptions import ValidationError as DjangoValidationError
    orig = request.FILES.get('original')
    if orig:
        try:
            cf = sanitize_image(orig, fmt='JPEG', max_dim=1600, bg=(255, 255, 255), max_bytes=_AVATAR_MAX_BYTES)
        except DjangoValidationError:
            cf = None
        if cf is not None:
            if perms.avatar_original:
                delete_fieldfile(perms.avatar_original, 'avatar original do usuário')
            perms.avatar_original.save(f'{request.user.id}_orig.jpg', cf, save=False)
            update_fields.append('avatar_original')
    crop = parse_crop(request.data.get('crop'))
    if crop:
        perms.avatar_crop = crop
        update_fields.append('avatar_crop')

    perms.save(update_fields=update_fields)
    log_event('upload', model_name='UserPermissions', model_label='Foto de perfil',
              object_id=request.user.id, object_repr=f'Foto de perfil — {user_display(request.user)}', user=request.user)
    return Response(serialize_user(request.user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password(request):
    current = request.data.get('current_password', '')
    new_pw  = request.data.get('new_password', '')
    if not current or not new_pw:
        return Response({'error': 'Preencha todos os campos.'}, status=400)
    if not request.user.check_password(current):
        return Response({'error': 'Senha atual incorreta.'}, status=400)
    pw_err = _password_error(new_pw, request.user)
    if pw_err:
        return Response({'error': pw_err}, status=400)
    request.user.set_password(new_pw)
    request.user.save()
    update_session_auth_hash(request, request.user)
    return Response({'ok': True})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_list(request):
    is_internal = has_any_perm(request.user, 'manage_users', 'users_view', 'users_edit', 'users_block', 'users_delete', 'users_manage_permissions')
    admin_ids = agency_admin_ids(request.user)
    if not is_internal and not admin_ids:
        return Response({'error': 'Sem permissão.'}, status=403)
    show_deleted = request.query_params.get('deleted') in ('1', 'true', 'True')
    if is_internal:
        users = User.objects.all().order_by('username')
    else:
        # Admin de agência: só vê os usuários da(s) agência(s) que ele administra,
        # e nunca contas internas (staff/superusuário).
        users = (User.objects
                 .filter(agency_memberships__agency_id__in=admin_ids, is_superuser=False, is_staff=False)
                 .distinct().order_by('username'))
    result = []
    for u in users:
        perms = get_user_permissions(u)
        if bool(perms.is_deleted) == show_deleted:
            result.append(serialize_user(u, perms))
    return Response(result)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def user_create(request):
    is_internal_mgr = has_any_perm(request.user, 'manage_users', 'users_edit')
    actor_admin_ids = agency_admin_ids(request.user)
    if not (is_internal_mgr or actor_admin_ids):
        return Response({'error': 'Sem permissão.'}, status=403)
    # Admin de agência (não interno) cria só usuários DA agência dele: vira membro
    # automaticamente e recebe o perfil padrão de agência (não pode forjar permissões).
    is_agency_admin_create = bool(actor_admin_ids) and not is_internal_mgr
    data       = request.data
    email      = data.get('email', '').strip().lower()
    first_name = data.get('first_name', '').strip()
    last_name  = data.get('last_name', '').strip()

    if not email:
        return Response({'error': 'E-mail é obrigatório.'}, status=400)
    if User.objects.filter(email__iexact=email).exists():
        return Response({'error': 'E-mail já cadastrado.'}, status=400)

    user = User.objects.create_user(
        username=email, password=None, email=email,
        first_name=first_name, last_name=last_name,
    )
    if request.user.is_superuser and data.get('is_superuser'):
        user.is_superuser = True
        user.is_staff     = True
        user.save()
    if not user.is_superuser:
        from config_api.models import PermissionProfile
        can_perms = has_any_perm(request.user, 'manage_users', 'users_manage_permissions')
        want_agency_profile = bool(data.get('agency_user')) or is_agency_admin_create
        prof = None
        if want_agency_profile:
            # Usuário de AGÊNCIA: recebe automaticamente o perfil marcado como
            # "padrão de agência" nas Configurações (template controlado pelos admins).
            prof = PermissionProfile.objects.filter(is_agency_default=True, is_deleted=False).first()
        elif can_perms and data.get('profile_id'):
            # Usuário vinculado a um perfil escolhido no cadastro.
            prof = PermissionProfile.objects.filter(pk=data['profile_id'], is_deleted=False).first()
        if prof:
            # Vínculo VIVO: editar o perfil depois re-aplica a este usuário.
            # O perfil PADRÃO da agência é um template confiável (aplica pleno, dá o
            # baseline mesmo que o admin da agência não tenha). Já um perfil ESCOLHIDO
            # por gestor interno passa pelo filtro do ator — não-super não escala
            # atribuindo um perfil forte (A-01).
            apply_profile(user, prof, actor=None if want_agency_profile else request.user)
        elif not want_agency_profile:
            perm_data = dict(data)
            if not can_perms:
                perm_data.pop('permissions', None)
            _apply_permissions(user, perm_data, actor=request.user)

        # Admin de agência pode ajustar as permissões JÁ na criação: parte do
        # baseline (perfil padrão, aplicado acima) e sobrepõe com o que ele escolheu,
        # SEMPRE limitado às permissões que ele mesmo tem (actor=request.user). Se
        # customizou em relação ao perfil, desvincula (senão o link vivo sobrescreveria).
        if is_agency_admin_create and isinstance(data.get('permissions'), dict):
            sent = data['permissions']
            _apply_permissions(user, {'permissions': sent}, actor=request.user)
            base = prof.permissions if (prof and isinstance(prof.permissions, dict)) else {}
            actor_perms = get_user_permissions(request.user)
            customized = any(bool(sent.get(k)) != bool(base.get(k))
                             for k in PERMISSION_FIELDS if getattr(actor_perms, k, False))
            if customized:
                up = get_user_permissions(user)
                if up.profile_id is not None:
                    up.profile = None
                    up.save(update_fields=['profile'])

    # Admin de agência: vincula o novo usuário à agência dele (senão ficaria órfão
    # e invisível). Usa a agência informada, se for uma que ele administra, ou a
    # única que ele administra.
    if is_agency_admin_create:
        from agencies.models import AgencyMember
        req_ag = data.get('agency_id')
        try:
            req_ag = int(req_ag) if req_ag is not None else None
        except (TypeError, ValueError):
            req_ag = None
        target_agency = req_ag if req_ag in actor_admin_ids else actor_admin_ids[0]
        AgencyMember.objects.get_or_create(agency_id=target_agency, user=user, defaults={'role': 'operator'})

    if 'phone' in data or 'is_seller' in data or 'seller_commission_percent' in data or 'job_role' in data or 'show_on_site' in data:
        perms = get_user_permissions(user)
        fields = []
        if 'phone' in data:
            perms.phone = (data.get('phone') or '').strip(); fields.append('phone')
        if 'is_seller' in data:
            perms.is_seller = bool(data.get('is_seller')); fields.append('is_seller')
        if 'seller_commission_percent' in data:
            v = data.get('seller_commission_percent')
            perms.seller_commission_percent = None if v in (None, '') else v
            fields.append('seller_commission_percent')
        if 'job_role' in data:
            perms.job_role_id = _valid_job_role_id(data.get('job_role')); fields.append('job_role')
        if 'show_on_site' in data:
            perms.show_on_site = bool(data.get('show_on_site')); fields.append('show_on_site')
        perms.save(update_fields=fields)

    # Sempre envia convite por e-mail para o novo usuário definir a própria senha
    try:
        invite     = InviteToken.objects.create(
            email=user.email, first_name=user.first_name, last_name=user.last_name,
            is_staff=user.is_staff, created_by=request.user,
        )
        url        = f"{settings.FRONTEND_URL}/aceitar-convite?token={invite.token}"
        invited_by = request.user.get_full_name() or request.user.username
        send_invite(user.email, user.first_name, url, invited_by)
    except Exception:
        pass  # Falha no envio não cancela a criação do usuário

    return Response(serialize_user(user), status=201)


@api_view(['PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
def user_update(request, pk):
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)
    # Fronteira de privilégio: um não-superusuário NUNCA edita uma conta
    # superusuária. Sem isso, quem tem users_edit poderia trocar o e-mail de um
    # superadmin, disparar forgot-password e assumir a conta (takeover / A-02).
    if not _can_target_user(request.user, user):
        return Response({'error': 'Você não tem permissão para editar esta conta.'}, status=403)
    # Admin de agência pode editar os usuários da agência dele (limitado às
    # permissões que ele mesmo tem; ver _apply_permissions/actor abaixo).
    is_agency_admin_edit = can_manage_agency_user(request.user, user)
    if not (has_any_perm(request.user, 'manage_users', 'users_edit', 'users_block', 'users_manage_permissions') or is_agency_admin_edit):
        return Response({'error': 'Sem permissão.'}, status=403)

    data = request.data
    if has_any_perm(request.user, 'manage_users', 'users_edit') or is_agency_admin_edit:
        if 'first_name' in data: user.first_name = data['first_name']
        if 'last_name'  in data: user.last_name  = data['last_name']
        if 'email' in data:
            new_email = (data['email'] or '').strip().lower()
            if not new_email:
                return Response({'error': 'E-mail é obrigatório.'}, status=400)
            if new_email != user.email:
                if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
                    return Response({'error': 'E-mail já está em uso por outra conta.'}, status=400)
                # username == email em todo o sistema; manter sincronizado para o login
                # (que busca por e-mail e autentica pelo username) não quebrar.
                user.email    = new_email
                user.username = new_email
    if has_any_perm(request.user, 'manage_users', 'users_edit', 'users_block') or is_agency_admin_edit:
        if 'is_active'  in data: user.is_active  = bool(data['is_active'])

    # Apenas superusuários existentes podem conceder/revogar superusuário
    if request.user.is_superuser and 'is_superuser' in data:
        new_is_superuser = bool(data['is_superuser'])
        if user.pk == request.user.pk and user.is_superuser and not new_is_superuser:
            return Response({'error': 'Não é possível remover sua própria permissão de superusuário.'}, status=400)
        user.is_superuser = new_is_superuser
        if new_is_superuser:
            user.is_staff = True

    user.save()
    if not user.is_superuser:
        from config_api.models import PermissionProfile
        # Gestor interno pode vincular perfil; admin de agência edita permissões,
        # mas SEMPRE limitado às que ele tem (actor=request.user filtra) e NUNCA
        # pode forjar um perfil (evita escalar concedendo um perfil forte).
        internal_perms = has_any_perm(request.user, 'manage_users', 'users_manage_permissions')
        can_perms = internal_perms or is_agency_admin_edit
        perm_data = dict(data)
        if not can_perms:
            perm_data.pop('permissions', None)
            perm_data.pop('profile_id', None)
        if not internal_perms:
            perm_data.pop('profile_id', None)   # só gestor interno linka perfil
        if internal_perms and perm_data.get('profile_id'):
            # Vincula a um perfil (link vivo). Editar o perfil depois re-aplica aqui.
            prof = PermissionProfile.objects.filter(pk=perm_data['profile_id'], is_deleted=False).first()
            if prof:
                apply_profile(user, prof, actor=request.user)
            else:
                _apply_permissions(user, perm_data, actor=request.user)
        else:
            _apply_permissions(user, perm_data, actor=request.user)
            # O front manda profile_id=null ao mexer numa permissão à mão: desvincula.
            if 'profile_id' in perm_data:
                perms = get_user_permissions(user)
                if perms.profile_id is not None:
                    perms.profile = None
                    perms.save(update_fields=['profile'])
    else:
        get_user_permissions(user).save()
    if (('phone' in data or 'is_seller' in data or 'seller_commission_percent' in data or 'job_role' in data or 'show_on_site' in data)
            and (has_any_perm(request.user, 'manage_users', 'users_edit') or is_agency_admin_edit)):
        perms = get_user_permissions(user)
        fields = []
        if 'phone' in data:
            perms.phone = (data.get('phone') or '').strip(); fields.append('phone')
        if 'is_seller' in data:
            perms.is_seller = bool(data.get('is_seller')); fields.append('is_seller')
        if 'seller_commission_percent' in data:
            v = data.get('seller_commission_percent')
            perms.seller_commission_percent = None if v in (None, '') else v
            fields.append('seller_commission_percent')
        if 'job_role' in data:
            perms.job_role_id = _valid_job_role_id(data.get('job_role')); fields.append('job_role')
        if 'show_on_site' in data:
            perms.show_on_site = bool(data.get('show_on_site')); fields.append('show_on_site')
        perms.save(update_fields=fields)
    # Se virou conta interna (staff/superusuário), deixa de ser usuário de agência →
    # remove os vínculos de agência (senão continuava aparecendo na agência).
    drop_agency_memberships_if_internal(user)
    return Response(serialize_user(user))


@api_view(['POST'])
@throttle_classes([PasswordResetRateThrottle])
@permission_classes([AllowAny])
def forgot_password(request):
    email = request.data.get('email', '').strip()
    if not email:
        return Response({'error': 'Informe o e-mail.'}, status=400)
    try:
        user = User.objects.get(email__iexact=email, is_active=True)
    except User.DoesNotExist:
        # Não revela se o e-mail existe ou não (segurança). Usuários desativados
        # (soft-delete) também caem aqui e não recebem link.
        return Response({'message': 'Se este e-mail estiver cadastrado, você receberá um link em breve.'})

    # Invalida links anteriores ainda não usados: só o mais recente vale (reduz a
    # janela de tokens válidos coexistindo).
    PasswordResetToken.objects.filter(user=user, used=False).update(used=True)
    token = PasswordResetToken.objects.create(user=user)
    url   = f"{settings.FRONTEND_URL}/redefinir-senha?token={token.token}"
    send_reset_password(user.email, user.first_name, url)
    return Response({'message': 'Se este e-mail estiver cadastrado, você receberá um link em breve.'})


@api_view(['POST'])
@throttle_classes([PasswordResetRateThrottle])
@permission_classes([AllowAny])
def reset_password(request):
    token_str = request.data.get('token', '').strip()
    password  = request.data.get('password', '')
    if not token_str or not password:
        return Response({'error': 'Token e nova senha são obrigatórios.'}, status=400)
    try:
        token = PasswordResetToken.objects.get(token=token_str)
    except PasswordResetToken.DoesNotExist:
        return Response({'error': 'Link inválido ou expirado.'}, status=400)
    if not token.is_valid:
        return Response({'error': 'Link inválido ou expirado.'}, status=400)
    # Conta desativada (soft-delete) não redefine senha — evita reativar acesso via
    # um token emitido antes da desativação (ou por admin_send_reset).
    if not token.user.is_active:
        return Response({'error': 'Conta desativada. Contate o administrador.'}, status=400)
    pw_err = _password_error(password, token.user)
    if pw_err:
        return Response({'error': pw_err}, status=400)
    token.user.set_password(password)
    token.user.save()
    token.used = True
    token.save()
    return Response({'message': 'Senha redefinida com sucesso.', 'email': token.user.email})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def send_user_invite(request, pk):
    if not has_any_perm(request.user, 'manage_users', 'users_edit'):
        return Response({'error': 'Sem permissão.'}, status=403)
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)
    # Fronteira de privilégio: não-superusuário não dispara convite de ativação
    # para conta superusuária (mesma classe de risco do admin_send_reset).
    if not _can_target_user(request.user, user):
        return Response({'error': 'Você não tem permissão para esta ação.'}, status=403)

    invite = InviteToken.objects.create(
        email=user.email, first_name=user.first_name, last_name=user.last_name,
        is_staff=user.is_staff, created_by=request.user,
    )
    url   = f"{settings.FRONTEND_URL}/aceitar-convite?token={invite.token}"
    invited_by = request.user.get_full_name() or request.user.username
    send_invite(user.email, user.first_name, url, invited_by)
    return Response({'message': f'Convite enviado para {user.email}.'})


@api_view(['GET', 'POST'])
@throttle_classes([InviteRateThrottle])
@permission_classes([AllowAny])
def validate_invite(request):
    # F-01: token vai no corpo (POST) para não vazar em URL/logs/histórico. O GET
    # com ?token= é mantido só como compatibilidade temporária (DEPRECATED) e não
    # é mais usado pelo frontend.
    token_str = (request.data.get('token') if request.method == 'POST'
                 else request.query_params.get('token', '')) or ''
    try:
        invite = InviteToken.objects.get(token=token_str)
    except InviteToken.DoesNotExist:
        return Response({'error': 'Convite inválido ou expirado.'}, status=400)
    if not invite.is_valid:
        return Response({'error': 'Convite inválido ou expirado.'}, status=400)
    return Response({'email': invite.email, 'first_name': invite.first_name, 'last_name': invite.last_name})


@api_view(['POST'])
@throttle_classes([PasswordResetRateThrottle])
@permission_classes([AllowAny])
def validate_reset_token(request):
    """F-07: valida o token de redefinição no CARREGAMENTO da página, para mostrar
    "link inválido/expirado" antes de o usuário digitar a senha. O submit
    (reset_password) continua validando também — esta checagem é só de UX."""
    token_str = (request.data.get('token') or '').strip()
    if not token_str:
        return Response({'error': 'Token ausente.'}, status=400)
    try:
        token = PasswordResetToken.objects.get(token=token_str)
    except PasswordResetToken.DoesNotExist:
        return Response({'error': 'Link inválido ou expirado.'}, status=400)
    if not token.is_valid:
        return Response({'error': 'Link inválido ou expirado.'}, status=400)
    return Response({'valid': True, 'email': token.user.email})


@api_view(['POST'])
@throttle_classes([InviteRateThrottle])
@permission_classes([AllowAny])
def accept_invite(request):
    from config_api.models import TermsAndConditions

    token_str = request.data.get('token', '').strip()
    password  = request.data.get('password', '')
    if not token_str or not password:
        return Response({'error': 'Token e senha são obrigatórios.'}, status=400)
    terms = TermsAndConditions.get()
    if _has_visible_text(terms.content) and not request.data.get('terms_accepted'):
        return Response({'error': 'É preciso concordar com os Termos e Condições.'}, status=400)
    try:
        invite = InviteToken.objects.get(token=token_str)
    except InviteToken.DoesNotExist:
        return Response({'error': 'Convite inválido ou expirado.'}, status=400)
    if not invite.is_valid:
        return Response({'error': 'Convite inválido ou expirado.'}, status=400)

    # Cria ou atualiza o usuário.
    # Obs.: não usar get_or_create(email__iexact=...) — o lookup "__iexact" não é
    # um campo do model e quebra o ramo de criação (TypeError/FieldError). Buscamos
    # por lookup e instanciamos manualmente quando não existe.
    user = User.objects.filter(email__iexact=invite.email).first()
    if user is None:
        user = User(username=invite.email.lower(), email=invite.email)
    user.email      = invite.email
    user.username   = invite.email.lower()
    user.first_name = invite.first_name
    user.last_name  = invite.last_name
    user.is_active  = True
    # Valida a política de senha já com os dados do usuário (similaridade) — F-03.
    pw_err = _password_error(password, user)
    if pw_err:
        return Response({'error': pw_err}, status=400)
    user.set_password(password)
    user.save()

    if _has_visible_text(terms.content):
        perms = get_user_permissions(user)
        perms.terms_accepted_at = timezone.now()
        perms.save(update_fields=['terms_accepted_at'])

    invite.used = True
    invite.save()

    return Response({'message': 'Conta ativada com sucesso.', 'email': user.email})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def accept_terms(request):
    """Usuário já logado confirma que leu/concorda com os Termos e Condições
    vigentes — usado no gate pós-login (quem já tinha senha definida)."""
    perms = get_user_permissions(request.user)
    perms.terms_accepted_at = timezone.now()
    perms.save(update_fields=['terms_accepted_at'])
    return Response(serialize_user(request.user, perms))


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def user_delete(request, pk):
    """Soft-delete — nunca remove o usuário do banco. Marca como excluído
    (vai pra aba "Excluídos") e desativa o login; só um superusuário pode
    restaurar ou remover de vez (ver user_restore/user_purge)."""
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)
    if not (request.user.is_superuser or has_any_perm(request.user, 'users_delete')
            or can_manage_agency_user(request.user, user)):
        return Response({'error': 'Sem permissão para excluir usuários.'}, status=403)
    # Fronteira de privilégio: não-superusuário não exclui/desativa conta superusuária.
    if not _can_target_user(request.user, user):
        return Response({'error': 'Você não tem permissão para editar esta conta.'}, status=403)
    if user == request.user:
        return Response({'error': 'Não é possível excluir seu próprio usuário.'}, status=400)
    perms = get_user_permissions(user)
    perms.is_deleted = True
    perms.deleted_at = timezone.now()
    perms.save(update_fields=['is_deleted', 'deleted_at'])
    user.is_active = False
    user.save(update_fields=['is_active'])
    _log_user_action(request.user, user, 'delete')
    return Response(status=204)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def user_unlink_agencies(request, pk):
    """Desvincula o usuário de TODAS as agências (remove os AgencyMember). Ele deixa
    de ser usuário de agência (some da página de agências), mas mantém a conta e as
    permissões atuais."""
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)
    # Gestor interno ou admin de uma agência do usuário podem desvincular.
    if not (has_any_perm(request.user, 'manage_users', 'users_edit') or can_manage_agency_user(request.user, user)):
        return Response({'error': 'Sem permissão.'}, status=403)
    # Fronteira de privilégio: não-superusuário não manipula conta superusuária.
    if not _can_target_user(request.user, user):
        return Response({'error': 'Você não tem permissão para editar esta conta.'}, status=403)
    from agencies.models import AgencyMember
    from audit.tracking import log_bulk_delete
    members = list(AgencyMember.objects.filter(user=user))
    log_bulk_delete(members, model_name='AgencyMember', model_label='Membro de agência')
    AgencyMember.objects.filter(pk__in=[m.pk for m in members]).delete()
    return Response(serialize_user(user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def user_restore(request, pk):
    if not request.user.is_superuser:
        return Response({'error': 'Apenas superusuário pode restaurar.'}, status=403)
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)
    perms = get_user_permissions(user)
    perms.is_deleted = False
    perms.deleted_at = None
    perms.save(update_fields=['is_deleted', 'deleted_at'])
    _log_user_action(request.user, user, 'restore')
    return Response(serialize_user(user, perms))


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def user_purge(request, pk):
    if not request.user.is_superuser:
        return Response({'error': 'Apenas superusuário pode excluir definitivamente.'}, status=403)
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)
    if user == request.user:
        return Response({'error': 'Não é possível excluir seu próprio usuário.'}, status=400)
    _log_user_action(request.user, user, 'purge')
    user.delete()
    return Response(status=204)


def _can_target_user(actor, target):
    """Fronteira de privilégio para ações sensíveis sobre OUTRA conta (redefinir
    senha / enviar reset). Um não-superusuário NUNCA pode mexer numa conta
    superusuário — senão bastaria ter users_set_password/manage_users para
    resetar a senha de um admin e assumir a conta (escalada de privilégio).
    Apenas superusuário age sobre superusuário."""
    if actor.is_superuser:
        return True
    return not target.is_superuser


def _log_user_action(actor, target_user, action):
    from audit.models import AuditLog
    from audit.middleware import get_current_ip
    from audit.tracking import user_display
    label = {'delete': 'Excluído', 'restore': 'Restaurado', 'purge': 'Removido definitivamente'}[action]
    AuditLog.objects.create(
        user=actor, user_display=user_display(actor), action=action,
        model_name='User', model_label='Usuário', object_id=str(target_user.pk),
        object_repr=f'{label}: {target_user.email}',
        ip_address=get_current_ip(),
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_send_reset(request, pk):
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)
    if not (has_any_perm(request.user, 'manage_users', 'users_edit') or can_manage_agency_user(request.user, user)):
        return Response({'error': 'Sem permissão.'}, status=403)
    if not _can_target_user(request.user, user):
        return Response({'error': 'Você não tem permissão para esta ação.'}, status=403)
    PasswordResetToken.objects.filter(user=user, used=False).update(used=True)
    token = PasswordResetToken.objects.create(user=user)
    url   = f"{settings.FRONTEND_URL}/redefinir-senha?token={token.token}"
    send_reset_password(user.email, user.first_name, url)
    return Response({'message': f'E-mail de redefinição enviado para {user.email}.'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_set_password(request, pk):
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)
    if not (request.user.is_superuser or has_any_perm(request.user, 'manage_users', 'users_set_password')
            or can_manage_agency_user(request.user, user)):
        return Response({'error': 'Sem permissão.'}, status=403)
    if not _can_target_user(request.user, user):
        return Response({'error': 'Você não tem permissão para esta ação.'}, status=403)
    admin_password = request.data.get('admin_password', '')
    if not request.user.check_password(admin_password):
        return Response({'error': 'Sua senha está incorreta.'}, status=400)
    password = request.data.get('password', '')
    pw_err = _password_error(password, user)
    if pw_err:
        return Response({'error': pw_err}, status=400)
    user.set_password(password)
    user.save()
    return Response({'message': 'Senha definida com sucesso.'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_storage(request):
    """Uso de armazenamento do PRÓPRIO usuário (Meus Documentos)."""
    from drive.usage import storage_usage
    data = storage_usage(request.user)
    data['user_id'] = request.user.id
    return Response(data)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def user_storage(request, pk):
    """GET: uso de armazenamento de um usuário (perm users_storage_view / próprio /
    admin da agência). PATCH {limit_gb: number|null}: define ou limpa o limite de
    armazenamento (perm users_storage_limit)."""
    from drive.usage import storage_usage
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)

    is_self  = user.id == request.user.id
    can_view = (is_self or request.user.is_superuser
                or has_any_perm(request.user, 'manage_users', 'users_storage_view')
                or can_manage_agency_user(request.user, user))
    if not can_view:
        return Response({'error': 'Sem permissão.'}, status=403)

    if request.method == 'PATCH' and 'limit_gb' in request.data:
        can_limit = (request.user.is_superuser
                     or has_any_perm(request.user, 'manage_users', 'users_storage_limit')
                     or can_manage_agency_user(request.user, user))
        if not can_limit:
            return Response({'error': 'Sem permissão para definir limite.'}, status=403)
        perms = get_user_permissions(user)
        raw = request.data.get('limit_gb')
        if raw in (None, '', 'null'):
            perms.storage_limit_bytes = None
        else:
            try:
                gb = float(raw)
            except (TypeError, ValueError):
                return Response({'error': 'Limite inválido.'}, status=400)
            perms.storage_limit_bytes = int(round(gb * 1024 ** 3)) if gb > 0 else None
        perms.save(update_fields=['storage_limit_bytes'])
        from audit.tracking import log_event, user_display
        log_event('update', model_name='UserPermissions', model_label='Limite de armazenamento',
                  object_id=user.id, object_repr=f'Limite de armazenamento — {user_display(user)}', user=request.user)

    data = storage_usage(user)
    data['user_id'] = user.id
    return Response(data)

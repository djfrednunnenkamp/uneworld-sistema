from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.models import User
from django.conf import settings
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from .models import PasswordResetToken, InviteToken
from .email_service import send_reset_password, send_invite
from .permissions import PERMISSION_FIELDS, permissions_dict, has_any_perm, sync_is_staff, get_user_permissions


def serialize_user(u):
    return {
        'id':           u.id,
        'username':     u.username,
        'email':        u.email,
        'first_name':   u.first_name,
        'last_name':    u.last_name,
        'full_name':    f"{u.first_name} {u.last_name}".strip() or u.username,
        'is_staff':     u.is_staff,
        'is_superuser': u.is_superuser,
        'is_active':    u.is_active,
        'date_joined':  u.date_joined,
        'last_login':   u.last_login,
        'updated_at':   get_user_permissions(u).updated_at,
        'permissions':  permissions_dict(u),
    }


def _apply_permissions(user, data):
    """Atualiza UserPermissions a partir de data['permissions'] (dict de booleanos) e sincroniza is_staff."""
    perms_data = data.get('permissions')
    if perms_data is None:
        return
    perms = get_user_permissions(user)
    for key in PERMISSION_FIELDS:
        if key in perms_data:
            setattr(perms, key, bool(perms_data[key]))
    perms.save()
    sync_is_staff(user)


@api_view(['POST'])
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
        return Response({'error': 'E-mail ou senha inválidos.'}, status=400)
    except User.MultipleObjectsReturned:
        return Response({'error': 'E-mail ambíguo. Contate o administrador.'}, status=400)

    user = authenticate(request, username=user_obj.username, password=password)
    if user is None:
        return Response({'error': 'E-mail ou senha inválidos.'}, status=400)
    if not user.is_active:
        return Response({'error': 'Usuário desativado.'}, status=400)
    login(request, user)
    return Response(serialize_user(user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    logout(request)
    return Response({'message': 'Logout realizado com sucesso.'})


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def me_view(request):
    user = request.user
    if request.method == 'PATCH':
        data = request.data
        if 'first_name' in data:
            user.first_name = data['first_name'].strip()
        if 'last_name' in data:
            user.last_name = data['last_name'].strip()
        if 'email' in data:
            new_email = data['email'].strip().lower()
            if new_email != user.email:
                if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
                    return Response({'error': 'E-mail já está em uso por outra conta.'}, status=400)
                user.email    = new_email
                user.username = new_email
        user.save()
    return Response(serialize_user(user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password(request):
    current = request.data.get('current_password', '')
    new_pw  = request.data.get('new_password', '')
    if not current or not new_pw:
        return Response({'error': 'Preencha todos os campos.'}, status=400)
    if len(new_pw) < 8:
        return Response({'error': 'A nova senha deve ter pelo menos 8 caracteres.'}, status=400)
    if not request.user.check_password(current):
        return Response({'error': 'Senha atual incorreta.'}, status=400)
    request.user.set_password(new_pw)
    request.user.save()
    update_session_auth_hash(request, request.user)
    return Response({'ok': True})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_list(request):
    if not has_any_perm(request.user, 'manage_users', 'users_view', 'users_edit', 'users_delete', 'users_manage_permissions'):
        return Response({'error': 'Sem permissão.'}, status=403)
    users = User.objects.all().order_by('username')
    return Response([serialize_user(u) for u in users])


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def user_create(request):
    if not has_any_perm(request.user, 'manage_users', 'users_edit'):
        return Response({'error': 'Sem permissão.'}, status=403)
    data       = request.data
    email      = data.get('email', '').strip().lower()
    password   = data.get('password', '')
    first_name = data.get('first_name', '').strip()
    last_name  = data.get('last_name', '').strip()

    if not email:
        return Response({'error': 'E-mail é obrigatório.'}, status=400)
    if password and len(password) < 8:
        return Response({'error': 'A senha deve ter pelo menos 8 caracteres.'}, status=400)
    if User.objects.filter(email__iexact=email).exists():
        return Response({'error': 'E-mail já cadastrado.'}, status=400)

    # username = e-mail (identificador interno único)
    # Sem senha: usuário é criado com senha inutilizável — define a sua via convite por e-mail
    user = User.objects.create_user(
        username=email, password=password or None, email=email,
        first_name=first_name, last_name=last_name,
    )
    # Apenas superusuários existentes podem criar outro superusuário
    if request.user.is_superuser and data.get('is_superuser'):
        user.is_superuser = True
        user.is_staff     = True
        user.save()
    # Novos usuários começam sem nenhuma permissão até serem configurados aqui
    if not user.is_superuser:
        _apply_permissions(user, data)
    return Response(serialize_user(user), status=201)


@api_view(['PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
def user_update(request, pk):
    if not has_any_perm(request.user, 'manage_users', 'users_edit', 'users_manage_permissions'):
        return Response({'error': 'Sem permissão.'}, status=403)
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)

    data = request.data
    if 'first_name' in data: user.first_name = data['first_name']
    if 'last_name'  in data: user.last_name  = data['last_name']
    if 'email'      in data: user.email      = data['email']
    if 'is_active'  in data: user.is_active  = bool(data['is_active'])
    if 'password'   in data and data['password']:
        user.set_password(data['password'])

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
        _apply_permissions(user, data)
    else:
        get_user_permissions(user).save()
    return Response(serialize_user(user))


@api_view(['POST'])
@permission_classes([AllowAny])
def forgot_password(request):
    email = request.data.get('email', '').strip()
    if not email:
        return Response({'error': 'Informe o e-mail.'}, status=400)
    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        # Não revela se o e-mail existe ou não (segurança)
        return Response({'message': 'Se este e-mail estiver cadastrado, você receberá um link em breve.'})

    token = PasswordResetToken.objects.create(user=user)
    url   = f"{settings.FRONTEND_URL}/redefinir-senha?token={token.token}"
    send_reset_password(user.email, user.first_name, url)
    return Response({'message': 'Se este e-mail estiver cadastrado, você receberá um link em breve.'})


@api_view(['POST'])
@permission_classes([AllowAny])
def reset_password(request):
    token_str = request.data.get('token', '').strip()
    password  = request.data.get('password', '')
    if not token_str or not password:
        return Response({'error': 'Token e nova senha são obrigatórios.'}, status=400)
    if len(password) < 8:
        return Response({'error': 'A senha deve ter pelo menos 8 caracteres.'}, status=400)
    try:
        token = PasswordResetToken.objects.get(token=token_str)
    except PasswordResetToken.DoesNotExist:
        return Response({'error': 'Link inválido ou expirado.'}, status=400)
    if not token.is_valid:
        return Response({'error': 'Link inválido ou expirado.'}, status=400)
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

    invite = InviteToken.objects.create(
        email=user.email, first_name=user.first_name, last_name=user.last_name,
        is_staff=user.is_staff, created_by=request.user,
    )
    url   = f"{settings.FRONTEND_URL}/aceitar-convite?token={invite.token}"
    invited_by = request.user.get_full_name() or request.user.username
    send_invite(user.email, user.first_name, url, invited_by)
    return Response({'message': f'Convite enviado para {user.email}.'})


@api_view(['GET'])
@permission_classes([AllowAny])
def validate_invite(request):
    token_str = request.query_params.get('token', '')
    try:
        invite = InviteToken.objects.get(token=token_str)
    except InviteToken.DoesNotExist:
        return Response({'error': 'Convite inválido ou expirado.'}, status=400)
    if not invite.is_valid:
        return Response({'error': 'Convite inválido ou expirado.'}, status=400)
    return Response({'email': invite.email, 'first_name': invite.first_name, 'last_name': invite.last_name})


@api_view(['POST'])
@permission_classes([AllowAny])
def accept_invite(request):
    token_str = request.data.get('token', '').strip()
    password  = request.data.get('password', '')
    if not token_str or not password:
        return Response({'error': 'Token e senha são obrigatórios.'}, status=400)
    if len(password) < 8:
        return Response({'error': 'A senha deve ter pelo menos 8 caracteres.'}, status=400)
    try:
        invite = InviteToken.objects.get(token=token_str)
    except InviteToken.DoesNotExist:
        return Response({'error': 'Convite inválido ou expirado.'}, status=400)
    if not invite.is_valid:
        return Response({'error': 'Convite inválido ou expirado.'}, status=400)

    # Cria ou atualiza o usuário
    user, created = User.objects.get_or_create(
        email__iexact=invite.email,
        defaults={'username': invite.email.lower()}
    )
    user.email      = invite.email
    user.username   = invite.email.lower()
    user.first_name = invite.first_name
    user.last_name  = invite.last_name
    user.is_active  = True
    user.set_password(password)
    user.save()

    invite.used = True
    invite.save()

    return Response({'message': 'Conta ativada com sucesso.', 'email': user.email})


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def user_delete(request, pk):
    if not (request.user.is_superuser or has_any_perm(request.user, 'users_delete')):
        return Response({'error': 'Sem permissão para excluir usuários.'}, status=403)
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)
    if user == request.user:
        return Response({'error': 'Não é possível excluir seu próprio usuário.'}, status=400)
    user.delete()
    return Response(status=204)

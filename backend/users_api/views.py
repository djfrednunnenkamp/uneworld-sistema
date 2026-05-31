from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status


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
    }


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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    return Response(serialize_user(request.user))


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_list(request):
    if not request.user.is_staff:
        return Response({'error': 'Sem permissão.'}, status=403)
    users = User.objects.all().order_by('username')
    return Response([serialize_user(u) for u in users])


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def user_create(request):
    if not request.user.is_staff:
        return Response({'error': 'Sem permissão.'}, status=403)
    data       = request.data
    email      = data.get('email', '').strip().lower()
    password   = data.get('password', '')
    first_name = data.get('first_name', '').strip()
    last_name  = data.get('last_name', '').strip()
    is_staff   = bool(data.get('is_staff', False))

    if not email or not password:
        return Response({'error': 'E-mail e senha são obrigatórios.'}, status=400)
    if User.objects.filter(email__iexact=email).exists():
        return Response({'error': 'E-mail já cadastrado.'}, status=400)

    # username = e-mail (identificador interno único)
    user = User.objects.create_user(
        username=email, password=password, email=email,
        first_name=first_name, last_name=last_name, is_staff=is_staff,
    )
    return Response(serialize_user(user), status=201)


@api_view(['PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
def user_update(request, pk):
    if not request.user.is_staff:
        return Response({'error': 'Sem permissão.'}, status=403)
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)

    data = request.data
    if 'first_name' in data: user.first_name = data['first_name']
    if 'last_name'  in data: user.last_name  = data['last_name']
    if 'email'      in data: user.email      = data['email']
    if 'is_staff'   in data: user.is_staff   = bool(data['is_staff'])
    if 'is_active'  in data: user.is_active  = bool(data['is_active'])
    if 'password'   in data and data['password']:
        user.set_password(data['password'])
    user.save()
    return Response(serialize_user(user))


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def user_delete(request, pk):
    if not request.user.is_superuser:
        return Response({'error': 'Apenas superusuários podem excluir usuários.'}, status=403)
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'Usuário não encontrado.'}, status=404)
    if user == request.user:
        return Response({'error': 'Não é possível excluir seu próprio usuário.'}, status=400)
    user.delete()
    return Response(status=204)

import re
from django.contrib.auth.models import User
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from .models import Agency, AgencyMember
from .serializers import AgencySerializer, AgencyListSerializer


class AgencyViewSet(viewsets.ModelViewSet):
    queryset        = Agency.objects.all()
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields   = ['name', 'company_name', 'email', 'cnpj', 'responsible']
    ordering_fields = ['name', 'created_at']

    def get_serializer_class(self):
        return AgencyListSerializer if self.action == 'list' else AgencySerializer

    @action(detail=False, methods=['get'], url_path='check-cnpj',
            permission_classes=[IsAuthenticated])
    def check_cnpj(self, request):
        cnpj = request.query_params.get('cnpj', '').strip()
        if not cnpj:
            return Response({'error': 'CNPJ não informado.'}, status=400)
        digits = re.sub(r'\D', '', cnpj)
        from django.db.models import Q
        agency = Agency.objects.filter(Q(cnpj=cnpj) | Q(cnpj=digits)).exclude(cnpj='').first()
        if agency:
            name = agency.company_name or agency.name or f'Agência #{agency.pk}'
            return Response({'exists': True, 'id': agency.id, 'name': name})
        return Response({'exists': False})

    # ── Membros ──────────────────────────────────────────────────────────────

    @action(detail=True, methods=['get'], url_path='members',
            permission_classes=[IsAuthenticated])
    def list_members(self, request, pk=None):
        agency  = self.get_object()
        members = agency.members.select_related('user').all()
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

    @action(detail=True, methods=['post'], url_path='members',
            permission_classes=[IsAdminUser])
    def add_member(self, request, pk=None):
        """Adiciona usuário existente à agência pelo e-mail."""
        agency = self.get_object()
        email  = request.data.get('email', '').strip().lower()
        role   = request.data.get('role', 'operator')
        if not email:
            return Response({'error': 'E-mail obrigatório.'}, status=400)
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            return Response({'error': 'Usuário não encontrado. Convide-o primeiro pela página de Usuários.'}, status=404)
        if agency.members.filter(user=user).exists():
            return Response({'error': 'Usuário já pertence a esta agência.'}, status=400)
        m = AgencyMember.objects.create(agency=agency, user=user, role=role)
        return Response({'id': m.id, 'email': user.email,
                         'full_name': f'{user.first_name} {user.last_name}'.strip() or user.email,
                         'role': m.role, 'is_active': user.is_active}, status=201)

    @action(detail=True, methods=['patch'], url_path=r'members/(?P<member_id>\d+)',
            permission_classes=[IsAdminUser])
    def update_member(self, request, pk=None, member_id=None):
        agency = self.get_object()
        try:
            m = agency.members.get(id=member_id)
            if 'role' in request.data:
                m.role = request.data['role']
                m.save()
            return Response({'id': m.id, 'role': m.role})
        except AgencyMember.DoesNotExist:
            return Response({'error': 'Membro não encontrado.'}, status=404)

    @action(detail=True, methods=['delete'], url_path=r'members/(?P<member_id>\d+)',
            permission_classes=[IsAdminUser])
    def remove_member(self, request, pk=None, member_id=None):
        agency = self.get_object()
        try:
            agency.members.get(id=member_id).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        except AgencyMember.DoesNotExist:
            return Response({'error': 'Membro não encontrado.'}, status=404)

import re
from django.contrib.auth.models import User
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from core.pagination import StandardResultsPagination
from core.soft_delete import SoftDeleteViewSetMixin
from core.merge import MergeViewSetMixin
from users_api.permissions import RequirePermission
from .models import Agency, AgencyMember
from .serializers import AgencySerializer, AgencyListSerializer

# Quem pode editar passageiros/listas precisa enxergar/buscar agências
# (AgencyPicker, autocomplete de agência responsável etc.), então essas
# permissões também liberam list/retrieve, além de agencies_view.
VIEW_PERMS = ['agencies_view', 'passengers_edit', 'passengers_view_full', 'lists_edit']


class AgencyViewSet(SoftDeleteViewSetMixin, MergeViewSetMixin, viewsets.ModelViewSet):
    queryset        = Agency.objects.all()
    pagination_class = StandardResultsPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
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
        qs = super().get_queryset()   # aplica o filtro de soft-delete (is_deleted)
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
        serializer.save(created_by=self.request.user)

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
            return [RequirePermission(*VIEW_PERMS)()]
        if self.action == 'members':
            if self.request.method == 'POST':
                return [RequirePermission('agencies_edit')()]
            return [RequirePermission(*VIEW_PERMS)()]
        return super().get_permissions()

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

    @action(detail=True, methods=['get', 'post'], url_path='members')
    def members(self, request, pk=None):
        """GET: lista membros. POST: adiciona membro."""
        agency = self.get_object()

        if request.method == 'GET':
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

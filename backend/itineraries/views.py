from django.db import transaction
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response

from core.pagination import StandardResultsPagination
from core.soft_delete import SoftDeleteViewSetMixin
from users_api.permissions import RequirePermission

from .models import Itinerary, ItineraryImage
from .serializers import ItinerarySerializer, ItineraryListSerializer, ItineraryImageSerializer


class ItineraryViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset         = Itinerary.objects.select_related(
        'category', 'continent', 'itinerary_type', 'maritime_company',
    ).prefetch_related(
        'accommodation_lines__accommodation_type',
        'cities__state__country', 'days', 'images',
    )
    pagination_class = StandardResultsPagination
    filter_backends  = [filters.SearchFilter, filters.OrderingFilter]
    search_fields    = ['name', 'slug']
    ordering_fields  = ['created_at', 'start_date', 'name']

    def get_serializer_class(self):
        return ItineraryListSerializer if self.action == 'list' else ItinerarySerializer

    def get_permissions(self):
        if self.action == 'destroy':
            return [RequirePermission('roteiros_delete')()]
        if self.action in ('create', 'update', 'partial_update', 'restore', 'purge',
                           'upload_image', 'delete_image'):
            return [RequirePermission('roteiros_edit')()]
        return [RequirePermission('roteiros_view', 'roteiros_edit', 'roteiros_delete')()]

    # ── Galeria de imagens (upload multipart — não cabe no PUT/JSON) ──
    @action(detail=True, methods=['post'], url_path='images')
    def upload_image(self, request, pk=None):
        """POST /api/itineraries/{id}/images/  (multipart: image, caption?, is_cover?, order?)"""
        itinerary = self.get_object()
        ser = ItineraryImageSerializer(data=request.data, context=self.get_serializer_context())
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            # Respeita a constraint uniq_cover_per_itinerary: só pode haver uma capa.
            if ser.validated_data.get('is_cover'):
                itinerary.images.filter(is_cover=True).update(is_cover=False)
            img = ser.save(itinerary=itinerary)
        out = ItineraryImageSerializer(img, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'images/(?P<image_id>[0-9]+)')
    def delete_image(self, request, pk=None, image_id=None):
        """DELETE /api/itineraries/{id}/images/{image_id}/"""
        itinerary = self.get_object()
        try:
            img = itinerary.images.get(pk=image_id)
        except ItineraryImage.DoesNotExist:
            return Response({'detail': 'Imagem não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        img.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

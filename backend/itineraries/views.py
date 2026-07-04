from django.db import transaction
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response

from core.pagination import StandardResultsPagination
from core.soft_delete import SoftDeleteViewSetMixin
from users_api.permissions import RequirePermission

from .models import Itinerary, ItineraryImage, ItineraryDocument
from .serializers import (ItinerarySerializer, ItineraryListSerializer,
                          ItineraryImageSerializer, ItineraryDocumentSerializer)


class ItineraryViewSet(SoftDeleteViewSetMixin, viewsets.ModelViewSet):
    queryset         = Itinerary.objects.select_related(
        'category', 'continent', 'itinerary_type', 'maritime_company',
    ).prefetch_related(
        'accommodation_lines__accommodation_type',
        'cities__state__country', 'countries', 'airports', 'keywords',
        'days__city', 'days__images', 'images', 'documents',
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
                           'upload_image', 'delete_image', 'set_cover',
                           'upload_document', 'delete_document'):
            return [RequirePermission('roteiros_edit')()]
        return [RequirePermission('roteiros_view', 'roteiros_edit', 'roteiros_delete')()]

    # ── Galeria de imagens (upload multipart — não cabe no PUT/JSON) ──
    @action(detail=True, methods=['post'], url_path='images')
    def upload_image(self, request, pk=None):
        """POST /api/itineraries/{id}/images/  (multipart: image, caption?, is_cover?, order?, day?).
        Se `day` (id de um ItineraryDay deste roteiro) vier, a imagem é do DIA (nunca capa)."""
        itinerary = self.get_object()
        day = None
        day_id = request.data.get('day')
        if day_id:
            day = itinerary.days.filter(pk=day_id).first()
            if day is None:
                return Response({'detail': 'Dia inválido para este roteiro.'}, status=status.HTTP_400_BAD_REQUEST)
        ser = ItineraryImageSerializer(data=request.data, context=self.get_serializer_context())
        ser.is_valid(raise_exception=True)
        with transaction.atomic():
            is_cover = bool(ser.validated_data.get('is_cover')) and day is None
            if is_cover:   # respeita uniq_cover_per_itinerary: só uma capa
                itinerary.images.filter(is_cover=True).update(is_cover=False)
            img = ser.save(itinerary=itinerary, day=day, is_cover=is_cover)
        out = ItineraryImageSerializer(img, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path=r'images/(?P<image_id>[0-9]+)/cover')
    def set_cover(self, request, pk=None, image_id=None):
        """POST /api/itineraries/{id}/images/{image_id}/cover/ — define a capa (imagem da galeria)."""
        itinerary = self.get_object()
        img = itinerary.images.filter(pk=image_id, day__isnull=True).first()
        if img is None:
            return Response({'detail': 'Imagem de galeria não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        with transaction.atomic():
            itinerary.images.filter(is_cover=True).update(is_cover=False)
            img.is_cover = True
            img.save(update_fields=['is_cover'])
        out = ItineraryImageSerializer(img, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['delete'], url_path=r'images/(?P<image_id>[0-9]+)')
    def delete_image(self, request, pk=None, image_id=None):
        """DELETE /api/itineraries/{id}/images/{image_id}/"""
        itinerary = self.get_object()
        img = itinerary.images.filter(pk=image_id).first()
        if img is None:
            return Response({'detail': 'Imagem não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        img.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Documentos (PDFs) ──
    @action(detail=True, methods=['post'], url_path='documents')
    def upload_document(self, request, pk=None):
        """POST /api/itineraries/{id}/documents/  (multipart: file, title?, order?)"""
        itinerary = self.get_object()
        ser = ItineraryDocumentSerializer(data=request.data, context=self.get_serializer_context())
        ser.is_valid(raise_exception=True)
        doc = ser.save(itinerary=itinerary)
        out = ItineraryDocumentSerializer(doc, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'documents/(?P<doc_id>[0-9]+)')
    def delete_document(self, request, pk=None, doc_id=None):
        """DELETE /api/itineraries/{id}/documents/{doc_id}/"""
        itinerary = self.get_object()
        doc = itinerary.documents.filter(pk=doc_id).first()
        if doc is None:
            return Response({'detail': 'Documento não encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        doc.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

import os
from django.http import FileResponse, Http404
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from .models import Passenger, PassengerDocument
from .serializers import PassengerSerializer, PassengerListSerializer, PassengerDocumentSerializer


class PassengerViewSet(viewsets.ModelViewSet):
    queryset = Passenger.objects.all()
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['full_name', 'email', 'cpf', 'city']
    ordering_fields = ['full_name', 'created_at', 'city']

    def get_serializer_class(self):
        if self.action == 'list':
            return PassengerListSerializer
        return PassengerSerializer

    @action(detail=False, methods=['get'])
    def active(self, request):
        qs = self.get_queryset().filter(status='active')
        return Response(PassengerListSerializer(qs, many=True).data)

    @action(detail=True, methods=['get', 'post'], url_path='documents',
            parser_classes=[MultiPartParser, FormParser])
    def documents(self, request, pk=None):
        passenger = self.get_object()
        if request.method == 'GET':
            docs = passenger.documents.all()
            return Response(PassengerDocumentSerializer(docs, many=True, context={'request': request}).data)

        serializer = PassengerDocumentSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            serializer.save(passenger=passenger)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class PassengerDocumentViewSet(viewsets.GenericViewSet):
    queryset = PassengerDocument.objects.all()
    serializer_class = PassengerDocumentSerializer
    permission_classes = [IsAuthenticated]

    def destroy(self, request, pk=None):
        try:
            doc = PassengerDocument.objects.get(pk=pk)
        except PassengerDocument.DoesNotExist:
            raise Http404
        # Remove o arquivo físico do disco
        if doc.file and os.path.isfile(doc.file.path):
            os.remove(doc.file.path)
        doc.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        try:
            doc = PassengerDocument.objects.get(pk=pk)
        except PassengerDocument.DoesNotExist:
            raise Http404
        if not doc.file or not os.path.isfile(doc.file.path):
            raise Http404
        response = FileResponse(
            open(doc.file.path, 'rb'),
            as_attachment=True,
            filename=doc.original_name,
        )
        if doc.mime_type:
            response['Content-Type'] = doc.mime_type
        return response

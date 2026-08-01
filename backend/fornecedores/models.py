from django.conf import settings
from django.db import models

from .normalize import (
    STATUS_CHOICES, CATEGORY_CHOICES, CATEGORY_LABELS,
    only_digits, normalize_airline_abbr, format_cpf, format_cnpj,
)


class Fornecedor(models.Model):
    """Cadastro de fornecedor (operadoras, receptivos, hotéis, cias aéreas,
    locadoras, etc.). Fornecedores internacionais podem não ter CPF/CNPJ.

    Soft-delete via is_deleted/deleted_at (o mixin do viewset cuida do excluir).
    Auditado automaticamente (audit/tracking.py TRACKED_MODELS['Fornecedor']).
    """
    STATUS_CHOICES = STATUS_CHOICES
    CATEGORY_CHOICES = CATEGORY_CHOICES
    PERSON_TYPE_CHOICES = [('juridica', 'Pessoa Jurídica'), ('fisica', 'Pessoa Física')]

    # Identificação
    name          = models.CharField('Nome', max_length=200, db_index=True)
    status        = models.CharField('Status', max_length=10, choices=STATUS_CHOICES,
                                      default='ativo', db_index=True)
    category      = models.CharField('Categoria', max_length=20, choices=CATEGORY_CHOICES,
                                      blank=True, default='', db_index=True)
    # Documento unificado: o tipo escolhe CPF (física) ou CNPJ (jurídica).
    person_type   = models.CharField('Tipo de pessoa', max_length=10, choices=PERSON_TYPE_CHOICES,
                                      default='juridica')
    airline_abbr  = models.CharField('Abreviatura Cia', max_length=10, blank=True, default='')

    # Localização (texto livre, como nas agências; país reaproveita o catálogo no front)
    city          = models.CharField('Cidade', max_length=120, blank=True, default='')
    country       = models.CharField('País', max_length=120, blank=True, default='')

    # Documentos (armazenados SÓ com dígitos; exibidos formatados)
    cpf           = models.CharField('CPF', max_length=11, blank=True, default='', db_index=True)
    cnpj          = models.CharField('CNPJ', max_length=14, blank=True, default='', db_index=True)
    company_name  = models.CharField('Razão Social', max_length=200, blank=True, default='')

    # Compatibilidade com o sistema antigo
    supplier_network = models.CharField('Rede Fornecedor', max_length=200, blank=True, default='')

    notes         = models.TextField('Observações', blank=True, default='')

    # Auditoria (mesmos campos das agências)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='fornecedores_created')
    created_at = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)

    # Soft-delete
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Fornecedor'
        verbose_name_plural = 'Fornecedores'
        ordering = ['name']
        indexes = [
            models.Index(fields=['status', 'category'], name='forn_status_cat_idx'),
            models.Index(fields=['name'], name='forn_name_idx'),
        ]

    def save(self, *args, **kwargs):
        # Blindagem: garante dígitos-only e abreviatura em maiúsculas mesmo em
        # gravações fora do serializer (ex.: shell, migrações de dados).
        self.cpf = only_digits(self.cpf)
        self.cnpj = only_digits(self.cnpj)
        self.airline_abbr = normalize_airline_abbr(self.airline_abbr)
        # Documento unificado: limpa o que não corresponde ao tipo de pessoa.
        if self.person_type == 'fisica':
            self.cnpj = ''
        elif self.person_type == 'juridica':
            self.cpf = ''
        super().save(*args, **kwargs)

    @property
    def cpf_display(self):
        return format_cpf(self.cpf) if self.cpf else ''

    @property
    def cnpj_display(self):
        return format_cnpj(self.cnpj) if self.cnpj else ''

    @property
    def category_label(self):
        return CATEGORY_LABELS.get(self.category, '')

    @property
    def document_display(self):
        return self.cnpj_display or self.cpf_display or ''

    def __str__(self):
        return self.name or f'Fornecedor {self.pk}'

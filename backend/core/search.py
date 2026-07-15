"""Busca insensível a ACENTO (além de caixa) para os filtros da API.

Estratégia por banco:
  • SQLite (dev)  — registramos uma função Python `unaccent()` na conexão.
  • PostgreSQL    — usa a extensão `unaccent` (ver migration UnaccentExtension).
  • MySQL/MariaDB — a collation padrão (utf8mb4_*_ci) já é accent-insensitive,
                    então o transform vira no-op.

Detalhe importante: o termo pesquisado é normalizado (sem acento) em PYTHON e
o transform `Unaccent` é aplicado só na COLUNA (não é bilateral). Assim
`unaccent()` é chamada uma única vez por campo no SQL — evitando um bug do
bridge sqlite3 do CPython quando a mesma função aparece duas vezes na cláusula.
"""
import unicodedata

from django.db.models import CharField, TextField, Transform
from django.db.backends.signals import connection_created
from django.dispatch import receiver
from rest_framework.filters import SearchFilter


def strip_accents(value):
    """'São Paulo' → 'Sao Paulo'. Usada como função SQL `unaccent` no SQLite e
    para normalizar o termo pesquisado em Python."""
    if value is None:
        return None
    return ''.join(
        ch for ch in unicodedata.normalize('NFKD', str(value))
        if unicodedata.category(ch) != 'Mn'
    )


@receiver(connection_created)
def _register_sqlite_unaccent(sender, connection, **kwargs):
    # SQLite não tem unaccent(); criamos uma função equivalente em Python para
    # que a busca ignore acento também em desenvolvimento.
    if connection.vendor == 'sqlite':
        connection.connection.create_function('unaccent', 1, strip_accents)


class Unaccent(Transform):
    """Aplica unaccent() na coluna. No MySQL/MariaDB é no-op (a collation padrão
    já ignora acento e não existe a função unaccent())."""
    function = 'unaccent'
    lookup_name = 'unaccent'

    def as_mysql(self, compiler, connection):
        return compiler.compile(self.lhs)


CharField.register_lookup(Unaccent)
TextField.register_lookup(Unaccent)


class AccentInsensitiveSearchFilter(SearchFilter):
    """SearchFilter do DRF, mas ignorando acentos além de maiúsc/minúsc.

    • O termo pesquisado é normalizado (sem acento) em Python.
    • A coluna recebe o transform __unaccent antes do lookup textual.
    Resultado: 'mexico' casa 'México' e vice-versa, sem depender do banco."""

    def get_search_terms(self, request):
        return [strip_accents(t) for t in super().get_search_terms(request)]

    def construct_search(self, field_name, queryset):
        base = super().construct_search(field_name, queryset)
        # base termina em __icontains / __istartswith / __iexact (ou é só o nome
        # do campo quando ele já traz um lookup próprio). Full-text (@) e regex
        # ($) não ganham unaccent.
        for suffix in ('__icontains', '__istartswith', '__iexact'):
            if base.endswith(suffix):
                return base[: -len(suffix)] + '__unaccent' + suffix
        return base

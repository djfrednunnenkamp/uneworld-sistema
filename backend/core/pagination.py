from rest_framework.pagination import PageNumberPagination


class StandardResultsPagination(PageNumberPagination):
    """Paginação para listagens de cadastros (passageiros, viagens, agências, reuniões, listas).

    O page_size padrão (200) é bem maior que o global (20) para não cortar
    silenciosamente listagens com mais de 20 itens; page_size_query_param
    permite ao frontend pedir páginas maiores quando necessário.
    """
    page_size = 200
    page_size_query_param = 'page_size'
    max_page_size = 5000

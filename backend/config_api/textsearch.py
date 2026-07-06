"""Normalização de texto para busca insensível a acento e caixa.

'México' / 'Mexico' / 'MÉXICO' → 'mexico'. Usado para preencher colunas
`name_ascii` (busca) e para normalizar o termo pesquisado, de modo que a busca
funcione igual com ou sem acento — em qualquer banco (SQLite/Postgres/MySQL)."""
import unicodedata


def normalize_text(s):
    if not s:
        return ''
    s = unicodedata.normalize('NFKD', str(s))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return s.casefold().strip()

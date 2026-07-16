"""Helpers de storage de mídia.

`public_media_storage` roteia os campos de mídia PÚBLICA (logos, imagens/vídeos de
roteiro, avatares, fotos de destino/passageiro, vouchers) para o storage nomeado
`public_media` — S3 em produção/HML (uploads vão DIRETO pro bucket, não ficam no
disco do servidor), ou o filesystem local quando o S3 não está configurado (dev).

Documentos SENSÍVEIS (docs de passageiro/roteiro, contratos assinados, comprovantes,
arquivos do Drive, assinatura do CEO) NÃO usam este helper: continuam no storage
`default` (local) e só saem por views autenticadas com FileResponse. Ver core/urls.py
(A-11) e as views de download em passengers/itineraries/contracts/drive/config_api.

Passado como `storage=public_media_storage` nos FileField/ImageField públicos. Django
resolve o callable em runtime (via STORAGES['public_media']) e o deconstruct grava só
a referência da função — então trocar bucket/prefixo por ambiente NÃO gera migration.
"""
from django.core.files.storage import storages


def public_media_storage():
    return storages['public_media']

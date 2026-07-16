"""Envia a mídia PÚBLICA existente (disco local) para o S3 (storage `public_media`).

Uso único na migração pro S3: percorre o MEDIA_ROOT e sobe os arquivos dos prefixos
PÚBLICOS (logos, imagens/vídeos de roteiro, avatares, fotos, vouchers, etc.),
preservando o caminho relativo — que vira a CHAVE no bucket (com o prefixo do
storage). Assim as URLs geradas pelos serializers passam a resolver no S3.

NÃO sobe nada SENSÍVEL: passenger_docs/, contracts/, drive/, operating/ (assinatura
do CEO) e itineraries/docs/ ficam de fora (continuam locais + views autenticadas).

    python manage.py sync_public_media_to_s3            # não sobrescreve o que já existe
    python manage.py sync_public_media_to_s3 --overwrite
    python manage.py sync_public_media_to_s3 --dry-run
"""
import os

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.core.management.base import BaseCommand, CommandError

# Prefixos (pastas de topo no MEDIA_ROOT) que são PÚBLICOS.
PUBLIC_DIRS = [
    'agencies', 'airlines', 'branding', 'avatars', 'passengers',
    'vouchers', 'destinations', 'hotels', 'boats', 'itineraries',
]
# Sub-caminhos SENSÍVEIS que NÃO podem ir pro bucket público (ficam dentro de
# 'itineraries/' mas são documentos autenticados).
EXCLUDE_PREFIXES = ('itineraries/docs/',)


class Command(BaseCommand):
    help = 'Envia a mídia pública do disco local para o S3 (storage public_media).'

    def add_arguments(self, parser):
        parser.add_argument('--overwrite', action='store_true',
                            help='Sobrescreve objetos que já existem no S3.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Apenas lista o que seria enviado, sem enviar.')

    def handle(self, *args, **opts):
        if not getattr(settings, '_USE_S3_PUBLIC', False):
            raise CommandError(
                'S3 público não configurado (S3_BUCKET/AWS_ACCESS_KEY_ID vazios). '
                'O storage public_media está no filesystem — nada a enviar.'
            )

        media_root = str(settings.MEDIA_ROOT)
        storage = storages['public_media']
        overwrite = opts['overwrite']
        dry = opts['dry_run']

        sent = skipped = 0
        for top in PUBLIC_DIRS:
            base = os.path.join(media_root, top)
            if not os.path.isdir(base):
                continue
            for root, _dirs, files in os.walk(base):
                for fn in files:
                    abspath = os.path.join(root, fn)
                    rel = os.path.relpath(abspath, media_root).replace(os.sep, '/')
                    if rel.startswith(EXCLUDE_PREFIXES):
                        continue
                    if not overwrite and storage.exists(rel):
                        skipped += 1
                        continue
                    if dry:
                        self.stdout.write(f'[dry] {rel}')
                        sent += 1
                        continue
                    if overwrite and storage.exists(rel):
                        storage.delete(rel)
                    with open(abspath, 'rb') as f:
                        storage.save(rel, ContentFile(f.read()))
                    self.stdout.write(f'enviado: {rel}')
                    sent += 1

        self.stdout.write(self.style.SUCCESS(
            f'Concluído. Enviados: {sent} | Ignorados (já existiam): {skipped}'
        ))

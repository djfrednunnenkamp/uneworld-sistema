import os
import shutil
import tarfile
import tempfile

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

DOWNLOAD_URL = 'https://download.maxmind.com/geoip/databases/GeoLite2-City/download'


class Command(BaseCommand):
    help = 'Baixa/atualiza o banco GeoLite2-City.mmdb usado para localizar logins pelo IP.'

    def handle(self, *args, **options):
        account_id = os.environ.get('MAXMIND_ACCOUNT_ID') or getattr(settings, 'MAXMIND_ACCOUNT_ID', '')
        license_key = os.environ.get('MAXMIND_LICENSE_KEY') or getattr(settings, 'MAXMIND_LICENSE_KEY', '')
        if not account_id or not license_key:
            raise CommandError('MAXMIND_ACCOUNT_ID / MAXMIND_LICENSE_KEY não configurados no .env.')

        self.stdout.write('Baixando GeoLite2-City da MaxMind...')
        r = requests.get(DOWNLOAD_URL, params={'suffix': 'tar.gz'}, auth=(account_id, license_key), timeout=60)
        if r.status_code != 200:
            raise CommandError(f'Falha ao baixar o banco (HTTP {r.status_code}): {r.text[:300]}')

        with tempfile.TemporaryDirectory() as tmp:
            archive_path = os.path.join(tmp, 'geolite2city.tar.gz')
            with open(archive_path, 'wb') as f:
                f.write(r.content)
            with tarfile.open(archive_path) as tar:
                tar.extractall(tmp)
                mmdb_member = next(m for m in tar.getmembers() if m.name.endswith('GeoLite2-City.mmdb'))

            dest_dir = os.path.join(settings.BASE_DIR, 'geoip_db')
            os.makedirs(dest_dir, exist_ok=True)
            dest_path = os.path.join(dest_dir, 'GeoLite2-City.mmdb')
            shutil.move(os.path.join(tmp, mmdb_member.name), dest_path)

        self.stdout.write(self.style.SUCCESS(f'GeoLite2-City.mmdb atualizado em {dest_path}'))

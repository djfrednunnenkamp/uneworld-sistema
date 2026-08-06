"""Converte o ACERVO ANTIGO de imagens para WebP — sob demanda, nunca sozinho.

Uploads novos já saem em WebP pelo pipeline central (core/images.py). Este
comando é para quem quiser padronizar o que já está no S3. Ele é:

  - OPT-IN: nada acontece sem alguém rodar;
  - SECO por padrão: sem `--aplicar` ele só mostra o que faria;
  - IDEMPOTENTE: pula o que já é .webp, então rodar duas vezes não muda nada;
  - NÃO DESTRUTIVO na ordem: grava o novo arquivo, atualiza a referência e só
    então remove o antigo (`--apagar-antigos`, que é opt-in dentro do opt-in).

Uso:
    python manage.py converter_imagens_webp                    # simulação
    python manage.py converter_imagens_webp --aplicar
    python manage.py converter_imagens_webp --aplicar --modelo passengers.Passenger
    python manage.py converter_imagens_webp --aplicar --apagar-antigos --limite 500
"""
import io

from django.apps import apps
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import models

from core import images as imgsvc

#: Campos de IMAGEM do sistema. Documentos, vídeos e anexos livres ficam de
#: fora de propósito — este comando só toca em imagem.
CAMPOS = [
    ('passengers.Passenger',            ['photo']),
    ('trips.Destination',               ['image']),
    ('agencies.Agency',                 ['logo', 'logo_original']),
    ('users_api.UserPermissions',       ['avatar', 'avatar_original']),
    ('config_api.Airline',              ['logo']),
    ('config_api.SystemSettings',       ['logo_system', 'logo_sidebar', 'logo_topbar',
                                         'logo_login', 'favicon', 'logo_site', 'logo_pdf',
                                         'logo_contract', 'logo_voucher', 'logo_list']),
    ('vouchers.VoucherFlightConfirmation', ['image']),
    ('itineraries.ItineraryMapPoint',   ['image']),
    # ItineraryImage e as mídias de hotel/barco guardam imagem OU vídeo no mesmo
    # campo — só entram as linhas marcadas como imagem (ver `_e_video`).
    ('itineraries.ItineraryImage',      ['image']),
    ('config_api.ConfigHotelMedia',     ['file']),
    ('config_api.ConfigBoatMedia',      ['file']),
]


def _e_video(obj, campo):
    """A linha é vídeo? (campos que aceitam os dois)"""
    kind = getattr(obj, 'kind', None)
    if kind == 'video':
        return True
    nome = (getattr(obj, campo).name or '').lower()
    from passengers.validators import GALLERY_VIDEO_EXTENSIONS
    return any(nome.endswith(ext) for ext in GALLERY_VIDEO_EXTENSIONS)


class Command(BaseCommand):
    help = 'Converte imagens antigas para WebP (simulação por padrão; use --aplicar).'

    def add_arguments(self, parser):
        parser.add_argument('--aplicar', action='store_true',
                            help='Grava de verdade (sem isto, só mostra o que faria).')
        parser.add_argument('--apagar-antigos', action='store_true',
                            help='Remove o arquivo original do storage DEPOIS de gravar o novo.')
        parser.add_argument('--modelo', default='',
                            help='Restringe a um modelo (ex.: passengers.Passenger).')
        parser.add_argument('--limite', type=int, default=0,
                            help='Converte no máximo N imagens (0 = sem limite).')

    def handle(self, *args, **opts):
        aplicar = opts['aplicar']
        apagar  = opts['apagar_antigos']
        alvo    = (opts['modelo'] or '').strip().lower()
        limite  = opts['limite']

        if not aplicar:
            self.stdout.write(self.style.WARNING(
                'SIMULAÇÃO — nada será gravado. Use --aplicar para valer.\n'))

        convertidas = puladas = falhas = 0
        for rotulo, campos in CAMPOS:
            if alvo and alvo != rotulo.lower():
                continue
            try:
                Model = apps.get_model(rotulo)
            except LookupError:
                raise CommandError(f'Modelo não encontrado: {rotulo}')

            for campo in campos:
                filtro = models.Q(**{f'{campo}__isnull': False}) & ~models.Q(**{campo: ''})
                for obj in Model.objects.filter(filtro).iterator(chunk_size=200):
                    if limite and convertidas >= limite:
                        self.stdout.write(self.style.WARNING(
                            f'\nLimite de {limite} atingido — o restante ficou de fora.'))
                        return self._resumo(convertidas, puladas, falhas, aplicar)
                    ff = getattr(obj, campo)
                    nome = ff.name or ''
                    if not nome:
                        continue
                    if nome.lower().endswith('.webp'):
                        puladas += 1                     # idempotência
                        continue
                    if _e_video(obj, campo):
                        puladas += 1                     # vídeo não é assunto daqui
                        continue
                    try:
                        with ff.open('rb') as fh:
                            bruto = fh.read()
                    except Exception as e:
                        falhas += 1
                        self.stderr.write(f'  ! {rotulo}#{obj.pk}.{campo}: não abriu ({e})')
                        continue

                    if not aplicar:
                        convertidas += 1
                        self.stdout.write(f'  · {rotulo}#{obj.pk}.{campo}: {nome} → .webp')
                        continue

                    try:
                        processada = imgsvc.process_image(_ArquivoEmMemoria(bruto, nome))
                    except ValidationError as e:
                        falhas += 1
                        self.stderr.write(f'  ! {rotulo}#{obj.pk}.{campo}: {e.messages[0]}')
                        continue

                    try:
                        # ORDEM SEGURA: grava a nova + persiste a referência…
                        ff.save(processada.name, processada.content, save=True)
                    except Exception as e:
                        falhas += 1
                        self.stderr.write(f'  ! {rotulo}#{obj.pk}.{campo}: falha ao gravar ({e})')
                        continue
                    # …e só então (opcionalmente) descarta a antiga.
                    if apagar and nome != ff.name:
                        try:
                            ff.storage.delete(nome)
                        except Exception as e:
                            self.stderr.write(f'  ~ {rotulo}#{obj.pk}.{campo}: antiga mantida ({e})')
                    convertidas += 1
                    self.stdout.write(f'  ✔ {rotulo}#{obj.pk}.{campo}: {nome} → {ff.name}')

        return self._resumo(convertidas, puladas, falhas, aplicar)

    def _resumo(self, convertidas, puladas, falhas, aplicar):
        verbo = 'convertidas' if aplicar else 'a converter'
        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(f'{convertidas} {verbo}'))
        self.stdout.write(f'{puladas} puladas (já WebP ou vídeo)')
        if falhas:
            self.stdout.write(self.style.ERROR(f'{falhas} com falha (nada foi alterado nelas)'))


class _ArquivoEmMemoria(io.BytesIO):
    """Bytes com `.name`/`.size`, que é o que o pipeline espera de um upload."""

    def __init__(self, data, name):
        super().__init__(data)
        self.name = name
        self.size = len(data)

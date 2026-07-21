"""Monta os dados de um voucher de lista: blocos resolvidos, dados do roteiro
(dia a dia + o que inclui) e a lista de vouchers por passageiro/casal.

Regra do casal: 1 voucher por QUARTO de casal. O quarto é de casal quando o tipo
de acomodação (catálogo ConfigAccommodation, casado por prefixo do nome) tem
is_couple=True. Passageiros no mesmo quarto de casal → 1 voucher (1 ou 2 pessoas).
Os demais → 1 voucher por passageiro.
"""


def _find_accom_type(types, room_name):
    """Casa o nome do quarto com o tipo de acomodação por PREFIXO (nome mais longo
    primeiro), igual ao findAccomType do front."""
    if not room_name:
        return None
    for t in sorted(types, key=lambda a: -len(a.name or '')):
        n = t.name or ''
        if n and (room_name == n or room_name.startswith(n + ' ')):
            return t
    return None


def default_template_blocks():
    """Blocos do template PADRÃO (favorito) da biblioteca, senão o padrão de fábrica."""
    from .models import VoucherTemplate, DEFAULT_VOUCHER_BLOCKS
    t = VoucherTemplate.objects.filter(is_default=True).first()
    if t and isinstance(t.blocks, list) and t.blocks:
        return t.blocks
    return DEFAULT_VOUCHER_BLOCKS


def resolve_blocks(voucher, settings_obj=None):
    """Blocos efetivos: os PRÓPRIOS da lista, senão o template padrão da biblioteca."""
    if isinstance(voucher.blocks, list) and voucher.blocks:
        return voucher.blocks, True
    return default_template_blocks(), False


# Campos de "Informações" do roteiro que podem virar bloco (chave → rótulo).
INFO_FIELDS = [
    ('info_general', 'Informações'), ('info_included', 'Incluso no Pacote'),
    ('info_not_included', 'Não Incluso no Pacote'), ('info_optionals', 'Opcionais'),
    ('info_tips', 'Dicas de Viagem'), ('info_documents', 'Documentos Necessários'),
    ('info_promo_rules', 'Regras Promoção'), ('info_insurance', 'Seguros'),
    ('info_values', 'Informações sobre Valores'), ('info_extras', 'Extras'),
    ('info_lamina', 'Texto informativo da lâmina'),
    ('flight_notes', 'Observações dos Voos'), ('hotel_notes', 'Observações dos Hotéis'),
    ('accommodation_notes', 'Observações dos Valores'),
    ('terrestre_notes', 'Observações do Terrestre'), ('boat_notes', 'Observações do Barco'),
]


def _dt(v):
    try: return v.strftime('%d/%m/%Y %H:%M') if v else ''
    except Exception: return ''


def _d(v):
    try: return v.strftime('%d/%m/%Y') if v else ''
    except Exception: return ''


def _airport(a):
    if not a: return ''
    code = getattr(a, 'iata_code', '') or ''
    return f'{code} · {a.name}'.strip(' ·') if getattr(a, 'name', '') else code


def _map_url(raw):
    """Extrai o src do embed do Google My Maps (ou devolve o próprio link)."""
    if not raw: return ''
    import re
    m = re.search(r'src="([^"]+)"', raw)
    return m.group(1) if m else raw.strip()


def roteiro_data(passenger_list, request=None):
    """Dados do PRIMEIRO roteiro da lista para alimentar os blocos do voucher:
    dia a dia, voos, terrestre, hotéis, barco, destinos, campos de informações,
    mapa e imagens. Tudo se alimenta do roteiro."""
    itin = passenger_list.roteiros.first()
    if not itin:
        return None

    def abs_url(f):
        try:
            return (request.build_absolute_uri(f.url) if request else f.url) if f else None
        except Exception:
            return None

    days = [{'day_number': d.day_number, 'title': d.title, 'description': d.description}
            for d in itin.days.all()]
    incl = [i.name for i in itin.inclusions.all()]

    flights = []
    for dep in itin.departures.all():
        for f in dep.flights.select_related('airline', 'origin', 'destination').all():
            flights.append({'airline': getattr(f.airline, 'name', '') or '', 'number': f.flight_number or '',
                            'origin': _airport(f.origin), 'destination': _airport(f.destination),
                            'departs': _dt(f.departs_at), 'arrives': _dt(f.arrives_at)})

    terrestre = []
    for dep in itin.terrestre_departures.all():
        for l in dep.legs.select_related('company', 'origin', 'destination').all():
            terrestre.append({'company': getattr(l.company, 'name', '') or '', 'number': l.service_number or '',
                              'origin': getattr(l.origin, 'name', '') or '', 'destination': getattr(l.destination, 'name', '') or '',
                              'departs': _dt(l.departs_at), 'arrives': _dt(l.arrives_at)})

    hotels = [{'name': h.name or getattr(h.config_hotel, 'name', '') or '', 'city': h.city or '',
               'check_in': _d(h.check_in), 'check_out': _d(h.check_out), 'notes': h.notes or ''}
              for h in itin.hotels.select_related('config_hotel').all()]
    boats = [{'name': b.name or getattr(b.config_boat, 'name', '') or '',
              'check_in': _d(b.check_in), 'check_out': _d(b.check_out), 'notes': b.notes or ''}
             for b in itin.boats.select_related('config_boat').all()]

    cities = []
    for c in itin.cities.select_related('state__country__continent').all():
        st = getattr(c, 'state', None); co = getattr(st, 'country', None); cont = getattr(co, 'continent', None)
        cities.append({'name': c.name, 'state': getattr(st, 'name', '') or '',
                       'country': getattr(co, 'name', '') or '', 'continent': getattr(cont, 'name', '') or ''})

    images = [{'url': abs_url(im.image), 'caption': im.caption or ''}
              for im in itin.images.filter(day__isnull=True).order_by('order', 'id') if im.image]

    return {
        'name': itin.name,
        'days': days,
        'inclusions': incl,
        'info_included': getattr(itin, 'info_included', '') or '',
        'info_not_included': getattr(itin, 'info_not_included', '') or '',
        'flights': flights,
        'terrestre': terrestre,
        'hotels': hotels,
        'boats': boats,
        'cities': cities,
        'info': {k: (getattr(itin, k, '') or '') for k, _ in INFO_FIELDS},
        'map_url': _map_url(getattr(itin, 'map_embed_url', '') or ''),
        'images': images,
    }


def _agency_of(enrollment, request):
    """(nome, logo_url) da agência do voucher: a agência sob a qual o passageiro está
    INSCRITO nesta lista (ListEnrollment.agency) e, se não houver, a 1ª agência do
    passageiro. A logo entra no topo do voucher."""
    ag = getattr(enrollment, 'agency', None) or enrollment.passenger.agencies.first()
    if not ag:
        return (None, None)
    name = ag.display_name
    url = None
    if ag.logo:
        url = request.build_absolute_uri(ag.logo.url) if request else ag.logo.url
    return (name, url)


def build_entries(passenger_list, request=None, voucher=None, agency_ids=None):
    """Lista de vouchers (por passageiro/casal) da lista. Cada voucher leva a logo
    da agência do passageiro (do casal, a do 1º) e, se houver, a URL da captura de
    tela da confirmação do voo (que no PDF vira uma página própria ao final).

    `agency_ids` (usuário de agência): restringe aos passageiros registrados sob
    uma dessas agências NESTA lista — a agência só vê os passageiros dela."""
    from config_api.models import ConfigAccommodation
    from trips.models import ListEnrollment

    # entry_key -> [ {id, url, title}, ... ] das confirmações de voo (ordenadas).
    # Vários comprovantes por voucher; cada um vira uma página própria no PDF.
    fc_map = {}
    dl_map = {}   # entry_key -> downloaded_at (ISO) — quando a agência baixou
    if voucher is not None:
        for fc in voucher.flight_confirmations.all().order_by('order', 'id'):
            if not fc.image:
                continue
            try:
                url = request.build_absolute_uri(fc.image.url) if request else fc.image.url
            except Exception:
                url = None
            fc_map.setdefault(fc.entry_key, []).append({'id': fc.id, 'url': url, 'title': fc.title or ''})
        def _user_card(u):
            if not u:
                return {'name': 'Usuário', 'email': '', 'avatar': None}
            avatar = None
            perms = getattr(u, 'permissions', None)
            if perms and getattr(perms, 'avatar', None):
                try:
                    avatar = request.build_absolute_uri(perms.avatar.url) if request else perms.avatar.url
                except Exception:
                    avatar = None
            return {'name': (u.get_full_name() or u.get_username()), 'email': u.email or '', 'avatar': avatar}

        for d in voucher.downloads.select_related('user', 'user__permissions').all():
            dl_map.setdefault(d.entry_key, []).append({
                **_user_card(d.user),
                'at': d.downloaded_at.isoformat() if d.downloaded_at else None,
                'count': d.count,
            })
        # Mais recente primeiro (a query já ordena por -downloaded_at).

    # Tipos de acomodação RESOLVIDOS do roteiro da lista: os exclusivos do roteiro
    # se existirem, senão os globais (mesma regra "substituir" dos seletores) —
    # assim o casal/single é detectado com os tipos que o roteiro realmente usa.
    _rot_ids = list(passenger_list.roteiros.values_list('id', flat=True))
    _scoped = ConfigAccommodation.objects.filter(itinerary_id__in=_rot_ids) if _rot_ids else ConfigAccommodation.objects.none()
    types = list(_scoped) if _scoped.exists() else list(ConfigAccommodation.objects.filter(itinerary__isnull=True))
    ens = (ListEnrollment.objects
           .filter(passenger_list=passenger_list, passenger__isnull=False)
           .select_related('passenger', 'agency')
           .prefetch_related('passenger__agencies')
           .order_by('order_in_list', 'id'))
    if agency_ids is not None:
        ens = ens.filter(agency_id__in=agency_ids)

    def is_couple(accom):
        t = _find_accom_type(types, accom)
        return bool(t and t.is_couple)

    couple_rooms = {}   # accom_name -> [enrollment,...]
    singles = []
    accom_members = {}  # accom_name -> [(passenger_id, full_name),...] p/ "A compartilhar com"
    for en in ens:
        accom = (en.accommodation or '').strip()
        if accom:
            accom_members.setdefault(accom, []).append((en.passenger_id, en.passenger.full_name))
        if accom and is_couple(accom):
            couple_rooms.setdefault(accom, []).append(en)
        else:
            singles.append(en)

    # Outros passageiros do MESMO quarto (mesma acomodação), fora os do próprio voucher.
    def roommates_of(accom, own_ids):
        return [name for pid, name in accom_members.get((accom or '').strip(), []) if pid not in own_ids]

    entries = []
    for accom, group in couple_rooms.items():
        ag_name, ag_logo = _agency_of(group[0], request)
        key = f'room:{accom}'
        entries.append({
            'key': key,
            'is_couple': True,
            'accommodation': accom,
            'passengers': [e.passenger.full_name for e in group],
            'passenger_ids': [e.passenger_id for e in group],
            'passenger_genders': [getattr(e.passenger, 'gender', '') or '' for e in group],
            'roommates': roommates_of(accom, {e.passenger_id for e in group}),
            'agency_name': ag_name,
            'agency_logo': ag_logo,
            'flight_confirmations': fc_map.get(key, []),
            # Compat: 1ª imagem (badge "tem voo" / visualização simples em outras telas).
            'flight_confirmation': (fc_map.get(key) or [{}])[0].get('url'),
            'downloaded': bool(dl_map.get(key)),
            'downloads': dl_map.get(key, []),
            'download_count': sum(d['count'] for d in dl_map.get(key, [])),
            'downloaded_at': (dl_map.get(key) or [{}])[0].get('at'),
            'downloaded_by': (dl_map.get(key) or [{}])[0].get('name'),
        })
    for en in singles:
        ag_name, ag_logo = _agency_of(en, request)
        key = f'pax:{en.id}'
        entries.append({
            'key': key,
            'is_couple': False,
            'accommodation': en.accommodation or '',
            'passengers': [en.passenger.full_name],
            'passenger_ids': [en.passenger_id],
            'passenger_genders': [getattr(en.passenger, 'gender', '') or ''],
            'roommates': roommates_of(en.accommodation, {en.passenger_id}),
            'agency_name': ag_name,
            'agency_logo': ag_logo,
            'flight_confirmations': fc_map.get(key, []),
            # Compat: 1ª imagem (badge "tem voo" / visualização simples em outras telas).
            'flight_confirmation': (fc_map.get(key) or [{}])[0].get('url'),
            'downloaded': bool(dl_map.get(key)),
            'downloads': dl_map.get(key, []),
            'download_count': sum(d['count'] for d in dl_map.get(key, [])),
            'downloaded_at': (dl_map.get(key) or [{}])[0].get('at'),
            'downloaded_by': (dl_map.get(key) or [{}])[0].get('name'),
        })
    return entries

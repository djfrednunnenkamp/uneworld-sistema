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


def roteiro_data(passenger_list):
    """Dia a dia + o que inclui do PRIMEIRO roteiro ligado à lista (se houver)."""
    itin = passenger_list.roteiros.first()
    if not itin:
        return None
    days = [{'day_number': d.day_number, 'title': d.title, 'description': d.description}
            for d in itin.days.all()]
    incl = [i.name for i in itin.inclusions.all()] if hasattr(itin, 'inclusions') else []
    return {
        'name': itin.name,
        'days': days,
        'inclusions': incl,
        'info_included': getattr(itin, 'info_included', '') or '',
        'info_not_included': getattr(itin, 'info_not_included', '') or '',
    }


def _agency_of(passenger, request):
    """(nome, logo_url) da 1ª agência do passageiro (a logo entra no topo do voucher)."""
    ag = passenger.agencies.first()
    if not ag:
        return (None, None)
    name = ag.name or ag.company_name or ''
    url = None
    if ag.logo:
        url = request.build_absolute_uri(ag.logo.url) if request else ag.logo.url
    return (name, url)


def build_entries(passenger_list, request=None):
    """Lista de vouchers (por passageiro/casal) da lista. Cada voucher leva a logo
    da agência do passageiro (do casal, a do 1º)."""
    from config_api.models import ConfigAccommodation
    from trips.models import ListEnrollment

    types = list(ConfigAccommodation.objects.all())
    ens = (ListEnrollment.objects
           .filter(passenger_list=passenger_list, passenger__isnull=False)
           .select_related('passenger')
           .prefetch_related('passenger__agencies')
           .order_by('order_in_list', 'id'))

    def is_couple(accom):
        t = _find_accom_type(types, accom)
        return bool(t and t.is_couple)

    couple_rooms = {}   # accom_name -> [enrollment,...]
    singles = []
    for en in ens:
        accom = (en.accommodation or '').strip()
        if accom and is_couple(accom):
            couple_rooms.setdefault(accom, []).append(en)
        else:
            singles.append(en)

    entries = []
    for accom, group in couple_rooms.items():
        ag_name, ag_logo = _agency_of(group[0].passenger, request)
        entries.append({
            'key': f'room:{accom}',
            'is_couple': True,
            'accommodation': accom,
            'passengers': [e.passenger.full_name for e in group],
            'passenger_ids': [e.passenger_id for e in group],
            'agency_name': ag_name,
            'agency_logo': ag_logo,
        })
    for en in singles:
        ag_name, ag_logo = _agency_of(en.passenger, request)
        entries.append({
            'key': f'pax:{en.id}',
            'is_couple': False,
            'accommodation': en.accommodation or '',
            'passengers': [en.passenger.full_name],
            'passenger_ids': [en.passenger_id],
            'agency_name': ag_name,
            'agency_logo': ag_logo,
        })
    return entries

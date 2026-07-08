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


def resolve_blocks(voucher, settings_obj):
    """Blocos efetivos: os da lista, senão o template global, senão o padrão."""
    from .models import DEFAULT_VOUCHER_BLOCKS
    if isinstance(voucher.blocks, list) and voucher.blocks:
        return voucher.blocks, True
    tpl = getattr(settings_obj, 'voucher_template', None)
    if isinstance(tpl, list) and tpl:
        return tpl, False
    return DEFAULT_VOUCHER_BLOCKS, False


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


def build_entries(passenger_list):
    """Lista de vouchers (por passageiro/casal) da lista."""
    from config_api.models import ConfigAccommodation
    from trips.models import ListEnrollment

    types = list(ConfigAccommodation.objects.all())
    ens = (ListEnrollment.objects
           .filter(passenger_list=passenger_list, passenger__isnull=False)
           .select_related('passenger')
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
        entries.append({
            'key': f'room:{accom}',
            'is_couple': True,
            'accommodation': accom,
            'passengers': [e.passenger.full_name for e in group],
            'passenger_ids': [e.passenger_id for e in group],
        })
    for en in singles:
        entries.append({
            'key': f'pax:{en.id}',
            'is_couple': False,
            'accommodation': en.accommodation or '',
            'passengers': [en.passenger.full_name],
            'passenger_ids': [en.passenger_id],
        })
    return entries

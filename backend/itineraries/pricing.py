"""
Motor de precificação do roteiro (aba "Valores") — FONTE DA VERDADE.

Tudo em Decimal. Converte moedas para a moeda base, aplica taxas/IOF, rateia
custos de grupo, soma custos por pessoa, monta o custo por saída e por
acomodação, aplica margem/markup e arredondamento, e gera a memória de cálculo,
o resumo por categoria, o simulador por quantidade e o ponto de equilíbrio.

Nenhum valor consolidado vem do frontend — ele manda os dados-base e aqui a
gente recalcula.
"""
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

Q2 = Decimal('0.01')
ZERO = Decimal('0')


def D(v):
    """Decimal seguro (nunca float, nunca NaN/Infinity)."""
    if v is None or v == '':
        return ZERO
    try:
        d = v if isinstance(v, Decimal) else Decimal(str(v))
    except (InvalidOperation, ValueError, TypeError):
        return ZERO
    if not d.is_finite():
        return ZERO
    return d


def q2(v):
    """Arredonda para 2 casas (exibição)."""
    return D(v).quantize(Q2, rounding=ROUND_HALF_UP)


def _apply_rounding(value, mode, custom):
    """Arredondamento do PREÇO FINAL conforme a config."""
    v = D(value)
    if mode == 'none':
        return v
    if mode == 'int':
        step = Decimal('1')
    elif mode == 'm5':
        step = Decimal('5')
    elif mode == 'm10':
        step = Decimal('10')
    elif mode == 'm50':
        step = Decimal('50')
    elif mode == 'm100':
        step = Decimal('100')
    elif mode == 'custom':
        step = D(custom)
    else:
        return v
    if step <= 0:
        return v
    # arredonda para o múltiplo mais próximo (meio pra cima)
    return (v / step).quantize(Decimal('1'), rounding=ROUND_HALF_UP) * step


def _rate_map(itinerary):
    return {cr.currency: D(cr.rate) for cr in itinerary.currency_rates.all()}


def _rate_of(currency, base_cur, rates):
    """(taxa, tem_cotacao). Base ou vazio → 1. Moeda sem cotação → 1 + flag False."""
    if not currency or currency == base_cur:
        return Decimal('1'), True
    r = rates.get(currency)
    if r is None or r <= 0:
        return Decimal('1'), False
    return r, True


def _item_calc(item, base_cur, rates):
    """Calcula, para um item de custo:
      - supplier_amount (moeda do item): valor bruto conforme a base do preço
      - final_item / final_base: com taxas + IOF, na moeda do item e na base
      - per_person_base: custo POR PESSOA na moeda base (pra 'per_person') ou o
        total do grupo na base (pra 'group', dividido depois no rateio)
      - memory: linhas explicando o cálculo
    """
    cur = item.currency or base_cur
    unit = D(item.unit_value)
    qty = D(item.quantity) or Decimal('1')
    nights = Decimal(item.nights or 1)

    # Valor bruto do fornecedor conforme a base do preço.
    if item.basis in ('per_person_night', 'per_room_night'):
        supplier = unit * nights * qty
    else:  # per_person, per_room, block_total
        supplier = unit * qty

    # Taxa única: percentual (sobre o valor do item) ou valor fixo (na moeda do item).
    tax_val = D(item.tax_value)
    if item.tax_kind == 'fixed':
        tax = tax_val
    else:
        tax = supplier * tax_val / Decimal('100')
    final_item = supplier + tax

    rate, has_rate = _rate_of(cur, base_cur, rates)
    final_base = final_item * rate

    # Total do item na base vira "por pessoa" conforme a base do preço.
    occ = Decimal(item.occupancy or 1) or Decimal('1')
    if item.cost_type == 'group':
        # grupo: final_base é o total do grupo; o rateio acontece fora.
        per_person = None
        group_total = final_base
    else:
        group_total = None
        if item.basis in ('per_room', 'per_room_night'):
            per_person = final_base / occ
        else:  # per_person, per_person_night, block_total (block dividido na consolidação)
            per_person = final_base

    memory = []
    sign = f'{cur} ' if cur != base_cur else ''
    memory.append(f'Valor bruto: {sign}{q2(supplier)}')
    if tax:
        label = f'Taxa fixa: {sign}{q2(tax)}' if item.tax_kind == 'fixed' else f'Taxa ({q2(tax_val)}%): {sign}{q2(tax)}'
        memory.append(label)
    memory.append(f'Custo final: {sign}{q2(final_item)}')
    if cur != base_cur:
        memory.append(f'Convertido ({cur}→{base_cur} × {q2(rate)}): {base_cur} {q2(final_base)}')
    if item.cost_type == 'group':
        memory.append('Tipo: custo do grupo (rateado na consolidação)')
    else:
        if item.basis in ('per_room', 'per_room_night'):
            memory.append(f'Ocupação {occ} → custo por pessoa: {base_cur} {q2(per_person)}')
        else:
            memory.append(f'Custo por pessoa: {base_cur} {q2(per_person)}')

    return {
        'supplier': supplier, 'final_item': final_item, 'final_base': final_base,
        'per_person': per_person, 'group_total': group_total,
        'has_rate': has_rate, 'currency': cur, 'memory': memory,
    }


def _group_divisor(item, cfg, base_pax, dep_pax):
    """Divisor do rateio de um custo de grupo."""
    if item.rateio_rule == 'custom':
        return D(item.rateio_qty) or Decimal('1')
    if item.rateio_rule == 'departure':
        d = item.flight_departure_id or item.terrestre_departure_id
        return D(dep_pax.get(d)) or D(base_pax) or Decimal('1')
    if item.rateio_rule == 'none':
        return Decimal('1')
    # 'base' e 'accommodation' caem na quantidade-base (accommodation fino fica p/ evolução)
    return D(base_pax) or Decimal('1')


def compute(itinerary, pax=None):
    """Cálculo consolidado. `pax` sobrescreve a quantidade-base (simulação)."""
    from .models import ItineraryPricingConfig
    cfg = getattr(itinerary, 'pricing', None)
    if cfg is None:
        cfg = ItineraryPricingConfig.objects.create(itinerary=itinerary)

    base_cur = itinerary.base_currency or 'USD'
    rates = _rate_map(itinerary)
    base_pax = int(pax) if pax else int(cfg.base_pax or 1)
    if base_pax < 1:
        base_pax = 1

    departures = list(itinerary.departures.all()) + list(itinerary.terrestre_departures.all())
    dep_pax = {}
    for d in departures:
        dep_pax[d.id] = d.expected_pax
    # também os accommodation_lines (hospedagem por acomodação) já existentes
    accom_lines = list(itinerary.accommodation_lines.select_related('accommodation_type').all())

    items = [i for i in itinerary.cost_items.select_related('accommodation_type').all()
             if i.is_active and i.included_in_price]

    warnings = []
    items_out = []
    common_pp = ZERO           # custo comum por pessoa (itens sem saída/acomodação)
    dep_extra = {}             # id da saída -> custo por pessoa extra
    accom_extra = {}           # id do tipo de acomodação -> custo por pessoa extra
    cat_totals = {}            # categoria -> total base (por pessoa × base_pax aprox p/ resumo)

    for it in items:
        calc = _item_calc(it, base_cur, rates)
        if not calc['has_rate']:
            warnings.append(f'Item "{it.description}" está em {calc["currency"]} sem cotação no roteiro.')
        # custo por pessoa deste item
        if it.cost_type == 'group':
            divisor = _group_divisor(it, cfg, base_pax, dep_pax)
            if divisor <= 0:
                warnings.append(f'Custo de grupo "{it.description}" com divisor inválido.')
                pp = ZERO
            else:
                pp = calc['group_total'] / divisor
        else:
            pp = calc['per_person'] if calc['per_person'] is not None else ZERO
            if it.basis == 'block_total':
                pp = calc['final_base'] / D(base_pax)

        scope_dep = it.flight_departure_id or it.terrestre_departure_id
        scope_accom = it.accommodation_type_id
        if scope_dep:
            dep_extra[scope_dep] = dep_extra.get(scope_dep, ZERO) + pp
        elif scope_accom:
            accom_extra[scope_accom] = accom_extra.get(scope_accom, ZERO) + pp
        else:
            common_pp += pp

        cat_totals[it.category] = cat_totals.get(it.category, ZERO) + pp
        items_out.append({
            'id': it.id, 'description': it.description, 'category': it.category,
            'cost_type': it.cost_type, 'per_person': q2(pp), 'memory': calc['memory'],
        })

    # Hospedagem legada (accommodation_lines): valor por pessoa + taxas, na base.
    accom_pp_by_type = {}   # (type_id, dep_id) -> valor por pessoa
    for l in accom_lines:
        v = D(l.value_per_person) + D(l.taxes)
        key = l.accommodation_type_id
        depk = l.flight_departure_id or l.terrestre_departure_id
        accom_pp_by_type.setdefault(key, {})[depk] = v

    # ── Monta o preço por (saída × acomodação) ──
    cfg_mode = cfg.margin_mode
    m = D(cfg.margin_percent)
    # Markup por DIVISÃO: venda = net / fator. Percentual → valor/100 (80 → 0,80);
    # decimal → o próprio valor (0,80).
    factor = m if cfg_mode == 'decimal' else (m / Decimal('100'))

    def sale_from_cost(cost):
        cost = D(cost)
        price = (cost / factor) if factor > 0 else cost
        return _apply_rounding(price, cfg.rounding_mode, cfg.rounding_value)

    # tipos de acomodação presentes (das linhas + dos itens escopados)
    accom_types = {}
    for l in accom_lines:
        if l.accommodation_type_id:
            accom_types[l.accommodation_type_id] = l.accommodation_type.name if l.accommodation_type else f'#{l.accommodation_type_id}'
    for aid in accom_extra:
        if aid not in accom_types:
            accom_types[aid] = None

    dep_list = [{'id': d.id, 'kind': 'aereo' if hasattr(d, 'airport') else 'terrestre',
                 'label': _dep_label(d), 'expected_pax': d.expected_pax} for d in departures]
    if not dep_list:
        dep_list = [{'id': None, 'kind': 'geral', 'label': 'Geral', 'expected_pax': None}]

    table = []
    for dep in dep_list:
        depid = dep['id']
        dep_cost = common_pp + dep_extra.get(depid, ZERO)
        accoms = accom_types or {None: None}
        for aid, aname in accoms.items():
            accom_cost = accom_extra.get(aid, ZERO)
            # hospedagem legada por acomodação (preferindo a linha da própria saída)
            byd = accom_pp_by_type.get(aid)
            if byd:
                accom_cost += byd.get(depid, byd.get(None, next(iter(byd.values()))))
            cost = dep_cost + accom_cost
            price = sale_from_cost(cost)
            profit = D(price) - cost
            margin_real = (profit / D(price) * Decimal('100')) if D(price) > 0 else ZERO
            row = {
                'departure_id': depid, 'departure': dep['label'],
                'accommodation_id': aid, 'accommodation': aname or ('—' if aid is None else f'#{aid}'),
                'cost_per_person': q2(cost), 'sale_price': q2(price),
                'profit': q2(profit), 'margin_real': q2(margin_real),
            }
            if cfg.min_margin_percent is not None and margin_real < D(cfg.min_margin_percent):
                row['below_min_margin'] = True
            if D(price) < cost:
                row['below_cost'] = True
            table.append(row)

    # ── Resumo por categoria ──
    total_pp = sum((D(r['cost_per_person']) for r in table), ZERO) / (len(table) or 1)
    cat_summary = []
    grand = sum(cat_totals.values(), ZERO) or Decimal('1')
    for cat, val in sorted(cat_totals.items(), key=lambda kv: -kv[1]):
        cat_summary.append({
            'category': cat, 'label': cat or 'Outros',   # category já é o nome
            'per_person': q2(val), 'share': q2(val / grand * Decimal('100')),
        })

    prices = [D(r['sale_price']) for r in table] or [ZERO]
    costs = [D(r['cost_per_person']) for r in table] or [ZERO]
    summary = {
        'base_currency': base_cur, 'base_pax': base_pax,
        'cost_per_person_avg': q2(sum(costs, ZERO) / (len(costs) or 1)),
        'min_sale_price': q2(min(prices)), 'max_sale_price': q2(max(prices)),
        'common_per_person': q2(common_pp),
        'estimated_revenue': q2(sum(prices, ZERO) / (len(prices) or 1) * D(base_pax)),
        'margin_mode': cfg_mode, 'margin_percent': q2(m),
    }

    return {
        'base_currency': base_cur, 'base_pax': base_pax,
        'departures': dep_list, 'items': items_out,
        'table': table, 'category_summary': cat_summary, 'summary': summary,
        'warnings': warnings,
    }


def simulate(itinerary, pax_list):
    """Simulação por quantidade de passageiros. Recalcula os custos de grupo
    (que caem por passageiro conforme aumenta a quantidade); os custos por
    pessoa não mudam."""
    out = []
    for pax in pax_list:
        try:
            n = int(pax)
        except (TypeError, ValueError):
            continue
        if n < 1:
            continue
        res = compute(itinerary, pax=n)
        costs = [D(r['cost_per_person']) for r in res['table']] or [ZERO]
        prices = [D(r['sale_price']) for r in res['table']] or [ZERO]
        cost_avg = sum(costs, ZERO) / (len(costs) or 1)
        price_avg = sum(prices, ZERO) / (len(prices) or 1)
        revenue = price_avg * n
        total_cost = cost_avg * n
        out.append({
            'pax': n,
            'cost_per_person': q2(cost_avg), 'sale_per_person': q2(price_avg),
            'revenue': q2(revenue), 'total_cost': q2(total_cost),
            'profit': q2(revenue - total_cost),
            'margin': q2((revenue - total_cost) / revenue * Decimal('100')) if revenue > 0 else q2(ZERO),
        })
    return out


def break_even(itinerary, max_pax=100):
    """Menor quantidade de passageiros pagantes que cobre os custos (lucro >= 0)
    e que atinge a margem mínima, se configurada."""
    cfg = getattr(itinerary, 'pricing', None)
    lo = int(getattr(cfg, 'min_pax', None) or 1) or 1
    cover = None
    reach_margin = None
    min_margin = D(getattr(cfg, 'min_margin_percent', None)) if getattr(cfg, 'min_margin_percent', None) is not None else None
    for n in range(max(1, lo), max_pax + 1):
        s = simulate(itinerary, [n])
        if not s:
            continue
        row = s[0]
        if cover is None and D(row['profit']) >= 0:
            cover = n
        if reach_margin is None and min_margin is not None and D(row['margin']) >= min_margin:
            reach_margin = n
        if cover is not None and (min_margin is None or reach_margin is not None):
            break
    return {'cover_costs': cover, 'reach_min_margin': reach_margin, 'checked_up_to': max_pax}


# ── helpers ──
def _dep_label(d):
    try:
        if hasattr(d, 'airport') and d.airport:
            code = getattr(d.airport, 'iata_code', '') or getattr(d.airport, 'code', '')
            return f'{code} · {getattr(d.airport, "name", "")}'.strip(' ·')
        if hasattr(d, 'city') and d.city:
            return getattr(d.city, 'name', '') or f'Saída #{d.id}'
    except Exception:
        pass
    return f'Saída #{d.id}'

"""Dados da REVISÃO de um contrato (fase 'revisao').

Monta um detalhamento item a item + alertas automáticos para a operadora
conferir antes de aprovar: câmbio alterado manualmente, valor por pessoa
diferente do roteiro, totais que não batem (entrada+parcelas ≠ total),
desconto aplicado e dedução da comissão da agência.

A aritmética espelha ContractSerializer._recalc_totals para bater com o total
gravado no contrato."""
from decimal import Decimal


def _d(v):
    return Decimal(str(v)) if v is not None else None


def _s(v):
    return str(v) if v is not None else None


def _m(v):
    """Valor monetário para exibição nas mensagens de alerta: 2 casas + separador
    de milhar no padrão pt-BR (ponto no milhar, vírgula nos centavos). O Decimal cru
    mostrava coisas como US$ 1599.826200; agora sai US$ 1.599,83."""
    if v is None:
        return '—'
    # Formata US (1,599.83) e troca os separadores para pt-BR (1.599,83).
    s = f'{Decimal(str(v)):,.2f}'
    return s.replace(',', 'X').replace('.', ',').replace('X', '.')


def build_review_data(contract):
    from .card_payment import dados_do_cartao
    from .serializers import _default_exchange_rate, avista_discount_usd

    lines = list(contract.accommodation_lines.select_related('accommodation_type', 'ship_cabin').all())
    adjustments = list(contract.adjustments.all())
    installments = list(contract.installments.all())

    rate = _d(contract.exchange_rate)
    default_rate = _default_exchange_rate(
        from_currency=contract.base_currency or 'USD',
        payment_type=contract.payment_type or 'parcelado')
    default_rate = _d(default_rate)

    # Tabela de preços do roteiro (valor/pessoa + taxas por tipo de acomodação).
    # IMPORTANTE: o contrato é criado a partir da FOTO PUBLICADA do roteiro
    # (published_data), NÃO do estado vivo. Editar o roteiro depois de publicar não
    # muda o contrato — então a comparação também tem de ser contra a foto, senão
    # alertamos "diferem do roteiro" à toa. Além disso só comparamos quando as moedas
    # batem: comparar número cru entre moedas diferentes não faz sentido.
    #
    # E quando o roteiro tem MAIS DE UMA SAÍDA o preço muda por saída — o mesmo tipo
    # de acomodação aparece uma vez por saída, com valores diferentes. O contrato guarda
    # a saída escolhida (itinerary_flight/terrestre_departure); só as linhas dessa saída
    # formam a baseline (senão a última saída sobrescreve e acusamos divergência falsa).
    dep_flight = contract.itinerary_flight_departure_id
    dep_terr = contract.itinerary_terrestre_departure_id

    def _in_scope(fdep, tdep):
        if dep_flight is not None:
            return fdep == dep_flight
        if dep_terr is not None:
            return tdep == dep_terr
        return fdep is None and tdep is None

    # Chave unificada de acomodação: hotel por tipo, cabine por (capacidade, rótulo).
    def _snap_key(il):
        at = il.get('accommodation_type')
        if at is not None:
            return ('acc', at)
        lbl = il.get('accommodation_label') or ''
        if il.get('ship_cabin') is not None or lbl:
            return ('cab', il.get('capacity'), lbl)
        return None

    def _line_key(l):
        if l.accommodation_type_id:
            return ('acc', l.accommodation_type_id)
        if l.ship_cabin_id or l.accommodation_label:
            return ('cab', l.capacity, l.accommodation_label or '')
        return None

    itin_map = {}
    if contract.itinerary_id:
        itin = contract.itinerary
        contract_cur = contract.base_currency or 'USD'
        if itin.is_published and isinstance(itin.published_data, dict):
            snap = itin.published_data
            if (snap.get('base_currency') or 'USD') == contract_cur:
                for il in (snap.get('accommodation_lines') or []):
                    k = _snap_key(il)
                    if k is not None and _in_scope(il.get('flight_departure'), il.get('terrestre_departure')):
                        itin_map[k] = (_d(il.get('value_per_person')), _d(il.get('taxes')))
        elif (itin.base_currency or 'USD') == contract_cur:
            # Roteiro sem foto publicada (não deveria ocorrer num contrato): cai no
            # estado vivo, ainda respeitando a moeda.
            for il in itin.accommodation_lines.all():
                k = _line_key(il)
                if k is not None and _in_scope(il.flight_departure_id, il.terrestre_departure_id):
                    itin_map[k] = (_d(il.value_per_person), _d(il.taxes))

    flags = []

    # Assinado anexado SEM a verificação automática do QR (scan ilegível, confirmado
    # manualmente no upload) → aviso bem visível para a operadora conferir à mão.
    sv = contract.signed_verification if isinstance(contract.signed_verification, dict) else None
    if sv and sv.get('qr_status') == 'unverified':
        who = sv.get('overridden_by') or 'um usuário'
        flags.append({
            'level': 'error', 'code': 'qr_unverified',
            'message': f'⚠ O documento assinado foi anexado SEM a verificação automática do '
                       f'código de segurança (o QR não pôde ser lido no scan; anexado mesmo assim por '
                       f'{who}). Confira à mão se é ESTE contrato, na versão atual, com TODAS as páginas '
                       f'na ordem certa antes de aprovar.',
        })

    # Comissão da agência: NÃO é somada ao valor/pessoa nem ao total (já embutida no
    # nosso markup). Exibida à parte como fatia informativa. comm_factor = 1.
    comm_rate = _d(contract.agency.commission_rate) if (contract.agency_id and contract.agency.commission_rate) else Decimal('0')
    comm_factor = Decimal('1')

    # ── Linhas de acomodação (com comparação vs roteiro) ──
    accom_items = []
    accom_total = Decimal('0')
    value_subtotal = Decimal('0')
    for l in lines:
        vp = _d(l.value_per_person_usd) or Decimal('0')
        tx = _d(l.taxes_usd) or Decimal('0')
        qty = l.quantity or 0
        vp_comm = vp * comm_factor          # valor/pessoa comissionado (exibido)
        subtotal = (vp_comm + tx) * qty
        accom_total += subtotal
        value_subtotal += vp * qty          # base (sem comissão) — gera a comissão
        name = (l.accommodation_type.name if l.accommodation_type_id
                else l.accommodation_label or '—')
        base = itin_map.get(_line_key(l))
        changed = False
        base_vp = base_tx = None
        if base is not None:
            base_vp, base_tx = base
            changed = (vp != (base_vp or Decimal('0'))) or (tx != (base_tx or Decimal('0')))
        accom_items.append({
            'type': name,
            'value_per_person_usd': _s(vp_comm), 'taxes_usd': _s(tx), 'quantity': qty,
            'subtotal_usd': _s(subtotal),
            # Roteiro exibido também comissionado, para a comparação bater visualmente.
            'itinerary_value_per_person': _s(base_vp * comm_factor) if base_vp is not None else None,
            'itinerary_taxes': _s(base_tx),
            'has_itinerary_baseline': base is not None,
            'changed_from_itinerary': changed,
        })
        if changed:
            flags.append({
                'level': 'warn', 'code': 'accom_changed',
                'message': f'"{name}": valor por pessoa/taxas diferem do roteiro '
                           f'(roteiro: {_m(base_vp)}/pessoa + {_m(base_tx)} taxas · '
                           f'contrato: {_m(vp)}/pessoa + {_m(tx)} taxas).',
            })

    # ── Ajustes genéricos (extras/descontos) ──
    adj_items = []
    adj_total = Decimal('0')
    for a in adjustments:
        if a.kind == 'comissao':
            continue
        amount = a.amount_usd(accom_total, rate or Decimal('0'))
        adj_total += amount if a.kind == 'acrescimo' else -amount
        item = {
            'kind': a.kind, 'description': a.description or '', 'mode': a.mode,
            'amount_usd': _s(amount),
            'percent': _s(a.percent) if a.percent else None,
            'value_brl': _s(a.value_brl) if a.value_brl else None,
            'value_usd': _s(a.value_usd) if a.value_usd else None,
        }
        adj_items.append(item)
        if a.kind == 'desconto':
            flags.append({
                'level': 'warn', 'code': 'discount',
                'message': f'Desconto aplicado{(" — " + a.description) if a.description else ""}: '
                           f'US$ {_m(amount)}.',
            })

    # ── Comissão da agência (embutida no total) ──
    commission = Decimal('0')
    commission_pct = None
    if contract.agency_id and contract.agency.commission_rate:
        commission_pct = _d(contract.agency.commission_rate)
        commission = value_subtotal * (commission_pct / Decimal('100'))

    # ── Dedução da comissão ──
    comm_disc = Decimal('0')
    comm_disc_item = None
    ca = next((a for a in adjustments if a.kind == 'comissao'), None)
    if ca and commission:
        if ca.mode == 'percentual':
            d = commission * (ca.percent or Decimal('0')) / Decimal('100')
        elif ca.mode == 'valor_brl':
            d = (ca.value_brl / rate) if rate else Decimal('0')
        else:
            d = ca.value_usd or Decimal('0')
        comm_disc = max(Decimal('0'), min(_d(d), commission))
        comm_disc_item = {
            'mode': ca.mode,
            'percent': _s(ca.percent) if ca.percent else None,
            'value_brl': _s(ca.value_brl) if ca.value_brl else None,
            'value_usd': _s(ca.value_usd) if ca.value_usd else None,
            'amount_usd': _s(comm_disc),
        }
        flags.append({
            'level': 'warn', 'code': 'commission_discount',
            'message': f'Dedução da comissão da agência: US$ {_m(comm_disc)}.',
        })

    # ── Câmbio alterado manualmente ──
    exchange_manual = (rate is not None and default_rate is not None and rate != default_rate)
    if exchange_manual:
        flags.append({
            'level': 'warn', 'code': 'exchange_manual',
            'message': f'Câmbio alterado manualmente: usado {rate} · '
                       f'configurado {default_rate} ({contract.base_currency}→BRL, '
                       f'{"à vista" if (contract.payment_type == "a_vista") else "parcelado"}).',
        })

    # ── Entrada + parcelas x total ──
    entrada_brl = sum((_d(i.value_brl) or Decimal('0')) for i in installments if i.kind == 'entrada')
    parcelas_brl = sum((_d(i.value_brl) or Decimal('0')) for i in installments if i.kind == 'parcela')
    paid_total = entrada_brl + parcelas_brl
    # Total exibido na conferência = o que o cliente paga = acomodações (venda +
    # taxas) + ajustes − abatimento − desconto à vista. A comissão da agência NÃO
    # entra (já embutida no markup); é mostrada à parte só como referência. Bate com
    # o total armazenado (_recalc_totals) e com o PDF.
    avista_disc = avista_discount_usd(contract.payment_type, accom_total + adj_total - comm_disc, rate, contract.itinerary)
    if avista_disc > 0:
        flags.append({
            'level': 'good', 'code': 'avista_discount',
            'message': f'Desconto à vista aplicado: US$ {_m(avista_disc)}'
                       f'{f" (≈ R$ {_m(avista_disc * rate)})" if rate is not None else ""}.',
        })
    review_total_usd = accom_total + adj_total - comm_disc - avista_disc
    review_total_brl = (review_total_usd * rate) if rate is not None else _d(contract.total_brl)
    # As parcelas representam o que o cliente paga (total REAL do contrato), então a
    # conferência "entrada + parcelas x total" compara com o total armazenado — assim
    # não vira alarme falso por causa do total líquido exibido acima.
    total_brl = _d(contract.total_brl)
    totals_match = True
    totals_diff = None
    if total_brl is not None and installments:
        diff = paid_total - total_brl
        if abs(diff) > Decimal('0.01'):
            totals_match = False
            totals_diff = _s(diff)
            flags.append({
                'level': 'error', 'code': 'totals_mismatch',
                'message': f'Entrada + parcelas (R$ {_m(paid_total)}) não batem com o total do '
                           f'contrato (R$ {_m(total_brl)}). Diferença: R$ {_m(diff)}.',
            })

    # ── Sugestão de pagamento (do roteiro) alterada pelo usuário ──
    # Compara o estado atual com o snapshot aplicado. A entrada é comparada pelo
    # VALOR que o % sugerido daria para o total ATUAL (assim mudar só o total não
    # gera falso alerta; mudar a entrada à mão, sim).
    # A DIREÇÃO da mudança decide a cor: favorável à operadora (entrada MAIOR ou
    # MENOS parcelas) vira flag VERDE ('good'); desfavorável (entrada menor ou
    # mais parcelas) vira alerta laranja ('warn'). Assim o revisor vê rápido o que
    # é bom e o que precisa de atenção.
    plan = contract.payment_plan_applied if isinstance(contract.payment_plan_applied, dict) else None
    if plan:
        parcelas_count = sum(1 for i in installments if i.kind == 'parcela')
        plan_count  = plan.get('installments_count')
        plan_method = (plan.get('payment_method') or '').strip()
        # Entrada esperada conforme o modo (R$ ou %). Compat com snapshot antigo
        # que só tinha down_payment_percent.
        has_dp = plan.get('has_down_payment')
        mode   = plan.get('down_payment_mode')
        val    = _d(plan.get('down_payment_value'))
        if mode is None and plan.get('down_payment_percent') is not None:
            val = _d(plan.get('down_payment_percent'))
            mode = 'percent'
            has_dp = (val or Decimal('0')) > 0
        expected_entrada = None
        if has_dp is False:
            expected_entrada = Decimal('0')
        elif val is not None:
            if mode == 'valor':
                expected_entrada = val.quantize(Decimal('0.01'))
            elif total_brl is not None:
                expected_entrada = (total_brl * val / Decimal('100')).quantize(Decimal('0.01'))

        # Entrada: MAIOR que a sugerida = favorável (verde); MENOR = alerta.
        if expected_entrada is not None:
            diff_e = entrada_brl - expected_entrada
            if diff_e > Decimal('0.01'):
                flags.append({'level': 'good', 'code': 'payment_entrada_up',
                    'message': f'Entrada MAIOR que a sugerida: R$ {_m(entrada_brl)} '
                               f'(sugerido R$ {_m(expected_entrada)}) — favorável.'})
            elif diff_e < Decimal('-0.01'):
                flags.append({'level': 'warn', 'code': 'payment_entrada_down',
                    'message': f'Entrada menor que a sugerida: R$ {_m(entrada_brl)} '
                               f'(sugerido R$ {_m(expected_entrada)}).'})

        # Parcelas: MENOS que o sugerido = favorável (verde); MAIS = alerta.
        if plan_count is not None and int(parcelas_count) != int(plan_count):
            if int(parcelas_count) < int(plan_count):
                flags.append({'level': 'good', 'code': 'payment_installments_down',
                    'message': f'Menos parcelas que o sugerido: {parcelas_count}x '
                               f'(sugerido {int(plan_count)}x) — quitação mais rápida.'})
            else:
                flags.append({'level': 'warn', 'code': 'payment_installments_up',
                    'message': f'Mais parcelas que o sugerido: {parcelas_count}x '
                               f'(sugerido {int(plan_count)}x).'})

        # Forma de pagamento: mudança neutra (info azul).
        if plan_method:
            cur_methods = {(i.payment_method or '').strip() for i in installments if (i.payment_method or '').strip()}
            if cur_methods and plan_method not in cur_methods:
                flags.append({'level': 'info', 'code': 'payment_method_changed',
                    'message': f'Forma de pagamento diferente da sugerida (sugerido "{plan_method}").'})

    installment_items = [{
        'kind': i.kind,
        'installment_number': i.installment_number,
        'detail': i.detail or '',
        'due_date': i.due_date.isoformat() if i.due_date else None,
        'value_brl': _s(i.value_brl),
        'payment_method': i.payment_method or '',
    } for i in installments]

    payer_name = None
    if contract.contratante_id and getattr(contract, 'contratante', None):
        payer_name = getattr(contract.contratante, 'full_name', None) or str(contract.contratante)
    payer_name = payer_name or (contract.payer_name or None)

    return {
        'contract_id': contract.id,
        'reservation_number': contract.reservation_number,
        'stage': contract.stage,
        # URL autenticada do arquivo assinado (para o preview ao lado na conferência).
        'signed_file': f'/api/contracts/{contract.id}/signed-file/' if contract.signed_file else None,
        # Comprovante de pagamento + quem pagou a UneWorld (config da agência: PIX
        # da agência → agência → Une; senão cliente → Une).
        'payment_receipt': f'/api/contracts/{contract.id}/receipt/' if contract.payment_receipt else None,
        'receipt_payer': contract.receipt_payer or ('agencia' if (contract.agency_id and getattr(contract.agency, 'use_agency_pix', False)) else 'cliente'),
        'agency_name': str(contract.agency) if contract.agency_id else None,
        'payer_name': payer_name,
        'package_name': contract.package_name or None,
        'contract_date': contract.contract_date.isoformat() if contract.contract_date else None,
        'departure_date': contract.departure_date.isoformat() if contract.departure_date else None,
        'return_date': contract.return_date.isoformat() if contract.return_date else None,
        'base_currency': contract.base_currency,
        'payment_type': contract.payment_type,
        'exchange_rate': {
            'used': _s(rate), 'default': _s(default_rate), 'manual': exchange_manual,
        },
        'accommodation_lines': accom_items,
        'accom_subtotal_usd': _s(accom_total),
        'adjustments': adj_items,
        'adjustments_total_usd': _s(adj_total),
        'commission': {
            'pct': _s(commission_pct), 'amount_usd': _s(commission),
        } if commission_pct is not None else None,
        'commission_discount': comm_disc_item,
        'total_usd': _s(review_total_usd),
        'total_brl': _s(review_total_brl),
        'installments': installment_items,
        'entrada_brl': _s(entrada_brl),
        'parcelas_brl': _s(parcelas_brl),
        'paid_total_brl': _s(paid_total),
        'totals_match': totals_match,
        'totals_diff_brl': totals_diff,
        'review_note': contract.review_note or '',
        'payment_plan_applied': plan,
        # Cartão: por qual adquirente esta venda vai passar (escolha do financeiro).
        'card': dados_do_cartao(contract),
        'flags': flags,
    }

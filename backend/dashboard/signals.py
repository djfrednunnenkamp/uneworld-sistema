from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def _broadcast(scope: str = 'all'):
    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)('dashboard', {
        'type': 'dashboard.refresh',
        'scope': scope,
    })


# Importações dentro das funções para evitar imports circulares na inicialização

@receiver([post_save, post_delete], sender='passengers.Passenger')
def on_passenger(sender, **kwargs):
    _broadcast('stats')


@receiver([post_save, post_delete], sender='trips.PassengerList')
def on_list(sender, **kwargs):
    _broadcast('lists')


@receiver([post_save, post_delete], sender='trips.ListEnrollment')
def on_enrollment(sender, **kwargs):
    _broadcast('stats')


# ── Contratos ─────────────────────────────────────────────────────────────────
# Qualquer alteração no contrato (edição, autosave, exclusão E o webhook do
# Autentique, que também salva o Contract) avisa todos os usuários na tela de
# Contratos para recarregarem sozinhos (silentReload no scope 'contracts').

@receiver([post_save, post_delete], sender='contracts.Contract')
def on_contract(sender, **kwargs):
    _broadcast('contracts')


# ── Reservas ──────────────────────────────────────────────────────────────────
# Qualquer alteração numa reserva (criada, paga, convertida em contrato, expirada
# ou removida) avisa quem está no hub de Reservas pra recarregar sozinho.

@receiver([post_save, post_delete], sender='reservations.Reservation')
def on_reservation(sender, **kwargs):
    _broadcast('reservas')


@receiver(post_save, sender='agenda.EmailLog')
def on_email_log(sender, **kwargs):
    _broadcast('emails')


# ── Agências ──────────────────────────────────────────────────────────────────

@receiver([post_save, post_delete], sender='agencies.Agency')
def on_agency(sender, **kwargs):
    _broadcast('agencies')


@receiver([post_save, post_delete], sender='agencies.AgencyMember')
def on_agency_member(sender, **kwargs):
    _broadcast('agencies')


# ── Usuários ──────────────────────────────────────────────────────────────────

@receiver([post_save, post_delete], sender='auth.User')
def on_user(sender, **kwargs):
    _broadcast('users')


@receiver([post_save, post_delete], sender='users_api.UserPermissions')
def on_user_permissions(sender, **kwargs):
    _broadcast('users')


# ── Auditoria ─────────────────────────────────────────────────────────────────

@receiver([post_save, post_delete], sender='audit.AuditLog')
def on_audit_log(sender, **kwargs):
    _broadcast('audit')


# ── Documentos de passageiro ──────────────────────────────────────────────────

@receiver([post_save, post_delete], sender='passengers.PassengerDocument')
def on_passenger_document(sender, **kwargs):
    _broadcast('stats')


# ── Configurações ─────────────────────────────────────────────────────────────

@receiver([post_save, post_delete], sender='config_api.ConfigProfession')
def on_config_profession(sender, **kwargs):
    _broadcast('config')


@receiver([post_save, post_delete], sender='config_api.ConfigLanguage')
def on_config_language(sender, **kwargs):
    _broadcast('config')


@receiver([post_save, post_delete], sender='config_api.ConfigCountry')
def on_config_country(sender, **kwargs):
    _broadcast('config')


@receiver([post_save, post_delete], sender='config_api.ConfigState')
def on_config_state(sender, **kwargs):
    _broadcast('config')


@receiver([post_save, post_delete], sender='config_api.ConfigGender')
def on_config_gender(sender, **kwargs):
    _broadcast('config')


@receiver([post_save, post_delete], sender='config_api.ConfigVaccine')
def on_config_vaccine(sender, **kwargs):
    _broadcast('config')


@receiver([post_save, post_delete], sender='config_api.CustomDocType')
def on_custom_doc_type(sender, **kwargs):
    _broadcast('config')


@receiver([post_save, post_delete], sender='config_api.ConfigProfCard')
def on_config_prof_card(sender, **kwargs):
    _broadcast('config')


@receiver([post_save, post_delete], sender='trips.Destination')
def on_destination(sender, **kwargs):
    _broadcast('config')


@receiver([post_save, post_delete], sender='trips.ListAdditional')
def on_list_additional(sender, **kwargs):
    _broadcast('config')


@receiver([post_save, post_delete], sender='trips.CrewRole')
def on_crew_role(sender, **kwargs):
    _broadcast('config')


# ── Listas / Quartos ──────────────────────────────────────────────────────────

@receiver([post_save, post_delete], sender='trips.Room')
def on_room(sender, **kwargs):
    _broadcast('lists')


# ── Calendário ────────────────────────────────────────────────────────────────

@receiver([post_save, post_delete], sender='agenda.CalendarPreference')
def on_calendar_preference(sender, **kwargs):
    _broadcast('calendar')


# ── Galeria / Roteiros ────────────────────────────────────────────────────────
# Qualquer mudança nas imagens (galeria, capas, lâminas) atualiza a Galeria ao
# vivo para todos que estão com ela aberta.

@receiver([post_save, post_delete], sender='itineraries.ItineraryImage')
def on_itinerary_image(sender, **kwargs):
    _broadcast('gallery')


# Publicar/despublicar, mudar datas ou excluir um roteiro altera o que a operadora
# enxerga na Galeria (lâminas dos roteiros públicos e abertos) — e a lista de
# Roteiros. Avisa os dois. (O save do roteiro não é por tecla; é aceitável.)

@receiver([post_save, post_delete], sender='itineraries.Itinerary')
def on_itinerary(sender, **kwargs):
    _broadcast('gallery')
    _broadcast('itineraries')


# ── Meus Documentos (Drive) ───────────────────────────────────────────────────
# Criar / renomear / mover / compartilhar / restaurar / salvar (callback do
# OnlyOffice) passam por .save()/.delete() e avisam quem está com o Drive aberto
# para recarregar sozinho. O soft-delete usa bulk_update (sem signal), então o
# destroy chama broadcast_drive() na mão.

@receiver([post_save, post_delete], sender='drive.DriveNode')
def on_drive_node(sender, **kwargs):
    _broadcast('drive')


def broadcast_drive():
    """Aviso manual de mudança no Drive (caminhos que não disparam signal, ex.:
    o bulk_update do soft-delete/lixeira)."""
    _broadcast('drive')


# ── Financeiro ────────────────────────────────────────────────────────────────
# A página Financeiro (entradas previstas / contas a pagar / fluxo de caixa) é
# 100% derivada: recebíveis das parcelas dos contratos, contas a pagar do
# cronograma dos custos dos roteiros e a conversão em BRL pela cotação atual.
# Qualquer uma dessas fontes muda → todo mundo com a página aberta recarrega
# sozinho (scope 'financeiro'). O save do Contract já avisa em 'contracts', que a
# página também escuta (muda o estágio faturado = recebido).

@receiver([post_save, post_delete], sender='config_api.ConfigExchangeRate')
def on_exchange_rate(sender, **kwargs):
    # Mexeu na taxa do euro/dólar → o valor em BRL das contas a pagar muda na hora.
    _broadcast('financeiro')


@receiver([post_save, post_delete], sender='contracts.ContractInstallment')
def on_contract_installment(sender, **kwargs):
    _broadcast('financeiro')


@receiver([post_save, post_delete], sender='itineraries.ItineraryCostItem')
def on_itinerary_cost_item(sender, **kwargs):
    _broadcast('financeiro')


# ── Vouchers ──────────────────────────────────────────────────────────────────
# Salvar blocos, publicar/voltar p/ edição, enviar/remover confirmação de voo e
# editar templates atualizam ao vivo quem está com o Voucher aberto (scope
# 'vouchers'). As entries também dependem dos passageiros da lista (scope 'lists').

@receiver([post_save, post_delete], sender='vouchers.VoucherList')
def on_voucher_list(sender, **kwargs):
    _broadcast('vouchers')


@receiver([post_save, post_delete], sender='vouchers.VoucherTemplate')
def on_voucher_template(sender, **kwargs):
    _broadcast('vouchers')


@receiver([post_save, post_delete], sender='vouchers.VoucherFlightConfirmation')
def on_voucher_flight(sender, **kwargs):
    _broadcast('vouchers')


@receiver([post_save, post_delete], sender='vouchers.VoucherDownload')
def on_voucher_download(sender, **kwargs):
    _broadcast('vouchers')

import api from './client'

// Verifica formato + domínio (MX) de um e-mail e sugere correção de domínio.
export const validateEmailApi = (email) => api.get('/validate-email/', { params: { email } })

export const dashboardApi = {
  getStats: () => api.get('/dashboard/'),
}

export const passengersApi = {
  list:     (params) => api.get('/passengers/', { params }),
  get:      (id)     => api.get(`/passengers/${id}/`),
  create:   (data)   => api.post('/passengers/', data),
  update:   (id, data) => api.put(`/passengers/${id}/`, data),
  patch:    (id, data) => api.patch(`/passengers/${id}/`, data),
  remove:   (id)     => api.delete(`/passengers/${id}/`),
  checkCpf:  (cpf)  => api.get('/passengers/check-cpf/', { params: { cpf } }),
  agencies:  (id)   => api.get(`/passengers/${id}/agencies/`),
  deleted:  ()       => api.get('/passengers/', { params: { deleted: 1 } }),
  restore:  (id)     => api.post(`/passengers/${id}/restore/`),
  purge:    (id)     => api.delete(`/passengers/${id}/purge/`),
  merge:    (data)   => api.post('/passengers/merge/', data),
  discard:  (id)     => api.delete(`/passengers/${id}/discard/`),   // descarta rascunho
}

export const tripsApi = {
  list: (params) => api.get('/trips/', { params }),
  get: (id) => api.get(`/trips/${id}/`),
  create: (data) => api.post('/trips/', data),
  update: (id, data) => api.put(`/trips/${id}/`, data),
  remove: (id) => api.delete(`/trips/${id}/`),
  destinations: () => api.get('/trips/destinations/'),
  enrollments: (params) => api.get('/trips/enrollments/', { params }),
}

export const listsApi = {
  // Listas de Passageiros
  list:   (params) => api.get('/trips/lists/', { params }),
  get:    (id)     => api.get(`/trips/lists/${id}/`),
  create: (data)   => api.post('/trips/lists/', data),
  update: (id, d)  => api.put(`/trips/lists/${id}/`, d),
  patch:  (id, d)  => api.patch(`/trips/lists/${id}/`, d),
  remove: (id)     => api.delete(`/trips/lists/${id}/`),
  deleted: ()      => api.get('/trips/lists/', { params: { deleted: 1 } }),
  restore: (id)    => api.post(`/trips/lists/${id}/restore/`),
  purge:   (id)    => api.delete(`/trips/lists/${id}/purge/`),
  // ZIP dos documentos dos passageiros (todos, ou só os passenger_ids passados)
  documentsZip:     (id, passengerIds = null) => api.post(`/trips/lists/${id}/documents-zip/`, { passenger_ids: passengerIds }, { responseType: 'blob' }),
  // Passageiros na lista
  listPassengers:   (id)          => api.get(`/trips/lists/${id}/passageiros/`),
  addPassenger:     (id, data)     => api.post(`/trips/lists/${id}/passageiros/`, data),
  updatePassenger:  (id, eid, d)  => api.patch(`/trips/lists/${id}/passageiros/${eid}/`, d),
  removePassenger:  (id, eid)     => api.delete(`/trips/lists/${id}/passageiros/${eid}/`),
  importCsv:        (id, formData) => api.post(`/trips/lists/${id}/import-csv/`, formData,
                       { headers: { 'Content-Type': 'multipart/form-data' } }),
  logDownload:      (id, format, sections) => api.post(`/trips/lists/${id}/log-download/`, { format, sections }),
  // Tarefas / Pendências da lista
  listTasks:    (id)          => api.get(`/trips/lists/${id}/tasks/`),
  addTask:      (id, data)    => api.post(`/trips/lists/${id}/tasks/`, data),
  updateTask:   (id, tid, d)  => api.patch(`/trips/lists/${id}/tasks/${tid}/`, d),
  deleteTask:   (id, tid)     => api.delete(`/trips/lists/${id}/tasks/${tid}/`),
  // Acomodações (quartos) na lista
  listRooms:        (id)          => api.get(`/trips/lists/${id}/rooms/`),
  addRoom:          (id, name)     => api.post(`/trips/lists/${id}/rooms/`, { name }),
  renameRoom:       (id, rid, name) => api.patch(`/trips/lists/${id}/rooms/${rid}/`, { name }),
  removeRoom:       (id, rid, resolution) => api.delete(`/trips/lists/${id}/rooms/${rid}/`, resolution ? { data: { resolution } } : undefined),
  ackRoomSameSex:   (id, rid, ack)  => api.patch(`/trips/lists/${id}/rooms/${rid}/`, { same_sex_ack: ack }),
  // Fornecedores e Adicionais
  suppliers:        ()            => api.get('/trips/suppliers/'),
  addSupplier:      (name)        => api.post('/trips/suppliers/', { name }),
  removeSupplier:   (id)          => api.delete(`/trips/suppliers/${id}/`),
  listAdditionals:  ()            => api.get('/trips/list-additionals/'),
  addAdditional:    (name)        => api.post('/trips/list-additionals/', { name }),
  updateAdditional: (id, name)    => api.patch(`/trips/list-additionals/${id}/`, { name }),
  removeAdditional: (id)          => api.delete(`/trips/list-additionals/${id}/`),
  // Equipe técnica
  listCrewRoles:    ()            => api.get('/trips/crew-roles/'),
  addCrewRole:      (name)        => api.post('/trips/crew-roles/', { name }),
  updateCrewRole:   (id, name)    => api.patch(`/trips/crew-roles/${id}/`, { name }),
  removeCrewRole:   (id)          => api.delete(`/trips/crew-roles/${id}/`),
  // Roteiros
  roteiros:         ()            => api.get('/trips/roteiros/'),
  addRoteiro:       (name)        => api.post('/trips/roteiros/', { name }),
  removeRoteiro:    (id)          => api.delete(`/trips/roteiros/${id}/`),
}

export const agenciesApi = {
  list:          (params) => api.get('/agencies/', { params }),
  get:           (id)     => api.get(`/agencies/${id}/`),
  create:        (data)   => api.post('/agencies/', data),
  update:        (id, data) => api.put(`/agencies/${id}/`, data),
  remove:        (id)     => api.delete(`/agencies/${id}/`),
  checkCnpj:     (cnpj)  => api.get('/agencies/check-cnpj/', { params: { cnpj } }),
  deleted:       ()       => api.get('/agencies/', { params: { deleted: 1 } }),
  restore:       (id)     => api.post(`/agencies/${id}/restore/`),
  purge:         (id)     => api.delete(`/agencies/${id}/purge/`),
  merge:         (data)   => api.post('/agencies/merge/', data),
  discard:       (id)     => api.delete(`/agencies/${id}/discard/`),   // descarta rascunho
  // Membros
  listMembers:   (id)              => api.get(`/agencies/${id}/members/`),
  attachableUsers: (id)            => api.get(`/agencies/${id}/attachable-users/`),
  addMember:     (id, email, role) => api.post(`/agencies/${id}/members/`, { email, role }),
  addMemberById: (id, userId, role, applyAgencyProfile) => api.post(`/agencies/${id}/members/`, { user_id: userId, role, apply_agency_profile: !!applyAgencyProfile }),
  updateMember:  (id, mid, role)   => api.patch(`/agencies/${id}/members/${mid}/`, { role }),
  removeMember:  (id, mid)         => api.delete(`/agencies/${id}/members/${mid}/`),
}

export const contractsApi = {
  list:    (params) => api.get('/contracts/', { params }),
  sellers: ()       => api.get('/contracts/sellers/'),
  preview: (data)   => api.post('/contracts/preview/', data),
  get:     (id)     => api.get(`/contracts/${id}/`),
  create:  (data)   => api.post('/contracts/', data),
  update:  (id, d)  => api.put(`/contracts/${id}/`, d),
  patch:   (id, d)  => api.patch(`/contracts/${id}/`, d),
  remove:  (id)     => api.delete(`/contracts/${id}/`),
  discard: (id)     => api.delete(`/contracts/${id}/discard/`),   // descarta rascunho (cancelar)
  deleted: ()       => api.get('/contracts/', { params: { deleted: 1 } }),
  restore: (id)     => api.post(`/contracts/${id}/restore/`),
  purge:   (id)     => api.delete(`/contracts/${id}/purge/`),
  sendForSignature: (id) => api.post(`/contracts/${id}/send-for-signature/`),
  // Assinatura digital: envia junto o PDF gerado (a Autentique precisa do arquivo).
  sendForSignatureDigital: (id, file) => { const fd = new FormData(); fd.append('file', file); return api.post(`/contracts/${id}/send-for-signature/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  checkSignature:   (id) => api.post(`/contracts/${id}/check-signature/`),
  reopen:           (id) => api.post(`/contracts/${id}/reopen/`),
  uploadSigned:     (id, file, receipt, { override } = {}) => { const fd = new FormData(); fd.append('file', file); if (receipt) fd.append('receipt', receipt); if (override) fd.append('override_unverified', 'true'); return api.post(`/contracts/${id}/upload-signed/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  signingQr:        (id, pages) => api.post(`/contracts/${id}/signing-qr/`, { pages }),
  // Revisão (operadora): dados item a item + alertas, aprovar / reprovar.
  reviewData:       (id) => api.get(`/contracts/${id}/review-data/`),
  approve:          (id) => api.post(`/contracts/${id}/approve/`),
  reject:           (id, note) => api.post(`/contracts/${id}/reject/`, { note }),
  // Faturamento: dados da fatura + faturar (número e data).
  invoiceData:      (id) => api.get(`/contracts/${id}/invoice-data/`),
  invoice:          (id, invoice_number, invoice_date) => api.post(`/contracts/${id}/invoice/`, { invoice_number, invoice_date }),
}

export const itinerariesApi = {
  list:    (params) => api.get('/itineraries/', { params }),
  get:     (id)     => api.get(`/itineraries/${id}/`),
  create:  (data)   => api.post('/itineraries/', data),
  update:  (id, d)  => api.put(`/itineraries/${id}/`, d),
  remove:  (id)     => api.delete(`/itineraries/${id}/`),
  deleted: ()       => api.get('/itineraries/', { params: { deleted: 1 } }),
  drafts:  ()       => api.get('/itineraries/', { params: { status: 'rascunho' } }),
  restore: (id)     => api.post(`/itineraries/${id}/restore/`),
  purge:   (id)     => api.delete(`/itineraries/${id}/purge/`),
  // Imagens (galeria do roteiro ou de um dia) e documentos (PDF) — upload multipart.
  uploadImage:    (id, file, { caption, is_cover, day } = {}) => { const fd = new FormData(); fd.append('image', file); if (caption) fd.append('caption', caption); if (is_cover) fd.append('is_cover', 'true'); if (day) fd.append('day', day); return api.post(`/itineraries/${id}/images/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  deleteImage:    (id, imageId) => api.delete(`/itineraries/${id}/images/${imageId}/`),
  setCover:       (id, imageId) => api.post(`/itineraries/${id}/images/${imageId}/cover/`),
  uploadDocument: (id, file, { title } = {}) => { const fd = new FormData(); fd.append('file', file); if (title) fd.append('title', title); return api.post(`/itineraries/${id}/documents/`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  deleteDocument: (id, docId) => api.delete(`/itineraries/${id}/documents/${docId}/`),
}

export const documentsApi = {
  list:     (passengerId) =>
    api.get(`/passengers/${passengerId}/documents/`),
  upload:   (passengerId, formData) =>
    api.post(`/passengers/${passengerId}/documents/`, formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }),
  patch:    (docId, data) =>
    api.patch(`/passengers/documents/${docId}/`, data),
  remove:   (docId) =>
    api.delete(`/passengers/documents/${docId}/`),
  download: (docId) =>
    api.get(`/passengers/documents/${docId}/download/`, { responseType: 'blob' }),
}

export const authApi = {
  login:          (email, password) => api.post('/users/login/', { email, password }),
  logout:         ()                => api.post('/users/logout/'),
  me:             ()                => api.get('/users/me/'),
  updateMe:       (data)            => api.patch('/users/me/', data),
  changePassword: (current_password, new_password) =>
    api.post('/users/me/change-password/', { current_password, new_password }),
}

export const auditApi = {
  list:        (params)       => api.get('/audit/logs/', { params }),
  logPageView: (path, label)  => api.post('/audit/page-view/', { path, label }),
  logUpload:   (data)         => api.post('/audit/log-upload/', data),
  logDownload: (data)         => api.post('/audit/log-download/', data),
  refineLoginLocation: (latitude, longitude) => api.post('/audit/refine-login-location/', { latitude, longitude }),
}

export const agendaApi = {
  events:           (start, end, list_id) => api.get('/agenda/events/', { params: { start, end, ...(list_id ? { list_id } : {}) } }),
  getPrefs:         ()           => api.get('/agenda/preferences/'),
  updatePrefs:      (data)       => api.patch('/agenda/preferences/', data),
  getUserPrefs:     (userId)     => api.get(`/agenda/preferences/${userId}/`),
  updateUserPrefs:  (userId, d)  => api.patch(`/agenda/preferences/${userId}/`, d),
  sendNow:          ()           => api.post('/agenda/send-now/'),
  emailLogSettings: ()           => api.get('/agenda/email-log/settings/'),
  emailLog:         ()           => api.get('/agenda/email-log/'),
  emailLogDetail:   (id)         => api.get(`/agenda/email-log/${id}/`),
  emailLogResend:   (id)         => api.post(`/agenda/email-log/${id}/resend/`),
}

export const configApi = {
  // Profissões
  professions:       ()     => api.get('/config/professions/'),
  addProfession:     (name) => api.post('/config/professions/', { name }),
  updateProfession:  (id, name) => api.patch(`/config/professions/${id}/`, { name }),
  delProfession:     (id)   => api.delete(`/config/professions/${id}/`),
  importProfessions: ()     => api.post('/config/professions/import/'),
  // Idiomas
  languages:         ()     => api.get('/config/languages/'),
  addLanguage:       (name) => api.post('/config/languages/', { name }),
  updateLanguage:    (id, name) => api.patch(`/config/languages/${id}/`, { name }),
  delLanguage:       (id)   => api.delete(`/config/languages/${id}/`),
  importLanguages:   ()     => api.post('/config/languages/import/'),
  // Países
  countries:         ()     => api.get('/config/countries/'),
  addCountry:        (name, code, continent) => api.post('/config/countries/', { name, code, continent }),
  updateCountry:     (id, name, continent)   => api.patch(`/config/countries/${id}/`, { name, ...(continent !== undefined ? { continent } : {}) }),
  delCountry:        (id)   => api.delete(`/config/countries/${id}/`),
  importCountries:   ()     => api.post('/config/countries/import/'),
  importCountriesCascade: () => api.post('/config/countries/import-cascade/'),
  // Estados
  states:            (country_id) => api.get('/config/states/', { params: { country_id } }),
  allStates:         ()           => api.get('/config/states/', { params: { all: true } }),
  addState:          (country_id, name, code) => api.post('/config/states/', { country_id, name, code }),
  updateState:       (id, name)   => api.patch(`/config/states/${id}/`, { name }),
  delState:          (id)   => api.delete(`/config/states/${id}/`),
  importStates:      (country_id) => api.post('/config/states/import/', { country_id }),
  // Cidades
  cities:    (state_id) => api.get('/config/cities/', { params: { state_id } }),
  citySearch: (q) => api.get('/config/cities/', { params: { q } }),
  addCity:   (state_id, name) => api.post('/config/cities/', { state_id, name }),
  updateCity: (id, name) => api.patch(`/config/cities/${id}/`, { name }),
  delCity:   (id) => api.delete(`/config/cities/${id}/`),
  importCities: (state_id) => api.post('/config/cities/import/', { state_id }),
  // Tipos de documento
  docTypes:       ()       => api.get('/config/doc-types/'),
  addDocType:     (data)   => api.post('/config/doc-types/', data),
  updateDocType:  (id, d)  => api.patch(`/config/doc-types/${id}/`, d),
  delDocType:     (id)     => api.delete(`/config/doc-types/${id}/`),
  seedDocTypes:   ()       => api.post('/config/doc-types/seed/'),
  // Campos de documento
  addDocField:    (data)   => api.post('/config/doc-fields/', data),
  updateDocField: (id, d)  => api.patch(`/config/doc-fields/${id}/`, d),
  delDocField:    (id)     => api.delete(`/config/doc-fields/${id}/`),
  // Opções de campo
  addDocOption:   (data)   => api.post('/config/doc-options/', data),
  delDocOption:   (id)     => api.delete(`/config/doc-options/${id}/`),
  // Carteiras profissionais
  profCards:       () => api.get('/config/prof-cards/'),
  addProfCard:     (name) => api.post('/config/prof-cards/', { name }),
  updateProfCard:  (id, name) => api.patch(`/config/prof-cards/${id}/`, { name }),
  delProfCard:     (id)   => api.delete(`/config/prof-cards/${id}/`),
  importProfCards: ()     => api.post('/config/prof-cards/import/'),
  // Companhias aéreas
  airlines:       (params) => api.get('/config/airlines/', { params }),
  addAirline:     (data)   => api.post('/config/airlines/', data),
  updateAirline:  (id, d)  => api.patch(`/config/airlines/${id}/`, d),
  delAirline:     (id)     => api.delete(`/config/airlines/${id}/`),
  seedAirlines:   ()       => api.post('/config/airlines/seed/'),
  // Aeroportos
  airports:       (params) => api.get('/config/airports/', { params }),
  addAirport:     (data)   => api.post('/config/airports/', data),
  updateAirport:  (id, d)  => api.patch(`/config/airports/${id}/`, d),
  delAirport:     (id)     => api.delete(`/config/airports/${id}/`),
  seedAirports:          ()               => api.post('/config/airports/seed/'),
  airportCountrySuggest: (q)             => api.get('/config/airports/country-suggestions/', { params: { q } }),
  airportCitySuggest:    (country, q)    => api.get('/config/airports/city-suggestions/',   { params: { country, q } }),
  // Tipos de Acomodação
  accommodations:       ()            => api.get('/config/accommodations/'),
  addAccommodation:     (data)        => api.post('/config/accommodations/', data),
  updateAccommodation:  (id, data)    => api.patch(`/config/accommodations/${id}/`, data),
  delAccommodation:     (id)          => api.delete(`/config/accommodations/${id}/`),
  // Mapas de ônibus
  busMaps:       ()       => api.get('/config/bus-maps/'),
  addBusMap:     (data)   => api.post('/config/bus-maps/', data),
  updateBusMap:  (id, d)  => api.patch(`/config/bus-maps/${id}/`, d),
  delBusMap:     (id)     => api.delete(`/config/bus-maps/${id}/`),
  // Gêneros
  genders:    () => api.get('/config/genders/'),
  addGender:  (name) => api.post('/config/genders/', { name }),
  updateGender: (id, name) => api.patch(`/config/genders/${id}/`, { name }),
  delGender:  (id)   => api.delete(`/config/genders/${id}/`),
  // Perfis de permissão
  permissionProfiles:      ()       => api.get('/config/permission-profiles/'),
  addPermissionProfile:    (data)   => api.post('/config/permission-profiles/', data),
  updatePermissionProfile: (id, d)  => api.patch(`/config/permission-profiles/${id}/`, d),
  delPermissionProfile:    (id)     => api.delete(`/config/permission-profiles/${id}/`),
  deletedPermissionProfiles: ()     => api.get('/config/permission-profiles/', { params: { deleted: 1 } }),
  restorePermissionProfile:  (id)   => api.post(`/config/permission-profiles/${id}/restore/`),
  purgePermissionProfile:    (id)   => api.delete(`/config/permission-profiles/${id}/purge/`),
  // Cláusulas de contrato
  contractClauses:        (params)  => api.get('/config/contract-clauses/', { params }),
  addContractClause:      (data)    => api.post('/config/contract-clauses/', data),
  updateContractClause:   (id, d)   => api.patch(`/config/contract-clauses/${id}/`, d),
  delContractClause:      (id)      => api.delete(`/config/contract-clauses/${id}/`),
  // Dados da operadora (UneWorld) — pré-preenche os contratos
  operatingCompany:       ()        => api.get('/config/operating-company/'),
  updateOperatingCompany: (data)    => api.patch('/config/operating-company/', data, data instanceof FormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : undefined),
  // Formas de pagamento
  paymentMethods:    () => api.get('/config/payment-methods/'),
  addPaymentMethod:  (name) => api.post('/config/payment-methods/', { name }),
  updatePaymentMethod: (id, name) => api.patch(`/config/payment-methods/${id}/`, { name }),
  delPaymentMethod:  (id)   => api.delete(`/config/payment-methods/${id}/`),
  // Modelos de pagamento (sugestão: entrada % + nº de parcelas + vencimentos)
  paymentPlans:      () => api.get('/config/payment-plans/'),
  addPaymentPlan:    (data) => api.post('/config/payment-plans/', data),
  updatePaymentPlan: (id, data) => api.patch(`/config/payment-plans/${id}/`, data),
  delPaymentPlan:    (id)   => api.delete(`/config/payment-plans/${id}/`),
  // Câmbio
  exchangeRates:     () => api.get('/config/exchange-rates/'),
  addExchangeRate:   (data) => api.post('/config/exchange-rates/', data),
  updateExchangeRate: (id, data) => api.patch(`/config/exchange-rates/${id}/`, data),
  delExchangeRate:   (id)   => api.delete(`/config/exchange-rates/${id}/`),
  pullExchangeInternet: () => api.post('/config/exchange-rates/pull-internet/'),
  runExchangeNow:       () => api.post('/config/exchange-rates/run-now/'),
  updateExchangeRateNow: (id) => api.post(`/config/exchange-rates/${id}/update-now/`),
  exchangeDefaultTime:    () => api.get('/config/exchange-rates/default-time/'),
  setExchangeDefaultTime: (t) => api.post('/config/exchange-rates/default-time/', { default_update_time: t }),
  testExchangeScript:     (script) => api.post('/config/exchange-rates/test-script/', { script }),
  // Categorias de roteiro
  itineraryCategories:    () => api.get('/config/itinerary-categories/'),
  addItineraryCategory:   (name) => api.post('/config/itinerary-categories/', { name }),
  updateItineraryCategory: (id, name) => api.patch(`/config/itinerary-categories/${id}/`, { name }),
  delItineraryCategory:   (id)   => api.delete(`/config/itinerary-categories/${id}/`),
  // Continentes
  continents:    () => api.get('/config/continents/'),
  addContinent:  (name) => api.post('/config/continents/', { name }),
  updateContinent: (id, name) => api.patch(`/config/continents/${id}/`, { name }),
  delContinent:  (id)   => api.delete(`/config/continents/${id}/`),
  // Tipos de roteiro
  itineraryTypes:    () => api.get('/config/itinerary-types/'),
  addItineraryType:  (name) => api.post('/config/itinerary-types/', { name }),
  updateItineraryType: (id, name) => api.patch(`/config/itinerary-types/${id}/`, { name }),
  delItineraryType:  (id)   => api.delete(`/config/itinerary-types/${id}/`),
  // Companhias marítimas
  maritimeCompanies:    () => api.get('/config/maritime-companies/'),
  addMaritimeCompany:   (data) => api.post('/config/maritime-companies/', data),
  updateMaritimeCompany: (id, data) => api.patch(`/config/maritime-companies/${id}/`, data),
  delMaritimeCompany:   (id)   => api.delete(`/config/maritime-companies/${id}/`),
  // Moedas
  currencies:    () => api.get('/config/currencies/'),
  addCurrency:   (data) => api.post('/config/currencies/', data),
  updateCurrency: (id, data) => api.patch(`/config/currencies/${id}/`, data),
  delCurrency:   (id)   => api.delete(`/config/currencies/${id}/`),
  // Palavras-chave (tags de roteiro)
  keywords:      () => api.get('/config/keywords/'),
  keywordSearch: (q) => api.get('/config/keywords/', { params: { q } }),
  addKeyword:    (name) => api.post('/config/keywords/', { name }),
  updateKeyword: (id, name) => api.patch(`/config/keywords/${id}/`, { name }),
  delKeyword:    (id)   => api.delete(`/config/keywords/${id}/`),
  // Inclusos (itens do pacote)
  inclusions:    () => api.get('/config/inclusions/'),
  addInclusion:  (name) => api.post('/config/inclusions/', { name }),
  updateInclusion: (id, name) => api.patch(`/config/inclusions/${id}/`, { name }),
  delInclusion:  (id)   => api.delete(`/config/inclusions/${id}/`),
  highlights:    () => api.get('/config/highlights/'),
  addHighlight:  (name) => api.post('/config/highlights/', { name }),
  updateHighlight: (id, name) => api.patch(`/config/highlights/${id}/`, { name }),
  delHighlight:  (id)   => api.delete(`/config/highlights/${id}/`),
  // Categorias de lista
  listCategories:    () => api.get('/config/list-categories/'),
  addListCategory:   (name) => api.post('/config/list-categories/', { name }),
  updateListCategory: (id, name) => api.patch(`/config/list-categories/${id}/`, { name }),
  delListCategory:   (id)   => api.delete(`/config/list-categories/${id}/`),
  // Vacinas
  vaccines:       () => api.get('/config/vaccines/'),
  addVaccine:     (name) => api.post('/config/vaccines/', { name }),
  updateVaccine:  (id, name) => api.patch(`/config/vaccines/${id}/`, { name }),
  delVaccine:     (id)   => api.delete(`/config/vaccines/${id}/`),
  importVaccines: ()     => api.post('/config/vaccines/import/'),
  // CSV global (países + estados + cidades)
  geoExport:  () => api.get('/config/geo/export/', { responseType: 'blob' }),
  geoImport:  (formData) => api.post('/config/geo/import/', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  geoAnalyze: (rows) => api.post('/config/geo/analyze/', { rows }),
  geoAction:  (mode, rows) => api.post('/config/geo/action/', { mode, rows }),
  // Configurações globais do sistema
  systemSettings:       ()     => api.get('/config/system-settings/'),
  updateSystemSettings: (data) => api.patch('/config/system-settings/', data),
  // Termos e condições
  terms:        ()     => api.get('/config/terms/'),
  updateTerms:  (data) => api.patch('/config/terms/', data),
}

export const usersApi = {
  list:           ()       => api.get('/users/'),
  deleted:        ()       => api.get('/users/', { params: { deleted: 1 } }),
  create:         (data)   => api.post('/users/create/', data),
  update:         (id, d)  => api.patch(`/users/${id}/`, d),
  remove:         (id)     => api.delete(`/users/${id}/delete/`),
  unlinkAgencies: (id)     => api.post(`/users/${id}/unlink-agencies/`),
  restore:        (id)     => api.post(`/users/${id}/restore/`),
  purge:          (id)     => api.delete(`/users/${id}/purge/`),
  sendInvite:     (id)     => api.post(`/users/${id}/invite/`),
  sendReset:      (id)     => api.post(`/users/${id}/send-reset/`),
  setPassword:    (id, password, adminPassword) => api.post(`/users/${id}/set-password/`, { password, admin_password: adminPassword }),
  forgotPassword: (email)  => api.post('/users/forgot-password/', { email }),
  resetPassword:  (token, password) => api.post('/users/reset-password/', { token, password }),
  // Valida o token de reset no carregamento da página (F-07). POST → token no body.
  validateResetToken: (token) => api.post('/users/reset-password/validate/', { token }),
  // F-01: token no BODY (POST), nunca em query string.
  validateInvite: (token)  => api.post('/users/invite/validate/', { token }),
  acceptInvite:   (token, password, termsAccepted) => api.post('/users/invite/accept/', { token, password, terms_accepted: termsAccepted }),
  acceptTerms:    ()       => api.post('/users/me/accept-terms/'),
}

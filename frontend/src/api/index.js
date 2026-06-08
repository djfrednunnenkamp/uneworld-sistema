import api from './client'

export const dashboardApi = {
  getStats: () => api.get('/dashboard/'),
}

export const passengersApi = {
  list:     (params) => api.get('/passengers/', { params }),
  get:      (id)     => api.get(`/passengers/${id}/`),
  create:   (data)   => api.post('/passengers/', data),
  update:   (id, data) => api.put(`/passengers/${id}/`, data),
  remove:   (id)     => api.delete(`/passengers/${id}/`),
  checkCpf:  (cpf)  => api.get('/passengers/check-cpf/', { params: { cpf } }),
  agencies:  (id)   => api.get(`/passengers/${id}/agencies/`),
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
  // Passageiros na lista
  listPassengers:   (id)          => api.get(`/trips/lists/${id}/passageiros/`),
  addPassenger:     (id, data)     => api.post(`/trips/lists/${id}/passageiros/`, data),
  updatePassenger:  (id, eid, d)  => api.patch(`/trips/lists/${id}/passageiros/${eid}/`, d),
  removePassenger:  (id, eid)     => api.delete(`/trips/lists/${id}/passageiros/${eid}/`),
  // Acomodações (quartos) na lista
  listRooms:        (id)          => api.get(`/trips/lists/${id}/rooms/`),
  addRoom:          (id, name)     => api.post(`/trips/lists/${id}/rooms/`, { name }),
  renameRoom:       (id, rid, name) => api.patch(`/trips/lists/${id}/rooms/${rid}/`, { name }),
  removeRoom:       (id, rid, resolution) => api.delete(`/trips/lists/${id}/rooms/${rid}/`, resolution ? { data: { resolution } } : undefined),
  // Fornecedores e Adicionais
  suppliers:        ()            => api.get('/trips/suppliers/'),
  addSupplier:      (name)        => api.post('/trips/suppliers/', { name }),
  removeSupplier:   (id)          => api.delete(`/trips/suppliers/${id}/`),
  listAdditionals:  ()            => api.get('/trips/list-additionals/'),
  addAdditional:    (name)        => api.post('/trips/list-additionals/', { name }),
  updateAdditional: (id, name)    => api.patch(`/trips/list-additionals/${id}/`, { name }),
  removeAdditional: (id)          => api.delete(`/trips/list-additionals/${id}/`),
  // Roteiros
  roteiros:         ()            => api.get('/trips/roteiros/'),
  addRoteiro:       (name)        => api.post('/trips/roteiros/', { name }),
  removeRoteiro:    (id)          => api.delete(`/trips/roteiros/${id}/`),
}

export const meetingsApi = {
  list: (params) => api.get('/meetings/', { params }),
  get: (id) => api.get(`/meetings/${id}/`),
  create: (data) => api.post('/meetings/', data),
  update: (id, data) => api.put(`/meetings/${id}/`, data),
  remove: (id) => api.delete(`/meetings/${id}/`),
  upcoming: () => api.get('/meetings/upcoming/'),
}

export const agenciesApi = {
  list:          (params) => api.get('/agencies/', { params }),
  get:           (id)     => api.get(`/agencies/${id}/`),
  create:        (data)   => api.post('/agencies/', data),
  update:        (id, data) => api.put(`/agencies/${id}/`, data),
  remove:        (id)     => api.delete(`/agencies/${id}/`),
  checkCnpj:     (cnpj)  => api.get('/agencies/check-cnpj/', { params: { cnpj } }),
  // Membros
  listMembers:   (id)              => api.get(`/agencies/${id}/members/`),
  addMember:     (id, email, role) => api.post(`/agencies/${id}/members/`, { email, role }),
  addMemberById: (id, userId, role) => api.post(`/agencies/${id}/members/`, { user_id: userId, role }),
  updateMember:  (id, mid, role)   => api.patch(`/agencies/${id}/members/${mid}/`, { role }),
  removeMember:  (id, mid)         => api.delete(`/agencies/${id}/members/${mid}/`),
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
  list: (params) => api.get('/audit/logs/', { params }),
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
  addCountry:        (name, code) => api.post('/config/countries/', { name, code }),
  updateCountry:     (id, name)   => api.patch(`/config/countries/${id}/`, { name }),
  delCountry:        (id)   => api.delete(`/config/countries/${id}/`),
  importCountries:   ()     => api.post('/config/countries/import/'),
  // Estados
  states:            (country_id) => api.get('/config/states/', { params: { country_id } }),
  addState:          (country_id, name, code) => api.post('/config/states/', { country_id, name, code }),
  updateState:       (id, name)   => api.patch(`/config/states/${id}/`, { name }),
  delState:          (id)   => api.delete(`/config/states/${id}/`),
  importStates:      (country_id) => api.post('/config/states/import/', { country_id }),
  // Cidades
  cities:    (state_id) => api.get('/config/cities/', { params: { state_id } }),
  addCity:   (state_id, name) => api.post('/config/cities/', { state_id, name }),
  updateCity: (id, name) => api.patch(`/config/cities/${id}/`, { name }),
  delCity:   (id) => api.delete(`/config/cities/${id}/`),
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
  // Tipos de Acomodação
  accommodations:       ()            => api.get('/config/accommodations/'),
  addAccommodation:     (data)        => api.post('/config/accommodations/', data),
  updateAccommodation:  (id, data)    => api.patch(`/config/accommodations/${id}/`, data),
  delAccommodation:     (id)          => api.delete(`/config/accommodations/${id}/`),
  // Gêneros
  genders:    () => api.get('/config/genders/'),
  addGender:  (name) => api.post('/config/genders/', { name }),
  updateGender: (id, name) => api.patch(`/config/genders/${id}/`, { name }),
  delGender:  (id)   => api.delete(`/config/genders/${id}/`),
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
}

export const usersApi = {
  list:           ()       => api.get('/users/'),
  create:         (data)   => api.post('/users/create/', data),
  update:         (id, d)  => api.patch(`/users/${id}/`, d),
  remove:         (id)     => api.delete(`/users/${id}/delete/`),
  sendInvite:     (id)     => api.post(`/users/${id}/invite/`),
  forgotPassword: (email)  => api.post('/users/forgot-password/', { email }),
  resetPassword:  (token, password) => api.post('/users/reset-password/', { token, password }),
  validateInvite: (token)  => api.get(`/users/invite/validate/?token=${token}`),
  acceptInvite:   (token, password) => api.post('/users/invite/accept/', { token, password }),
}

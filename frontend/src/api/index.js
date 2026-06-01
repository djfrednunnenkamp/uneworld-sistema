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
  checkCpf: (cpf)   => api.get('/passengers/check-cpf/', { params: { cpf } }),
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

export const meetingsApi = {
  list: (params) => api.get('/meetings/', { params }),
  get: (id) => api.get(`/meetings/${id}/`),
  create: (data) => api.post('/meetings/', data),
  update: (id, data) => api.put(`/meetings/${id}/`, data),
  remove: (id) => api.delete(`/meetings/${id}/`),
  upcoming: () => api.get('/meetings/upcoming/'),
}

export const agenciesApi = {
  list:   (params) => api.get('/agencies/', { params }),
  get:    (id)     => api.get(`/agencies/${id}/`),
  create: (data)   => api.post('/agencies/', data),
  update: (id, data) => api.put(`/agencies/${id}/`, data),
  remove: (id)     => api.delete(`/agencies/${id}/`),
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

export const configApi = {
  // Profissões
  professions:       ()     => api.get('/config/professions/'),
  addProfession:     (name) => api.post('/config/professions/', { name }),
  delProfession:     (id)   => api.delete(`/config/professions/${id}/`),
  importProfessions: ()     => api.post('/config/professions/import/'),
  // Idiomas
  languages:         ()     => api.get('/config/languages/'),
  addLanguage:       (name) => api.post('/config/languages/', { name }),
  delLanguage:       (id)   => api.delete(`/config/languages/${id}/`),
  importLanguages:   ()     => api.post('/config/languages/import/'),
  // Países
  countries:         ()     => api.get('/config/countries/'),
  addCountry:        (name, code) => api.post('/config/countries/', { name, code }),
  delCountry:        (id)   => api.delete(`/config/countries/${id}/`),
  importCountries:   ()     => api.post('/config/countries/import/'),
  // Estados
  states:            (country_id) => api.get('/config/states/', { params: { country_id } }),
  addState:          (country_id, name, code) => api.post('/config/states/', { country_id, name, code }),
  delState:          (id)   => api.delete(`/config/states/${id}/`),
  importStates:      (country_id) => api.post('/config/states/import/', { country_id }),
  // Cidades
  cities:    (state_id) => api.get('/config/cities/', { params: { state_id } }),
  addCity:   (state_id, name) => api.post('/config/cities/', { state_id, name }),
  delCity:   (id) => api.delete(`/config/cities/${id}/`),
  // CSV global (países + estados + cidades)
  geoExport: () => api.get('/config/geo/export/', { responseType: 'blob' }),
  geoImport: (formData) => api.post('/config/geo/import/', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
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

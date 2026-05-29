import api from './client'

export const dashboardApi = {
  getStats: () => api.get('/dashboard/'),
}

export const passengersApi = {
  list: (params) => api.get('/passengers/', { params }),
  get: (id) => api.get(`/passengers/${id}/`),
  create: (data) => api.post('/passengers/', data),
  update: (id, data) => api.put(`/passengers/${id}/`, data),
  remove: (id) => api.delete(`/passengers/${id}/`),
  active: () => api.get('/passengers/active/'),
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

export const authApi = {
  login: (username, password) =>
    api.post('/auth/login/', { username, password }),
  logout: () => api.post('/auth/logout/'),
}

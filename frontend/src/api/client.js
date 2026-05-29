import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const csrfToken = document.cookie
    .split(';')
    .find((c) => c.trim().startsWith('csrftoken='))
    ?.split('=')[1]
  if (csrfToken) config.headers['X-CSRFToken'] = csrfToken
  return config
})

export default api

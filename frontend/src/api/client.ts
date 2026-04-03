import axios from 'axios'

const env = (import.meta as unknown as {
  env: Record<string, string | boolean | undefined>
}).env

function normalizeApiOrigin(raw: string): string {
  const value = String(raw || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '')
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('//')) {
    const protocol = typeof window !== 'undefined' ? window.location.protocol : 'https:'
    return `${protocol}${value}`
  }
  const localLike = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(value)
  return `${localLike ? 'http' : 'https'}://${value}`
}

const configuredApiHost = normalizeApiOrigin(String(env.VITE_API_URL || env.VITE_BACKEND_URL || ''))

const isLocalHost =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)

const isDevMode = Boolean(env.DEV) || isLocalHost

const fallbackApiHost = isDevMode
  ? 'http://localhost:8000'
  : 'https://recruitement-ai-backend.vercel.app'

export const API_ORIGIN = normalizeApiOrigin(configuredApiHost || fallbackApiHost)

export const API_BASE_URL = `${API_ORIGIN}/api`

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default api

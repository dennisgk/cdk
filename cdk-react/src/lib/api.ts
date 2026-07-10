import { getAccessToken } from '@/lib/auth'

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? '/api'

type LoginResponse = {
  access_token: string
  expires_at: string
  token_type: 'bearer'
}

type ApiErrorBody = {
  detail?: unknown
}

export function formatApiErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') {
    return detail
  }

  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => formatApiErrorDetail(item))
      .filter(Boolean)
    return parts.join('\n')
  }

  if (detail && typeof detail === 'object') {
    const maybeMessage =
      'message' in detail && typeof detail.message === 'string'
        ? detail.message
        : null
    const maybeErrors =
      'errors' in detail && Array.isArray(detail.errors)
        ? detail.errors
            .map((item) => formatApiErrorDetail(item))
            .filter(Boolean)
        : []

    if (maybeMessage && maybeErrors.length > 0) {
      return `${maybeMessage}\n${maybeErrors.map((item) => `- ${item}`).join('\n')}`
    }
    if (maybeMessage) {
      return maybeMessage
    }
    if (maybeErrors.length > 0) {
      return maybeErrors.join('\n')
    }
  }

  return 'Request failed.'
}

function withAuthHeaders(headers: HeadersInit = {}) {
  const token = getAccessToken()
  return token
    ? {
        ...headers,
        Authorization: `Bearer ${token}`,
      }
    : headers
}

export async function getJson<T>(url: string) {
  const response = await fetch(url, {
    headers: withAuthHeaders(),
  })
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiErrorBody | null
    throw new Error(formatApiErrorDetail(errorBody?.detail))
  }
  return (await response.json()) as T
}

export async function sendJson<T>(
  url: string,
  options: {
    method: 'POST' | 'PUT' | 'PATCH'
    body?: unknown
  },
) {
  const response = await fetch(url, {
    method: options.method,
    headers: withAuthHeaders({
      'Content-Type': 'application/json',
    }),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiErrorBody | null
    throw new Error(formatApiErrorDetail(errorBody?.detail))
  }

  return (await response.json()) as T
}

export async function deleteJson(url: string) {
  const response = await fetch(url, {
    method: 'DELETE',
    headers: withAuthHeaders(),
  })
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiErrorBody | null
    throw new Error(formatApiErrorDetail(errorBody?.detail))
  }
}

export async function loginWithPassword(password: string) {
  return sendJson<LoginResponse>(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    body: { password },
  })
}

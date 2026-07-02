const AUTH_TOKEN_KEY = 'cdk.auth.token'
const AUTH_EXPIRES_AT_KEY = 'cdk.auth.expires_at'

export type StoredSession = {
  token: string
  expiresAt: string
}

function hasWindow() {
  return typeof window !== 'undefined'
}

export function clearSession() {
  if (!hasWindow()) {
    return
  }

  localStorage.removeItem(AUTH_TOKEN_KEY)
  localStorage.removeItem(AUTH_EXPIRES_AT_KEY)
}

export function getStoredSession(): StoredSession | null {
  if (!hasWindow()) {
    return null
  }

  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  const expiresAt = localStorage.getItem(AUTH_EXPIRES_AT_KEY)

  if (!token || !expiresAt) {
    clearSession()
    return null
  }

  const expiresAtDate = new Date(expiresAt)
  if (Number.isNaN(expiresAtDate.getTime()) || expiresAtDate <= new Date()) {
    clearSession()
    return null
  }

  return { token, expiresAt }
}

export function isAuthenticated() {
  return getStoredSession() !== null
}

export function storeSession(session: StoredSession) {
  if (!hasWindow()) {
    return
  }

  localStorage.setItem(AUTH_TOKEN_KEY, session.token)
  localStorage.setItem(AUTH_EXPIRES_AT_KEY, session.expiresAt)
}

export function getAccessToken() {
  return getStoredSession()?.token ?? null
}

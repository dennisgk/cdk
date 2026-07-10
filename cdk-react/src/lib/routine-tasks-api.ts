import { API_BASE_URL, deleteJson, formatApiErrorDetail, getJson, sendJson } from '@/lib/api'
import { getAccessToken } from '@/lib/auth'
import type { RoutineTaskRemoteOptions } from '@/lib/routine-task-jsx'

export type RoutineTaskRecord = {
  name: string
  task_type: 'NEXT_DATETIME_RUNNER'
  python_code: string
  jsx_code: string
  is_paused: boolean
  status: string
  last_error: string | null
  next_run_at: string | null
  requested_next_run_at: string | null
  created_at: string
  updated_at: string
}

export type RoutineTaskListItem = {
  name: string
  task_type: 'NEXT_DATETIME_RUNNER'
  is_paused: boolean
  status: string
  last_error: string | null
  next_run_at: string | null
  requested_next_run_at: string | null
  updated_at: string
}

export type RoutineTaskCreateInput = {
  name: string
  python_code: string
  jsx_code: string
  start_paused: boolean
}

export type RoutineTaskUpdateInput = {
  name: string
  python_code: string
  jsx_code: string
  paused: boolean
}

export function listRoutineTasks() {
  return getJson<RoutineTaskListItem[]>(`${API_BASE_URL}/routine-tasks`)
}

export function getRoutineTask(name: string) {
  return getJson<RoutineTaskRecord>(
    `${API_BASE_URL}/routine-tasks/${encodeURIComponent(name)}`,
  )
}

export function createRoutineTask(payload: RoutineTaskCreateInput) {
  return sendJson<RoutineTaskRecord>(`${API_BASE_URL}/routine-tasks`, {
    method: 'POST',
    body: payload,
  })
}

export function updateRoutineTask(name: string, payload: RoutineTaskUpdateInput) {
  return sendJson<RoutineTaskRecord>(
    `${API_BASE_URL}/routine-tasks/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      body: payload,
    },
  )
}

export function deleteRoutineTask(name: string) {
  return deleteJson(`${API_BASE_URL}/routine-tasks/${encodeURIComponent(name)}`)
}

export function pauseRoutineTask(name: string) {
  return sendJson<RoutineTaskRecord>(
    `${API_BASE_URL}/routine-tasks/${encodeURIComponent(name)}/pause`,
    { method: 'POST' },
  )
}

export function resumeRoutineTask(name: string) {
  return sendJson<RoutineTaskRecord>(
    `${API_BASE_URL}/routine-tasks/${encodeURIComponent(name)}/resume`,
    { method: 'POST' },
  )
}

export async function callRoutineTaskRemote(
  name: string,
  options?: RoutineTaskRemoteOptions,
) {
  const requestUrl = new URL(
    `${API_BASE_URL}/routine-tasks/${encodeURIComponent(name)}/remote`,
    window.location.origin,
  )
  const normalizedPath = options?.path
    ? options.path
        .split('/')
        .filter(Boolean)
        .map((part) => encodeURIComponent(part))
        .join('/')
    : ''
  if (normalizedPath) {
    requestUrl.pathname = `${requestUrl.pathname.replace(/\/$/, '')}/${normalizedPath}`
  }

  if (options?.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) {
        requestUrl.searchParams.set(key, String(value))
      }
    }
  }

  const isJsonObject =
    options?.body !== null &&
    options?.body !== undefined &&
    typeof options.body === 'object' &&
    !(options.body instanceof FormData) &&
    !(options.body instanceof Blob) &&
    !(options.body instanceof URLSearchParams) &&
    !(options.body instanceof ArrayBuffer) &&
    !(options.body instanceof ReadableStream)
  const body: BodyInit | null | undefined = isJsonObject
    ? JSON.stringify(options?.body)
    : (options?.body as BodyInit | null | undefined)
  const response = await fetch(
    requestUrl.toString(),
    {
      method: options?.method,
      body,
      cache: options?.cache,
      credentials: options?.credentials,
      mode: options?.mode,
      redirect: options?.redirect,
      referrer: options?.referrer,
      referrerPolicy: options?.referrerPolicy,
      integrity: options?.integrity,
      keepalive: options?.keepalive,
      signal: options?.signal ?? undefined,
      headers: {
        ...(isJsonObject
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(getAccessToken()
          ? { Authorization: `Bearer ${getAccessToken()}` }
          : {}),
        ...(options?.headers ?? {}),
      },
    },
  )

  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(
      formatApiErrorDetail(error?.detail) || 'Routine task remote call failed.',
    )
  }

  return response.json()
}

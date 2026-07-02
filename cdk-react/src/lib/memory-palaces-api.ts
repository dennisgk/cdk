import { API_BASE_URL, getJson, sendJson } from '@/lib/api'

export type MemoryPalaceRecord = {
  name: string
  description: string
  created_at: string
  updated_at: string
}

export type MemoryPalaceListItem = MemoryPalaceRecord

export type MemoryPalaceCreateInput = {
  name: string
  description: string
}

export type MemoryPalaceUpdateInput = {
  name: string
  description: string
}

export function listMemoryPalaces() {
  return getJson<MemoryPalaceListItem[]>(`${API_BASE_URL}/memory-palaces`)
}

export function getMemoryPalace(name: string) {
  return getJson<MemoryPalaceRecord>(
    `${API_BASE_URL}/memory-palaces/${encodeURIComponent(name)}`,
  )
}

export function createMemoryPalace(payload: MemoryPalaceCreateInput) {
  return sendJson<MemoryPalaceRecord>(`${API_BASE_URL}/memory-palaces`, {
    method: 'POST',
    body: payload,
  })
}

export function updateMemoryPalace(name: string, payload: MemoryPalaceUpdateInput) {
  return sendJson<MemoryPalaceRecord>(
    `${API_BASE_URL}/memory-palaces/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      body: payload,
    },
  )
}

export async function deleteMemoryPalace(name: string) {
  const response = await fetch(`${API_BASE_URL}/memory-palaces/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error('Failed to delete memory palace.')
  }
}

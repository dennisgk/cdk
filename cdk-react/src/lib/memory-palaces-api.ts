import {
  API_BASE_URL,
  deleteJson,
  formatApiErrorDetail,
  getJson,
  sendJson,
  withAuthHeaders,
} from '@/lib/api'

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

export function deleteMemoryPalace(name: string) {
  return deleteJson(`${API_BASE_URL}/memory-palaces/${encodeURIComponent(name)}`)
}

export type MemoryPalaceSceneEditorState = {
  cameraMode: 'perspective' | 'orthographic'
  cameraPosition: [number, number, number]
  cameraTarget: [number, number, number]
}

export type MemoryPalaceSceneFile = {
  schemaVersion: number
  savedAt: string | null
  editor: MemoryPalaceSceneEditorState | null
  scene: {
    objects: unknown[]
  }
}

export type MemoryPalaceAssetInfo = {
  asset_id: string
  file_name: string
  format: 'stl' | 'glb' | 'fbx'
}

export function getMemoryPalaceScene(name: string) {
  return getJson<MemoryPalaceSceneFile>(
    `${API_BASE_URL}/memory-palaces/${encodeURIComponent(name)}/scene`,
  )
}

export function saveMemoryPalaceScene(name: string, payload: MemoryPalaceSceneFile) {
  return sendJson<MemoryPalaceSceneFile>(
    `${API_BASE_URL}/memory-palaces/${encodeURIComponent(name)}/scene`,
    {
      method: 'PUT',
      body: payload,
    },
  )
}

export async function uploadMemoryPalaceAsset(name: string, file: File) {
  const url =
    `${API_BASE_URL}/memory-palaces/${encodeURIComponent(name)}/assets` +
    `?file_name=${encodeURIComponent(file.name)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: withAuthHeaders(),
    body: file,
  })
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      detail?: unknown
    } | null
    throw new Error(formatApiErrorDetail(errorBody?.detail))
  }
  return (await response.json()) as MemoryPalaceAssetInfo
}

export async function fetchMemoryPalaceAsset(name: string, assetId: string) {
  const response = await fetch(
    `${API_BASE_URL}/memory-palaces/${encodeURIComponent(name)}/assets/${encodeURIComponent(assetId)}`,
    {
      headers: withAuthHeaders(),
    },
  )
  if (!response.ok) {
    throw new Error(`Failed to load asset ${assetId}.`)
  }
  return response.arrayBuffer()
}

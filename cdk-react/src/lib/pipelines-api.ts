import { API_BASE_URL, getJson } from '@/lib/api'

export type PipelineTelemetry = {
  pipelines: Array<{
    name: string
    category: string
    description: string
    max_concurrency: number
    queued_count: number
    running_count: number
    completed_jobs: number
    running_jobs: Array<{
      id: string
      label: string
      metadata: Record<string, unknown>
      started_at: string
    }>
  }>
}

export function getPipelineTelemetry() {
  return getJson<PipelineTelemetry>(`${API_BASE_URL}/pipelines`)
}

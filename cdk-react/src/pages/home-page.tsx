import { useEffect, useState } from 'react'

import { getPipelineTelemetry, type PipelineTelemetry } from '@/lib/pipelines-api'

export function HomePage() {
  const [telemetry, setTelemetry] = useState<PipelineTelemetry | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isActive = true
    const load = async () => {
      try {
        const next = await getPipelineTelemetry()
        if (isActive) {
          setTelemetry(next)
          setError(null)
        }
      } catch (loadError) {
        if (isActive) {
          setError(
            loadError instanceof Error ? loadError.message : 'Failed to load telemetry.',
          )
        }
      }
    }

    void load()
    const interval = window.setInterval(() => {
      void load()
    }, 5000)

    return () => {
      isActive = false
      window.clearInterval(interval)
    }
  }, [])

  return (
    <section className="grid min-h-full gap-4 p-2 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Home
        </p>
        <h2 className="mt-3 text-4xl font-semibold tracking-tight">Greetings</h2>
      </div>

      <aside className="border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Pipelines</div>
            <div className="text-xs text-muted-foreground">Queue telemetry</div>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

        <div className="mt-3 flex flex-col gap-3">
          {telemetry?.pipelines.map((pipeline) => (
            <div className="border border-border p-3" key={pipeline.name}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{pipeline.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {pipeline.category}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>Queued: {pipeline.queued_count}</div>
                  <div>Running: {pipeline.running_count}</div>
                  <div>Done: {pipeline.completed_jobs}</div>
                </div>
              </div>

              <p className="mt-2 text-xs text-muted-foreground">
                {pipeline.description}
              </p>

              <div className="mt-3 text-xs text-muted-foreground">
                Max concurrency: {pipeline.max_concurrency}
              </div>

              <div className="mt-3 flex flex-col gap-2">
                {pipeline.running_jobs.length > 0 ? (
                  pipeline.running_jobs.map((job) => (
                    <div className="border border-border p-2 text-xs" key={job.id}>
                      <div className="font-medium">{job.label}</div>
                      <div className="text-muted-foreground">{job.id}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Nothing running.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { usePageBreadcrumbs } from '@/lib/breadcrumbs'
import { listRoutineTasks, type RoutineTaskListItem } from '@/lib/routine-tasks-api'

function capitalizeStatus(status: string) {
  if (!status) {
    return status
  }
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export function RoutineTasksPage() {
  const [tasks, setTasks] = useState<RoutineTaskListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const breadcrumbs = useMemo(() => [], [])
  usePageBreadcrumbs(breadcrumbs)

  useEffect(() => {
    let isActive = true
    listRoutineTasks()
      .then((result) => {
        if (isActive) {
          setTasks(result)
        }
      })
      .catch((loadError) => {
        if (isActive) {
          setError(loadError instanceof Error ? loadError.message : 'Load failed.')
        }
      })
    return () => {
      isActive = false
    }
  }, [])

  return (
    <section className="flex min-h-full flex-col gap-3 p-2">
      <div>
        <Button render={<Link to="/routine-tasks/new" />}>New Routine Task</Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <div
            key={task.name}
            className="flex flex-wrap items-center gap-2 border border-border p-2"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{task.name}</div>
              {task.last_error ? (
                <Dialog>
                  <DialogTrigger
                    title={task.last_error}
                    className="cursor-pointer text-left text-sm text-destructive underline-offset-2 hover:underline"
                  >
                    Failed
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{task.name} traceback</DialogTitle>
                      <DialogDescription>
                        Full Python traceback from the most recent scheduled execution failure.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 overflow-auto border-t border-border p-4">
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                        {task.last_error}
                      </pre>
                    </div>
                  </DialogContent>
                </Dialog>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {task.is_paused ? 'Paused' : capitalizeStatus(task.status)}
                </div>
              )}
            </div>

            <Button
              variant="outline"
              render={<Link to={`/routine-tasks/view/${encodeURIComponent(task.name)}`} />}
            >
              View
            </Button>
            <Button
              variant="outline"
              render={<Link to={`/routine-tasks/edit/${encodeURIComponent(task.name)}`} />}
            >
              Edit
            </Button>
          </div>
        ))}

        {tasks.length === 0 && !error ? (
          <p className="text-sm text-muted-foreground">No routine tasks yet.</p>
        ) : null}
      </div>
    </section>
  )
}

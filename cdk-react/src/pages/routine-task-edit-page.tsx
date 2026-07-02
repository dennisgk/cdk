import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { RoutineTaskForm } from '@/components/routine-task-form'
import { usePageBreadcrumbs } from '@/lib/breadcrumbs'
import {
  deleteRoutineTask,
  getRoutineTask,
  pauseRoutineTask,
  resumeRoutineTask,
  updateRoutineTask,
  type RoutineTaskRecord,
} from '@/lib/routine-tasks-api'

export function RoutineTaskEditPage() {
  const navigate = useNavigate()
  const { name = '' } = useParams()
  const [task, setTask] = useState<RoutineTaskRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  const breadcrumbs = useMemo(
    () => [{ label: `Edit ${decodeURIComponent(name)}` }],
    [name],
  )
  usePageBreadcrumbs(breadcrumbs)

  useEffect(() => {
    let isActive = true
    getRoutineTask(decodeURIComponent(name))
      .then((result) => {
        if (isActive) {
          setTask(result)
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
  }, [name])

  if (error) {
    return <div className="p-2 text-sm text-destructive">{error}</div>
  }

  if (!task) {
    return <div className="p-2 text-sm text-muted-foreground">Loading...</div>
  }

  return (
    <RoutineTaskForm
      initialValues={{
        name: task.name,
        pythonCode: task.python_code,
        jsxCode: task.jsx_code,
        paused: task.is_paused,
      }}
      submitLabel="Save Changes"
      showStartPaused={false}
      onSubmit={async ({ name: nextName, pythonCode, jsxCode }) => {
        const updated = await updateRoutineTask(task.name, {
          name: nextName,
          python_code: pythonCode,
          jsx_code: jsxCode,
          paused: task.is_paused,
        })
        setTask(updated)
        if (updated.name !== task.name) {
          navigate(`/routine-tasks/edit/${encodeURIComponent(updated.name)}`, {
            replace: true,
          })
        }
      }}
      onDelete={async () => {
        await deleteRoutineTask(task.name)
        navigate('/routine-tasks', { replace: true })
      }}
      onPauseToggle={async (nextPaused) => {
        const updated = nextPaused
          ? await pauseRoutineTask(task.name)
          : await resumeRoutineTask(task.name)
        setTask(updated)
      }}
    />
  )
}

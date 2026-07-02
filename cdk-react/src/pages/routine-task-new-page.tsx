import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import { RoutineTaskForm } from '@/components/routine-task-form'
import { usePageBreadcrumbs } from '@/lib/breadcrumbs'
import { createRoutineTask } from '@/lib/routine-tasks-api'

export function RoutineTaskNewPage() {
  const navigate = useNavigate()
  const breadcrumbs = useMemo(() => [{ label: 'New' }], [])
  usePageBreadcrumbs(breadcrumbs)

  return (
    <RoutineTaskForm
      submitLabel="Create Routine Task"
      onSubmit={async ({ name, pythonCode, jsxCode, paused }) => {
        const task = await createRoutineTask({
          name,
          python_code: pythonCode,
          jsx_code: jsxCode,
          start_paused: paused,
        })
        navigate(`/routine-tasks/edit/${encodeURIComponent(task.name)}`)
      }}
    />
  )
}

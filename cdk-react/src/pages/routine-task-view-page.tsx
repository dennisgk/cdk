import { useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import { useParams } from 'react-router-dom'

import { usePageBreadcrumbs } from '@/lib/breadcrumbs'
import {
  compileRoutineTaskJsxModule,
  type RoutineTaskRemoteOptions,
} from '@/lib/routine-task-jsx'
import {
  callRoutineTaskRemote,
  getRoutineTask,
  type RoutineTaskRecord,
} from '@/lib/routine-tasks-api'

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      task: RoutineTaskRecord
      data: unknown
      Component: ComponentType<{
        data: unknown
        task: { name: string }
        callRemote: (options?: RoutineTaskRemoteOptions) => Promise<unknown>
      }>
    }

export function RoutineTaskViewPage() {
  const { name = '' } = useParams()
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const decodedName = decodeURIComponent(name)
  const breadcrumbs = useMemo(
    () => [{ label: `View ${decodedName}` }],
    [decodedName],
  )
  usePageBreadcrumbs(breadcrumbs)

  useEffect(() => {
    let isActive = true
    ;(async () => {
      try {
        const task = await getRoutineTask(decodedName)
        const module = compileRoutineTaskJsxModule(task.jsx_code)
        if (!module.Component) {
          throw new Error('JSX code must export a Component.')
        }

        const callRemote = (options?: RoutineTaskRemoteOptions) =>
          callRoutineTaskRemote(task.name, options)
        const data = module.loader
          ? await module.loader({ task: { name: task.name }, callRemote })
          : null

        if (isActive) {
          setState({
            status: 'ready',
            task,
            data,
            Component: module.Component,
          })
        }
      } catch (loadError) {
        if (isActive) {
          setState({
            status: 'error',
            message:
              loadError instanceof Error ? loadError.message : 'View load failed.',
          })
        }
      }
    })()

    return () => {
      isActive = false
    }
  }, [decodedName])

  if (state.status === 'loading') {
    return <div className="p-2 text-sm text-muted-foreground">Loading...</div>
  }

  if (state.status === 'error') {
    return <div className="p-2 text-sm text-destructive">{state.message}</div>
  }

  const { Component, data, task } = state
  const callRemote = (options?: RoutineTaskRemoteOptions) =>
    callRoutineTaskRemote(task.name, options)

  return (
    <div className="min-h-full w-full p-2">
      <Component data={data} task={{ name: task.name }} callRemote={callRemote} />
    </div>
  )
}

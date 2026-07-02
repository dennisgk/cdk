import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import {
  RoutineTaskEditor,
  type RoutineTaskEditorHandle,
} from '@/components/routine-task-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  defaultRoutineTaskJsxCode,
  defaultRoutineTaskPythonCode,
} from '@/lib/routine-task-defaults'

type RoutineTaskFormProps = {
  initialValues?: {
    name: string
    pythonCode: string
    jsxCode: string
    paused: boolean
  }
  submitLabel: string
  onSubmit: (values: {
    name: string
    pythonCode: string
    jsxCode: string
    paused: boolean
  }) => Promise<void>
  showStartPaused?: boolean
  onDelete?: () => Promise<void>
  onPauseToggle?: (paused: boolean) => Promise<void>
}

export function RoutineTaskForm({
  initialValues,
  submitLabel,
  onSubmit,
  showStartPaused = true,
  onDelete,
  onPauseToggle,
}: RoutineTaskFormProps) {
  const defaults = useMemo(
    () => ({
      name: initialValues?.name ?? '',
      pythonCode: initialValues?.pythonCode ?? defaultRoutineTaskPythonCode,
      jsxCode: initialValues?.jsxCode ?? defaultRoutineTaskJsxCode,
      paused: initialValues?.paused ?? false,
    }),
    [initialValues],
  )

  const [name, setName] = useState(defaults.name)
  const [paused, setPaused] = useState(defaults.paused)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isTogglingPause, setIsTogglingPause] = useState(false)
  const pythonEditorRef = useRef<RoutineTaskEditorHandle | null>(null)
  const jsxEditorRef = useRef<RoutineTaskEditorHandle | null>(null)

  useEffect(() => {
    setName(defaults.name)
    setPaused(defaults.paused)
    pythonEditorRef.current?.setValue(defaults.pythonCode)
    jsxEditorRef.current?.setValue(defaults.jsxCode)
  }, [defaults])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSaving(true)
    try {
      const submittedPythonCode =
        pythonEditorRef.current?.getValue() ?? defaults.pythonCode
      const submittedJsxCode =
        jsxEditorRef.current?.getValue() ?? defaults.jsxCode
      await onSubmit({
        name,
        pythonCode: submittedPythonCode,
        jsxCode: submittedJsxCode,
        paused,
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Save failed.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form className="flex min-h-full flex-col gap-3 p-2" onSubmit={handleSubmit}>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? 'Saving...' : submitLabel}
        </Button>
        {onPauseToggle ? (
          <Button
            type="button"
            variant="outline"
            disabled={isTogglingPause}
            onClick={async () => {
              setError(null)
              setIsTogglingPause(true)
              try {
                const nextPaused = !paused
                await onPauseToggle(nextPaused)
                setPaused(nextPaused)
              } catch (toggleError) {
                setError(
                  toggleError instanceof Error
                    ? toggleError.message
                    : 'Pause toggle failed.',
                )
              } finally {
                setIsTogglingPause(false)
              }
            }}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            type="button"
            variant="outline"
            disabled={isDeleting}
            onClick={async () => {
              setError(null)
              setIsDeleting(true)
              try {
                await onDelete()
              } catch (deleteError) {
                setError(
                  deleteError instanceof Error
                    ? deleteError.message
                    : 'Delete failed.',
                )
              } finally {
                setIsDeleting(false)
              }
            }}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="routine-task-name">
          Name
        </label>
        <Input
          id="routine-task-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          required
        />
      </div>

      {showStartPaused ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={paused}
            onChange={(event) => setPaused(event.target.checked)}
            type="checkbox"
          />
          <span>Start Paused</span>
        </label>
      ) : null}

      <RoutineTaskEditor
        key="python"
        ref={pythonEditorRef}
        label="Python Code"
        language="python"
        initialValue={defaults.pythonCode}
        height={360}
      />

      <RoutineTaskEditor
        key="jsx"
        ref={jsxEditorRef}
        label="JSX Code"
        language="javascript"
        initialValue={defaults.jsxCode}
        height={320}
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  )
}

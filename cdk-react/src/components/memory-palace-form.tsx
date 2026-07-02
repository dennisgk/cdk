import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type MemoryPalaceFormProps = {
  submitLabel: string
  initialValues?: {
    name: string
    description: string
  }
  onSubmit: (values: { name: string; description: string }) => Promise<void>
  onDelete?: () => Promise<void>
}

export function MemoryPalaceForm({
  submitLabel,
  initialValues,
  onSubmit,
  onDelete,
}: MemoryPalaceFormProps) {
  const defaults = initialValues ?? { name: '', description: '' }
  const [name, setName] = useState(defaults.name)
  const [description, setDescription] = useState(defaults.description)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(defaults.name)
    setDescription(defaults.description)
  }, [defaults.description, defaults.name])

  return (
    <form
      className="flex min-h-full flex-col gap-3 p-2"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(null)
        try {
          await onSubmit({ name, description })
        } catch (submitError) {
          setError(
            submitError instanceof Error ? submitError.message : 'Save failed.',
          )
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        {onDelete ? (
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onDelete()
              } catch (deleteError) {
                setError(
                  deleteError instanceof Error
                    ? deleteError.message
                    : 'Delete failed.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            Delete
          </Button>
        ) : null}
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Name</span>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Description</span>
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
    </form>
  )
}

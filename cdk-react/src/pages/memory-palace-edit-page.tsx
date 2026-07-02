import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { MemoryPalaceForm } from '@/components/memory-palace-form'
import { usePageBreadcrumbs } from '@/lib/breadcrumbs'
import {
  deleteMemoryPalace,
  getMemoryPalace,
  updateMemoryPalace,
  type MemoryPalaceRecord,
} from '@/lib/memory-palaces-api'

export function MemoryPalaceEditPage() {
  const navigate = useNavigate()
  const { name = '' } = useParams()
  const decodedName = decodeURIComponent(name)
  const [item, setItem] = useState<MemoryPalaceRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const breadcrumbs = useMemo(
    () => [{ label: `Edit ${decodedName}` }],
    [decodedName],
  )
  usePageBreadcrumbs(breadcrumbs)

  useEffect(() => {
    let isActive = true
    getMemoryPalace(decodedName)
      .then((result) => {
        if (isActive) {
          setItem(result)
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
  }, [decodedName])

  if (error) {
    return <div className="p-2 text-sm text-destructive">{error}</div>
  }

  if (!item) {
    return <div className="p-2 text-sm text-muted-foreground">Loading...</div>
  }

  return (
    <MemoryPalaceForm
      initialValues={{ name: item.name, description: item.description }}
      submitLabel="Save Changes"
      onSubmit={async ({ name: nextName, description }) => {
        const updated = await updateMemoryPalace(item.name, {
          name: nextName,
          description,
        })
        setItem(updated)
        if (updated.name !== item.name) {
          navigate(`/memory-palace/edit/${encodeURIComponent(updated.name)}`, {
            replace: true,
          })
        }
      }}
      onDelete={async () => {
        await deleteMemoryPalace(item.name)
        navigate('/memory-palace', { replace: true })
      }}
    />
  )
}

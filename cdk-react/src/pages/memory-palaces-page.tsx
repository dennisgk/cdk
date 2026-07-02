import { useEffect, useMemo, useState } from 'react'
import { Cuboid, ImageOff } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { usePageBreadcrumbs } from '@/lib/breadcrumbs'
import {
  listMemoryPalaces,
  type MemoryPalaceListItem,
} from '@/lib/memory-palaces-api'

export function MemoryPalacesPage() {
  const [items, setItems] = useState<MemoryPalaceListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const breadcrumbs = useMemo(() => [], [])
  usePageBreadcrumbs(breadcrumbs)

  useEffect(() => {
    let isActive = true
    listMemoryPalaces()
      .then((result) => {
        if (isActive) {
          setItems(result)
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
        <Button render={<Link to="/memory-palace/new" />}>New Memory Palace</Button>
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.name} className="flex items-center gap-3 border border-border p-2">
            <div className="flex size-14 shrink-0 items-center justify-center border border-border text-muted-foreground">
              <ImageOff className="size-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{item.name}</div>
              <div className="text-sm text-muted-foreground">
                {item.description || 'No description.'}
              </div>
            </div>
            <Button
              variant="outline"
              render={<Link to={`/memory-palace/view/${encodeURIComponent(item.name)}`} />}
            >
              View
            </Button>
            <Button
              variant="outline"
              render={<Link to={`/memory-palace/edit/${encodeURIComponent(item.name)}`} />}
            >
              Edit
            </Button>
          </div>
        ))}

        {items.length === 0 && !error ? (
          <div className="flex items-center gap-2 border border-dashed border-border p-3 text-sm text-muted-foreground">
            <Cuboid className="size-4" />
            No memory palaces yet.
          </div>
        ) : null}
      </div>
    </section>
  )
}

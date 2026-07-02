import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import { MemoryPalaceForm } from '@/components/memory-palace-form'
import { usePageBreadcrumbs } from '@/lib/breadcrumbs'
import { createMemoryPalace } from '@/lib/memory-palaces-api'

export function MemoryPalaceNewPage() {
  const navigate = useNavigate()
  const breadcrumbs = useMemo(() => [{ label: 'New' }], [])
  usePageBreadcrumbs(breadcrumbs)

  return (
    <MemoryPalaceForm
      submitLabel="Create Memory Palace"
      onSubmit={async ({ name, description }) => {
        const created = await createMemoryPalace({ name, description })
        navigate(`/memory-palace/edit/${encodeURIComponent(created.name)}`)
      }}
    />
  )
}

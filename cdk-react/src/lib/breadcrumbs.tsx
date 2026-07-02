import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type BreadcrumbItem = {
  label: string
  to?: string
}

type BreadcrumbContextValue = {
  tail: BreadcrumbItem[]
  setTail: (items: BreadcrumbItem[]) => void
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null)

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [tail, setTail] = useState<BreadcrumbItem[]>([])

  const value = useMemo(
    () => ({
      tail,
      setTail,
    }),
    [tail],
  )

  return (
    <BreadcrumbContext.Provider value={value}>
      {children}
    </BreadcrumbContext.Provider>
  )
}

export function usePageBreadcrumbs(items: BreadcrumbItem[]) {
  const context = useContext(BreadcrumbContext)

  useEffect(() => {
    context?.setTail(items)
    return () => context?.setTail([])
  }, [context, items])
}

export function useBreadcrumbContext() {
  const context = useContext(BreadcrumbContext)
  if (!context) {
    throw new Error('useBreadcrumbContext must be used within BreadcrumbProvider.')
  }
  return context
}

import { Link, Outlet, useLocation } from 'react-router-dom'

import { AppSidebar } from '@/components/app-sidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { BreadcrumbProvider, useBreadcrumbContext } from '@/lib/breadcrumbs'
import { getNavigationItem } from '@/lib/navigation'

function AppShellFrame() {
  const location = useLocation()
  const activeItem = getNavigationItem(location.pathname)
  const { tail } = useBreadcrumbContext()
  const breadcrumbs = [
    ...(activeItem ? [{ label: activeItem.title, to: activeItem.path }] : []),
    ...tail,
  ]

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
          <SidebarTrigger />
          <div className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto">
            <div className="flex min-w-max items-center gap-2 whitespace-nowrap text-sm">
              {breadcrumbs.map((breadcrumb, index) => (
                <div className="flex items-center gap-2" key={`${breadcrumb.label}-${index}`}>
                  {breadcrumb.to && index !== breadcrumbs.length - 1 ? (
                    <Link className="text-muted-foreground hover:text-foreground" to={breadcrumb.to}>
                      {breadcrumb.label}
                    </Link>
                  ) : (
                    <span className={index === breadcrumbs.length - 1 ? 'font-medium' : 'text-muted-foreground'}>
                      {breadcrumb.label}
                    </span>
                  )}
                  {index !== breadcrumbs.length - 1 ? (
                    <span className="text-muted-foreground">/</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export function AppShell() {
  return (
    <BreadcrumbProvider>
      <AppShellFrame />
    </BreadcrumbProvider>
  )
}

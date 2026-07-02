import { useLocation, useNavigate, NavLink } from 'react-router-dom'
import { LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { clearSession } from '@/lib/auth'
import { bottomNavigationItems, navigationItems } from '@/lib/navigation'

function isItemActive(pathname: string, itemPath: string) {
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

export function AppSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const homeItem = navigationItems.find((item) => item.path === '/home')
  const secondaryItems = navigationItems.filter((item) => item.path !== '/home')
  const signOut = () => {
    clearSession()
    navigate('/login', { replace: true })
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-2 py-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        {homeItem ? (
          <SidebarMenu className="group-data-[collapsible=icon]:items-center">
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<NavLink to={homeItem.path} end />}
                isActive={isItemActive(location.pathname, homeItem.path)}
                tooltip={homeItem.title}
              >
                <homeItem.icon />
                <span>{homeItem.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : null}
      </SidebarHeader>

      <SidebarContent className="px-2 py-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <SidebarGroup className="group-data-[collapsible=icon]:p-0">
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="group-data-[collapsible=icon]:items-center">
              {[...secondaryItems, ...bottomNavigationItems].map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    render={<NavLink to={item.path} end={item.path === '/home'} />}
                    isActive={isItemActive(location.pathname, item.path)}
                    tooltip={item.title}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-3 py-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <Button
          className="w-full group-data-[collapsible=icon]:hidden"
          variant="outline"
          onClick={signOut}
        >
          Sign out
        </Button>
        <Button
          className="hidden group-data-[collapsible=icon]:inline-flex"
          variant="outline"
          size="icon"
          onClick={signOut}
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut />
        </Button>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

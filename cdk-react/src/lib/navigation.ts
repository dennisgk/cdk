import type { LucideIcon } from 'lucide-react'
import {
  AudioLines,
  BellRing,
  BookOpenText,
  CalendarDays,
  Castle,
  ClipboardList,
  HardDrive,
  House,
  KeyRound,
  MessageSquareText,
  NotebookPen,
  PencilRuler,
  Timer,
} from 'lucide-react'

export type NavigationItem = {
  title: string
  path: string
  icon: LucideIcon
}

export const navigationItems: NavigationItem[] = [
  { title: 'Home', path: '/home', icon: House },
  { title: 'Chat', path: '/chat', icon: MessageSquareText },
  { title: 'Notes', path: '/notes', icon: NotebookPen },
  { title: 'Storage', path: '/storage', icon: HardDrive },
  { title: 'Pomodoro', path: '/pomodoro', icon: Timer },
  { title: 'Memory Palace', path: '/memory-palace', icon: Castle },
  { title: 'Calendar', path: '/calendar', icon: CalendarDays },
  { title: 'Passwords', path: '/passwords', icon: KeyRound },
  { title: 'Study Notes', path: '/study-notes', icon: BookOpenText },
  { title: 'Text Draw', path: '/text-draw', icon: PencilRuler },
  { title: 'Audio Journal', path: '/audio-journal', icon: AudioLines },
  { title: 'Notify', path: '/notify', icon: BellRing },
]

export const bottomNavigationItems: NavigationItem[] = [
  { title: 'Routine Tasks', path: '/routine-tasks', icon: ClipboardList },
]

export function getNavigationItem(pathname: string) {
  const items = [...navigationItems, ...bottomNavigationItems]
  return (
    items.find((item) => item.path === pathname) ??
    items.find((item) => pathname.startsWith(`${item.path}/`))
  )
}

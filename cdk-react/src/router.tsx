import { createBrowserRouter, redirect } from 'react-router-dom'

import { isAuthenticated } from '@/lib/auth'
import { AppShell } from '@/layouts/app-shell'
import { HomePage } from '@/pages/home-page'
import { LoginPage } from '@/pages/login-page'
import { MemoryPalaceEditPage } from '@/pages/memory-palace-edit-page'
import { MemoryPalaceNewPage } from '@/pages/memory-palace-new-page'
import { MemoryPalacesPage } from '@/pages/memory-palaces-page'
import { MemoryPalaceViewPage } from '@/pages/memory-palace-view-page'
import { PlaceholderPage } from '@/pages/placeholder-page'
import { RoutineTaskEditPage } from '@/pages/routine-task-edit-page'
import { RoutineTaskNewPage } from '@/pages/routine-task-new-page'
import { RoutineTasksPage } from '@/pages/routine-tasks-page'
import { RoutineTaskViewPage } from '@/pages/routine-task-view-page'

function redirectToHomeOrLogin() {
  return redirect(isAuthenticated() ? '/home' : '/login')
}

function requireAuth() {
  if (!isAuthenticated()) {
    return redirect('/login')
  }

  return null
}

function redirectAuthenticatedUsers() {
  if (isAuthenticated()) {
    return redirect('/home')
  }

  return null
}

export const router = createBrowserRouter([
  {
    path: '/',
    loader: redirectToHomeOrLogin,
  },
  {
    path: '/login',
    loader: redirectAuthenticatedUsers,
    element: <LoginPage />,
  },
  {
    path: '/',
    loader: requireAuth,
    element: <AppShell />,
    children: [
      {
        path: 'home',
        element: <HomePage />,
      },
      {
        path: 'chat',
        element: <PlaceholderPage title="Chat" />,
      },
      {
        path: 'notes',
        element: <PlaceholderPage title="Notes" />,
      },
      {
        path: 'storage',
        element: <PlaceholderPage title="Storage" />,
      },
      {
        path: 'pomodoro',
        element: <PlaceholderPage title="Pomodoro" />,
      },
      {
        path: 'memory-palace',
        element: <MemoryPalacesPage />,
      },
      {
        path: 'memory-palace/new',
        element: <MemoryPalaceNewPage />,
      },
      {
        path: 'memory-palace/edit/:name',
        element: <MemoryPalaceEditPage />,
      },
      {
        path: 'memory-palace/view/:name',
        element: <MemoryPalaceViewPage />,
      },
      {
        path: 'calendar',
        element: <PlaceholderPage title="Calendar" />,
      },
      {
        path: 'passwords',
        element: <PlaceholderPage title="Passwords" />,
      },
      {
        path: 'study-notes',
        element: <PlaceholderPage title="Study Notes" />,
      },
      {
        path: 'text-draw',
        element: <PlaceholderPage title="Text Draw" />,
      },
      {
        path: 'audio-journal',
        element: <PlaceholderPage title="Audio Journal" />,
      },
      {
        path: 'notify',
        element: <PlaceholderPage title="Notify" />,
      },
      {
        path: 'routine-tasks',
        element: <RoutineTasksPage />,
      },
      {
        path: 'routine-tasks/new',
        element: <RoutineTaskNewPage />,
      },
      {
        path: 'routine-tasks/edit/:name',
        element: <RoutineTaskEditPage />,
      },
      {
        path: 'routine-tasks/view/:name',
        element: <RoutineTaskViewPage />,
      },
    ],
  },
  {
    path: '*',
    loader: redirectToHomeOrLogin,
  },
])

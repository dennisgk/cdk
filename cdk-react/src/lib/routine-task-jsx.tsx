import * as Babel from '@babel/standalone'
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'

import * as ButtonModule from '@/components/ui/button'
import * as DialogModule from '@/components/ui/dialog'
import * as InputModule from '@/components/ui/input'
import * as SeparatorModule from '@/components/ui/separator'
import * as SheetModule from '@/components/ui/sheet'
import * as SidebarModule from '@/components/ui/sidebar'
import * as SkeletonModule from '@/components/ui/skeleton'
import * as TooltipModule from '@/components/ui/tooltip'
import * as UtilsModule from '@/lib/utils'

export type RoutineTaskRemoteOptions = {
  path?: string
  query?: Record<string, string | number | boolean | null | undefined>
  method?: string
  body?: BodyInit | Record<string, unknown> | null
  headers?: HeadersInit
  cache?: RequestCache
  credentials?: RequestCredentials
  mode?: RequestMode
  redirect?: RequestRedirect
  referrer?: string
  referrerPolicy?: ReferrerPolicy
  integrity?: string
  keepalive?: boolean
  signal?: AbortSignal | null
}

type RoutineTaskJsxModule = {
  loader?: (context: {
    task: { name: string }
    callRemote: (options?: RoutineTaskRemoteOptions) => Promise<unknown>
  }) => Promise<unknown>
  Component?: React.ComponentType<{
    data: unknown
    task: { name: string }
    callRemote: (options?: RoutineTaskRemoteOptions) => Promise<unknown>
  }>
}

export function compileRoutineTaskJsxModule(code: string): RoutineTaskJsxModule {
  const transformed = Babel.transform(code, {
    filename: 'routine-task.jsx',
    presets: [['react', { runtime: 'automatic' }]],
    plugins: ['transform-modules-commonjs'],
  }).code

  const module = { exports: {} as RoutineTaskJsxModule }
  const supportedModules: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': ReactJsxRuntime,
    '@/components/ui/button': ButtonModule,
    '@/components/ui/dialog': DialogModule,
    '@/components/ui/input': InputModule,
    '@/components/ui/separator': SeparatorModule,
    '@/components/ui/sheet': SheetModule,
    '@/components/ui/sidebar': SidebarModule,
    '@/components/ui/skeleton': SkeletonModule,
    '@/components/ui/tooltip': TooltipModule,
    '@/lib/utils': UtilsModule,
  }
  const requireShim = (specifier: string) => {
    if (specifier in supportedModules) {
      return supportedModules[specifier]
    }
    throw new Error(`Unsupported import in routine task JSX: ${specifier}`)
  }

  const evaluator = new Function(
    'module',
    'exports',
    'require',
    'React',
    transformed ?? '',
  )
  evaluator(module, module.exports, requireShim, React)
  return module.exports
}

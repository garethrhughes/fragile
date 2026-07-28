'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { AppInitialiser } from '@/components/layout/app-initialiser'

interface ClientShellProps {
  children: ReactNode
}

/** Paths that render without the sidebar/shell chrome (full-bleed). */
const CHROMELESS_PATHS = ['/login']

export function ClientShell({ children }: ClientShellProps) {
  const pathname = usePathname()
  const isChromeless = CHROMELESS_PATHS.some((p) => pathname.startsWith(p))

  if (isChromeless) {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <AppInitialiser />
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden bg-surface">
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Target, Map, Settings, Timer, AlertCircle, Sun, Moon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useDarkMode } from '@/hooks/use-dark-mode'

interface NavItem {
  label: string
  href: string
  icon: ReactNode
}

const MAIN_NAV_ITEMS: NavItem[] = [
  { label: 'DORA', href: '/dora', icon: <BarChart3 className="h-5 w-5" /> },
  { label: 'Cycle Time', href: '/cycle-time', icon: <Timer className="h-5 w-5" /> },
  { label: 'Planning', href: '/planning', icon: <Target className="h-5 w-5" /> },
  { label: 'Roadmap', href: '/roadmap', icon: <Map className="h-5 w-5" /> },
  { label: 'Gaps', href: '/gaps', icon: <AlertCircle className="h-5 w-5" /> },
]

const SETTINGS_ITEM: NavItem = {
  label: 'Settings',
  href: '/settings',
  icon: <Settings className="h-5 w-5" />,
}

export function Sidebar() {
  const pathname = usePathname()
  const { dark, toggle: toggleDark } = useDarkMode()

  const settingsActive = pathname.startsWith(SETTINGS_ITEM.href)

  return (
    <aside className="flex h-screen w-60 flex-shrink-0 flex-col bg-surface-brand border-r border-border">
      {/* Brand */}
      <div className="flex items-center gap-2 px-5 py-6">
        <BarChart3 className="h-7 w-7 text-squirrel-500" />
        <span className="text-lg font-bold tracking-tight text-text-primary">Fragile</span>
      </div>

      {/* Main navigation — scrollable, takes remaining space */}
      <nav className="flex-1 overflow-y-auto space-y-1 px-3">
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
          Navigation
        </p>
        {MAIN_NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-surface-active text-squirrel-700'
                  : 'text-text-secondary hover:bg-surface-raised'
              }`}
            >
              <span className={active ? 'text-squirrel-500' : 'text-text-muted'}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom pinned section — settings */}
      <div className="border-t border-border px-3 pb-4 pt-3">
        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={toggleDark}
          className="mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-raised"
        >
          <span className="text-text-muted">
            {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </span>
          {dark ? 'Light Mode' : 'Dark Mode'}
        </button>

        {/* Settings link */}
        <Link
          href={SETTINGS_ITEM.href}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            settingsActive
              ? 'bg-surface-active text-squirrel-700'
              : 'text-text-secondary hover:bg-surface-raised'
          }`}
        >
          <span className={settingsActive ? 'text-squirrel-500' : 'text-text-muted'}>
            {SETTINGS_ITEM.icon}
          </span>
          {SETTINGS_ITEM.label}
        </Link>
      </div>
    </aside>
  )
}

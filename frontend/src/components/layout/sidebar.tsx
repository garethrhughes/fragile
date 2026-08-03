'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Target, Map, Settings, Timer, AlertCircle, Sun, Moon, Headphones, Activity, LogOut, Users, KeyRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { useDarkMode } from '@/hooks/use-dark-mode'
import { useAuth } from '@/hooks/use-auth'
import { postLogout } from '@/lib/api'

interface NavItem {
  label: string
  href: string
  icon: ReactNode
}

/**
 * Main navigation, grouped. Each inner array is a section; sections are
 * rendered with a divider between them.
 */
const NAV_GROUPS: NavItem[][] = [
  [
    { label: 'Healthcheck', href: '/healthcheck', icon: <Activity className="h-5 w-5" /> },
  ],
  [
    { label: 'DORA', href: '/dora', icon: <BarChart3 className="h-5 w-5" /> },
    { label: 'Cycle Time', href: '/cycle-time', icon: <Timer className="h-5 w-5" /> },
  ],
  [
    { label: 'Planning', href: '/planning', icon: <Target className="h-5 w-5" /> },
    { label: 'Roadmap', href: '/roadmap', icon: <Map className="h-5 w-5" /> },
    { label: 'Support', href: '/support', icon: <Headphones className="h-5 w-5" /> },
    { label: 'Gaps', href: '/gaps', icon: <AlertCircle className="h-5 w-5" /> },
  ],
  [
    { label: 'API Keys', href: '/api-keys', icon: <KeyRound className="h-5 w-5" /> },
  ],
]

const SETTINGS_ITEM: NavItem = {
  label: 'Settings',
  href: '/settings',
  icon: <Settings className="h-5 w-5" />,
}

const USERS_ITEM: NavItem = {
  label: 'Users',
  href: '/users',
  icon: <Users className="h-5 w-5" />,
}

export function Sidebar() {
  const pathname = usePathname()
  const { dark, toggle: toggleDark } = useDarkMode()
  const { user, isAdmin } = useAuth()

  const settingsActive = pathname.startsWith(SETTINGS_ITEM.href)
  const usersActive = pathname.startsWith(USERS_ITEM.href)

  const handleSignOut = async () => {
    try {
      await postLogout()
    } catch {
      // Proceed with redirect even if logout request fails
    }
    window.location.href = '/login'
  }

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '?'

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
        {NAV_GROUPS.map((group, groupIndex) => (
          <div key={groupIndex} className="space-y-1">
            {groupIndex > 0 && (
              <div className="my-2 border-t border-border" role="separator" />
            )}
            {group.map((item) => {
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
          </div>
        ))}
      </nav>

      {/* Bottom pinned section — settings + user */}
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

        {/* Settings link — admin only */}
        {isAdmin && (
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
        )}

        {/* Users link — admin only */}
        {isAdmin && (
          <Link
            href={USERS_ITEM.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              usersActive
                ? 'bg-surface-active text-squirrel-700'
                : 'text-text-secondary hover:bg-surface-raised'
            }`}
          >
            <span className={usersActive ? 'text-squirrel-500' : 'text-text-muted'}>
              {USERS_ITEM.icon}
            </span>
            {USERS_ITEM.label}
          </Link>
        )}

        {/* User section */}
        {user && (
          <div className="mt-3 flex items-center gap-3 rounded-lg px-3 py-2.5">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                referrerPolicy="no-referrer"
                className="h-8 w-8 rounded-full"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-squirrel-100 text-xs font-semibold text-squirrel-700">
                {initials}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">{user.name}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign out"
              className="text-text-muted transition-colors hover:text-red-500"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

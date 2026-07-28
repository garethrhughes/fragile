'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3 } from 'lucide-react'
import { getAuthMe, ApiError } from '@/lib/api'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export default function LoginPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    getAuthMe()
      .then(() => {
        router.replace('/')
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          // Not logged in — show login page
        }
      })
      .finally(() => {
        setChecking(false)
      })
  }, [router])

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-squirrel-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-8 w-8 text-squirrel-500" />
            <span className="text-2xl font-bold tracking-tight text-foreground">Fragile</span>
          </div>
          <p className="text-sm text-muted">Engineering Metrics Dashboard</p>
        </div>

        {/* Sign in button */}
        <a
          href={`${API_URL}/api/auth/google`}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-surface-alt px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-interactive-hover-bg"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Sign in with Google
        </a>

        <p className="mt-6 text-center text-xs text-muted">
          Restricted to organisation members only
        </p>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3 } from 'lucide-react'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || ''

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  async function handleSuccess(credentialResponse: { credential?: string }) {
    if (!credentialResponse.credential) {
      setError('No credential received from Google')
      return
    }

    try {
      const res = await fetch(`${API_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credential: credentialResponse.credential }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.message || `Login failed (${res.status})`)
        return
      }

      router.replace('/')
    } catch {
      setError('Network error — could not reach the server')
    }
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
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

          {/* Google Sign-In */}
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={handleSuccess}
              onError={() => setError('Google sign-in failed')}
              size="large"
              width={280}
              text="signin_with"
            />
          </div>

          {error && (
            <p className="mt-4 text-center text-sm text-red-600">{error}</p>
          )}

          <p className="mt-6 text-center text-xs text-muted">
            Restricted to organisation members only
          </p>
        </div>
      </div>
    </GoogleOAuthProvider>
  )
}

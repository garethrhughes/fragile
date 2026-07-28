'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAuthMe, ApiError, type AuthUser } from '@/lib/api'

export function useAuth() {
  const router = useRouter()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAuthMe()
      .then((data) => {
        setUser(data)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login')
        }
        setUser(null)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [router])

  return {
    user,
    loading,
    isAdmin: user?.role === 'admin',
  }
}

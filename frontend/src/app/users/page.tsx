'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Shield, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { getUsers, updateUserRole, type UserListItem } from '@/lib/api'

export default function UsersPage() {
  const router = useRouter()
  const { loading: authLoading, isAdmin } = useAuth()
  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin) {
      router.replace('/')
      return
    }
    getUsers()
      .then((data) => {
        setUsers(data)
        setError(null)
      })
      .catch(() => setError('Failed to load users'))
      .finally(() => setLoading(false))
  }, [authLoading, isAdmin, router])

  const handleRoleChange = useCallback(
    async (userId: string, newRole: 'user' | 'admin') => {
      setUpdatingId(userId)
      try {
        const updated = await updateUserRole(userId, newRole)
        setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)))
        setError(null)
      } catch {
        setError('Failed to update user role')
      } finally {
        setUpdatingId(null)
      }
    },
    [],
  )

  if (authLoading || (!isAdmin && !loading)) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="mt-1 text-sm text-muted">
          Manage team access — all users who have signed in are listed below
        </p>
      </div>

      {/* User list card */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        {error && (
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </div>
        ) : users.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted">
            No users have signed in yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-table-header-bg">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    Last sign in
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-interactive-hover-bg">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {user.avatarUrl ? (
                          <img
                            src={user.avatarUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-8 w-8 rounded-full"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-alt text-xs font-semibold text-muted">
                            {user.name
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .toUpperCase()
                              .slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-foreground">{user.name}</div>
                          <div className="text-xs text-muted">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {user.role === 'admin' ? (
                          <ShieldCheck className="h-4 w-4 text-squirrel-500" />
                        ) : (
                          <Shield className="h-4 w-4 text-muted" />
                        )}
                        <select
                          value={user.role}
                          disabled={updatingId === user.id}
                          onChange={(e) =>
                            handleRoleChange(user.id, e.target.value as 'user' | 'admin')
                          }
                          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground transition-colors focus:border-squirrel-400 focus:outline-none focus:ring-1 focus:ring-squirrel-400 disabled:opacity-50"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                        {updatingId === user.id && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

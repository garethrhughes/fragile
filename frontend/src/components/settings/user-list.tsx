'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Users } from 'lucide-react'
import { getUsers, updateUserRole, type UserListItem } from '@/lib/api'

export function UserList() {
  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  useEffect(() => {
    getUsers()
      .then((data) => {
        setUsers(data)
        setError(null)
      })
      .catch(() => {
        setError('Failed to load users')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  const handleRoleChange = useCallback(async (userId: string, newRole: 'user' | 'admin') => {
    setUpdatingId(userId)
    try {
      const updated = await updateUserRole(userId, newRole)
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)))
    } catch {
      setError('Failed to update user role')
    } finally {
      setUpdatingId(null)
    }
  }, [])

  if (loading) {
    return (
      <section className="rounded-xl border border-border bg-surface-raised p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-text-muted" />
          <h2 className="text-lg font-semibold text-text-primary">User Management</h2>
        </div>
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-surface-raised p-6">
      <div className="flex items-center gap-2 mb-4">
        <Users className="h-5 w-5 text-text-muted" />
        <h2 className="text-lg font-semibold text-text-primary">User Management</h2>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-600">{error}</p>
      )}

      {users.length === 0 ? (
        <p className="text-sm text-text-muted">No users found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-3 pr-4 font-medium text-text-muted">Email</th>
                <th className="pb-3 pr-4 font-medium text-text-muted">Name</th>
                <th className="pb-3 pr-4 font-medium text-text-muted">Role</th>
                <th className="pb-3 font-medium text-text-muted">Last Login</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 text-text-primary">{user.email}</td>
                  <td className="py-3 pr-4 text-text-primary">{user.name}</td>
                  <td className="py-3 pr-4">
                    <select
                      value={user.role}
                      disabled={updatingId === user.id}
                      onChange={(e) => handleRoleChange(user.id, e.target.value as 'user' | 'admin')}
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm text-text-primary focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                    {updatingId === user.id && (
                      <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-text-muted" />
                    )}
                  </td>
                  <td className="py-3 text-text-muted">
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleDateString()
                      : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

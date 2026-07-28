'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, KeyRound, Copy, Check, Trash2 } from 'lucide-react'
import {
  getApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKeyMetadata,
  type CreatedApiKey,
} from '@/lib/api'

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const load = useCallback(() => {
    getApiKeys()
      .then((data) => {
        setKeys(data)
        setError(null)
      })
      .catch(() => setError('Failed to load API keys'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const key = await createApiKey(newName.trim())
      setCreated(key)
      setNewName('')
      setCopied(false)
      load()
    } catch {
      setError('Failed to create API key')
    } finally {
      setCreating(false)
    }
  }, [newName, load])

  const handleCopy = useCallback(async () => {
    if (!created) return
    await navigator.clipboard.writeText(created.rawKey)
    setCopied(true)
  }, [created])

  const handleRevoke = useCallback(
    async (id: string) => {
      setRevokingId(id)
      try {
        await revokeApiKey(id)
        setKeys((prev) => prev.filter((k) => k.id !== id))
      } catch {
        setError('Failed to revoke API key')
      } finally {
        setRevokingId(null)
      }
    },
    [],
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">API Keys</h1>
        <p className="mt-1 text-sm text-muted">
          Generate a personal API key to access the API programmatically (e.g. the MCP
          server). Keys carry your access level and are shown only once.
        </p>
      </div>

      {/* Create */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1.5 block text-sm font-medium">Key name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. MCP on my laptop"
              maxLength={100}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-squirrel-400 focus:outline-none focus:ring-1 focus:ring-squirrel-400"
            />
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="flex items-center gap-2 rounded-lg bg-squirrel-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-squirrel-600 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Generate key
          </button>
        </div>

        {/* One-time key reveal */}
        {created && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
            <p className="text-sm font-medium text-green-800">
              Key created — copy it now. You won&apos;t be able to see it again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-white px-3 py-2 font-mono text-xs text-gray-800">
                {created.rawKey}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-interactive-hover-bg"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* List */}
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
        ) : keys.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted">
            No API keys yet. Generate one above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-table-header-bg">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">Created</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">Last used</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {keys.map((key) => (
                  <tr key={key.id} className="hover:bg-interactive-hover-bg">
                    <td className="px-4 py-3 font-medium text-foreground">{key.name}</td>
                    <td className="px-4 py-3 text-muted">
                      {new Date(key.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleRevoke(key.id)}
                        disabled={revokingId === key.id}
                        title="Revoke"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                      >
                        {revokingId === key.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Revoke
                      </button>
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

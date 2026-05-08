'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, FileBarChart2 } from 'lucide-react'
import { listCustomReports, type CustomReportSummary } from '@/lib/api'
import { EmptyState } from '@/components/ui/empty-state'

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; reports: CustomReportSummary[] }

export default function CustomReportsIndexPage() {
  const [state, setState] = useState<PageState>({ status: 'loading' })

  useEffect(() => {
    listCustomReports()
      .then((reports) => setState({ status: 'ready', reports }))
      .catch((err: unknown) =>
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
      )
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Custom Reports</h1>
        <p className="mt-1 text-sm text-muted">
          Reports created via the API or MCP server.
        </p>
      </div>

      {state.status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading reports…
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {state.message}
        </div>
      )}

      {state.status === 'ready' && state.reports.length === 0 && (
        <EmptyState
          title="No custom reports"
          message="Create a report using the API or the MCP server tools."
        />
      )}

      {state.status === 'ready' && state.reports.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.reports.map((report) => (
            <Link
              key={report.id}
              href={`/reports/${encodeURIComponent(report.slug)}`}
              className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary"
            >
              <div className="flex items-start gap-3">
                <FileBarChart2 className="mt-0.5 h-5 w-5 shrink-0 text-muted group-hover:text-primary" />
                <div>
                  <p className="font-semibold leading-snug">{report.title}</p>
                  <p className="mt-0.5 text-xs font-mono text-muted">{report.slug}</p>
                </div>
              </div>
              {report.description && (
                <p className="line-clamp-2 text-sm text-muted">{report.description}</p>
              )}
              <p className="mt-auto text-xs text-muted">
                Updated {new Date(report.updatedAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

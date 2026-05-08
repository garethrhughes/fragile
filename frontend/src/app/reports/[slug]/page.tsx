'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { getCustomReport, type CustomReport } from '@/lib/api'
import { CustomReportView } from '@/components/custom-reports/CustomReportView'

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; report: CustomReport }

export default function CustomReportPage() {
  const params = useParams()
  const slug = typeof params.slug === 'string' ? params.slug : Array.isArray(params.slug) ? params.slug[0] : ''
  const [state, setState] = useState<PageState>({ status: 'loading' })

  useEffect(() => {
    if (!slug) return
    getCustomReport(slug)
      .then((report) => setState({ status: 'ready', report }))
      .catch((err: unknown) =>
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
      )
  }, [slug])

  return (
    <div className="space-y-6">
      {state.status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading report…
        </div>
      )}

      {state.status === 'error' && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {state.message}
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <div>
            <h1 className="text-2xl font-bold">{state.report.title}</h1>
            {state.report.description && (
              <p className="mt-1 text-sm text-muted">{state.report.description}</p>
            )}
          </div>
          <CustomReportView report={state.report} />
        </>
      )}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { HelpCircle, X } from 'lucide-react'

export interface MetricDefinition {
  name: string
  description: string
  formula?: string
  bands?: { label: string; threshold: string }[]
}

interface MetricHelpProps {
  title?: string
  metrics: MetricDefinition[]
}

export function MetricHelp({ title = 'How metrics are calculated', metrics }: MetricHelpProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKey)
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={buttonRef}
        type="button"
        aria-label="How metrics are calculated"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-interactive-hover-bg hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-border"
      >
        <HelpCircle className="h-4 w-4" />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={title}
          className="absolute left-0 top-7 z-50 w-80 rounded-xl border border-border bg-card shadow-lg sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">{title}</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-muted hover:bg-interactive-hover-bg hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
            <dl className="space-y-4">
              {metrics.map((m) => (
                <div key={m.name}>
                  <dt className="text-sm font-semibold">{m.name}</dt>
                  <dd className="mt-0.5 text-xs text-muted">{m.description}</dd>
                  {m.formula && (
                    <dd className="mt-1 rounded bg-interactive-hover-bg px-2 py-1 font-mono text-xs">
                      {m.formula}
                    </dd>
                  )}
                  {m.bands && m.bands.length > 0 && (
                    <dd className="mt-1.5">
                      <ul className="space-y-0.5">
                        {m.bands.map((b) => (
                          <li key={b.label} className="flex items-baseline gap-1.5 text-xs">
                            <span className="font-medium">{b.label}:</span>
                            <span className="text-muted">{b.threshold}</span>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </span>
  )
}

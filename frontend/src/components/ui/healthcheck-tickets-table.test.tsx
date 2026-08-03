import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { HealthcheckTicketsTable } from './healthcheck-tickets-table'
import type { HealthcheckTicket } from '@/lib/api'

function ticket(overrides: Partial<HealthcheckTicket> & { key: string }): HealthcheckTicket {
  return {
    summary: `Summary of ${overrides.key}`,
    boardId: 'ACC',
    boardType: 'scrum',
    issueType: 'Story',
    status: 'In Progress',
    planned: false,
    onRoadmap: false,
    support: false,
    jiraUrl: '',
    ...overrides,
  }
}

describe('HealthcheckTicketsTable', () => {
  it('renders a row per ticket and a count header', () => {
    render(
      <HealthcheckTicketsTable
        tickets={[ticket({ key: 'ACC-1' }), ticket({ key: 'ACC-2' })]}
      />,
    )
    expect(screen.getByText('Included tickets (2)')).toBeInTheDocument()
    expect(screen.getByText('ACC-1')).toBeInTheDocument()
    expect(screen.getByText('ACC-2')).toBeInTheDocument()
  })

  it('renders the key as a Jira link when jiraUrl is present', () => {
    render(
      <HealthcheckTicketsTable
        tickets={[ticket({ key: 'ACC-1', jiraUrl: 'https://jira.example/browse/ACC-1' })]}
      />,
    )
    const link = screen.getByRole('link', { name: /ACC-1/ })
    expect(link).toHaveAttribute('href', 'https://jira.example/browse/ACC-1')
  })

  it('shows a tick for flagged dimensions and a dash otherwise', () => {
    render(
      <HealthcheckTicketsTable
        tickets={[ticket({ key: 'ACC-1', planned: true, onRoadmap: false, support: true })]}
      />,
    )
    const row = screen.getByText('ACC-1').closest('tr')!
    const yes = within(row).getAllByLabelText('yes')
    const no = within(row).getAllByLabelText('no')
    // planned + support = 2 ticks; onRoadmap = 1 dash.
    expect(yes).toHaveLength(2)
    expect(no).toHaveLength(1)
  })

  it('renders an empty state when there are no tickets', () => {
    render(<HealthcheckTicketsTable tickets={[]} />)
    expect(screen.getByText('Included tickets (0)')).toBeInTheDocument()
    expect(screen.getByText('No data available')).toBeInTheDocument()
  })
})

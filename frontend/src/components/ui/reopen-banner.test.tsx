import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReopenBanner } from './reopen-banner'

describe('ReopenBanner (proposal 0054 AC F)', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<ReopenBanner count={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when count is negative (defensive)', () => {
    const { container } = render(<ReopenBanner count={-5} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders singular copy when count is 1', () => {
    render(<ReopenBanner count={1} />)
    expect(screen.getByTestId('reopen-banner')).toBeInTheDocument()
    expect(screen.getByText(/1 issue reopened/)).toBeInTheDocument()
    // Plural form must NOT appear.
    expect(screen.queryByText(/1 issues reopened/)).not.toBeInTheDocument()
  })

  it('renders plural copy when count is greater than 1', () => {
    render(<ReopenBanner count={4} />)
    expect(screen.getByTestId('reopen-banner')).toBeInTheDocument()
    expect(screen.getByText(/4 issues reopened/)).toBeInTheDocument()
  })

  it('explains the latest-cycle semantics', () => {
    render(<ReopenBanner count={2} />)
    expect(
      screen.getByText(/cycle time uses the latest completed cycle/i),
    ).toBeInTheDocument()
  })
})

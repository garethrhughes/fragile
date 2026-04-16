import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ToggleChip } from './toggle-chip'

describe('ToggleChip', () => {
  it('renders the label', () => {
    render(<ToggleChip label="Quarter" selected={false} onClick={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Quarter' })).toBeInTheDocument()
  })

  it('applies selected styles when selected=true', () => {
    render(<ToggleChip label="Quarter" selected={true} onClick={() => undefined} />)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('bg-interactive-selected-bg')
    expect(btn.className).toContain('text-interactive-selected-fg')
  })

  it('applies unselected styles when selected=false', () => {
    render(<ToggleChip label="Sprint" selected={false} onClick={() => undefined} />)
    const btn = screen.getByRole('button')
    expect(btn.className).not.toContain('bg-interactive-selected-bg')
    expect(btn.className).toContain('text-muted')
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<ToggleChip label="Quarter" selected={false} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn()
    render(<ToggleChip label="Quarter" selected={false} disabled onClick={onClick} />)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('applies disabled styles when disabled=true', () => {
    render(<ToggleChip label="Sprint" selected={false} disabled onClick={() => undefined} />)
    const btn = screen.getByRole('button')
    expect(btn.className).toContain('opacity-50')
    expect(btn.className).toContain('cursor-not-allowed')
  })
})

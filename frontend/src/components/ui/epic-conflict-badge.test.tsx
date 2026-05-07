import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EpicConflictBadge } from './epic-conflict-badge';
import type { EpicCoverageConflictingIdea } from '@/lib/api';

const conflictA: EpicCoverageConflictingIdea = {
  ideaKey: 'JPD-2',
  ideaSummary: 'Late idea',
  targetDate: '2026-02-01T00:00:00.000Z',
  daysFromPrimary: 14,
};

const conflictB: EpicCoverageConflictingIdea = {
  ideaKey: 'JPD-3',
  ideaSummary: 'Earlier idea',
  targetDate: '2025-12-15T00:00:00.000Z',
  daysFromPrimary: -7,
};

describe('EpicConflictBadge', () => {
  it('renders nothing when there are no conflicts', () => {
    const { container } = render(<EpicConflictBadge conflicts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders count and pluralises correctly', () => {
    render(<EpicConflictBadge conflicts={[conflictA]} />);
    expect(screen.getByRole('button', { name: /1 conflicting roadmap idea/i })).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('1 conflict');
  });

  it('pluralises for multiple conflicts', () => {
    render(<EpicConflictBadge conflicts={[conflictA, conflictB]} />);
    expect(screen.getByRole('button')).toHaveTextContent('2 conflicts');
  });

  it('details panel is hidden by default and reveals on click', () => {
    render(<EpicConflictBadge conflicts={[conflictA, conflictB]} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('region', { name: /conflicting ideas/i })).toBeInTheDocument();
    expect(screen.getByText('JPD-2')).toBeInTheDocument();
    expect(screen.getByText('JPD-3')).toBeInTheDocument();
  });

  it('formats signed daysFromPrimary with leading + or - and ISO date prefix', () => {
    render(<EpicConflictBadge conflicts={[conflictA, conflictB]} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('+14d')).toBeInTheDocument();
    expect(screen.getByText('-7d')).toBeInTheDocument();
    expect(screen.getByText('2026-02-01')).toBeInTheDocument();
    expect(screen.getByText('2025-12-15')).toBeInTheDocument();
  });

  it('toggles aria-expanded as the disclosure opens and closes', () => {
    render(<EpicConflictBadge conflicts={[conflictA]} />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});

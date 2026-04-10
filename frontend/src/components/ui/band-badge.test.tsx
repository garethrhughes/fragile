import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BandBadge } from './band-badge';
import type { DoraBand } from '@/lib/dora-bands';

describe('BandBadge', () => {
  it('renders the band name capitalized', () => {
    render(<BandBadge band="elite" />);
    expect(screen.getByText('elite')).toBeInTheDocument();
  });

  it('applies green styling for elite band', () => {
    const { container } = render(<BandBadge band="elite" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('green');
  });

  it('applies blue styling for high band', () => {
    const { container } = render(<BandBadge band="high" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('blue');
  });

  it('applies amber styling for medium band', () => {
    const { container } = render(<BandBadge band="medium" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('amber');
  });

  it('applies red styling for low band', () => {
    const { container } = render(<BandBadge band="low" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('red');
  });

  it('renders as a span element', () => {
    const { container } = render(<BandBadge band="high" />);
    expect(container.firstChild?.nodeName).toBe('SPAN');
  });
});

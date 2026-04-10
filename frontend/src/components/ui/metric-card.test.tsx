import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from './metric-card';

describe('MetricCard', () => {
  const defaultProps = {
    title: 'Deployment Frequency',
    value: 2.5,
    unit: 'deploys/day',
    band: 'elite' as const,
  };

  it('renders the title', () => {
    render(<MetricCard {...defaultProps} />);
    expect(screen.getByText('Deployment Frequency')).toBeInTheDocument();
  });

  it('renders formatted value', () => {
    render(<MetricCard {...defaultProps} />);
    expect(screen.getByText('2.50')).toBeInTheDocument();
  });

  it('renders the unit', () => {
    render(<MetricCard {...defaultProps} />);
    expect(screen.getByText('deploys/day')).toBeInTheDocument();
  });

  it('renders band badge', () => {
    render(<MetricCard {...defaultProps} />);
    expect(screen.getByText('elite')).toBeInTheDocument();
  });

  it('formats percentage values correctly', () => {
    render(
      <MetricCard title="CFR" value={12.345} unit="%" band="medium" />,
    );
    expect(screen.getByText('12.3%')).toBeInTheDocument();
  });

  it('formats day values correctly', () => {
    render(
      <MetricCard title="Lead Time" value={3.456} unit="days" band="high" />,
    );
    expect(screen.getByText('3.5')).toBeInTheDocument();
  });

  it('renders sparkline when trend data provided', () => {
    const { container } = render(
      <MetricCard
        {...defaultProps}
        trend={[1, 2, 3, 4, 5, 6]}
      />,
    );
    const svg = container.querySelector('svg[aria-label="Trend sparkline"]');
    expect(svg).toBeInTheDocument();
  });

  it('does not render sparkline when trend is empty', () => {
    const { container } = render(
      <MetricCard {...defaultProps} trend={[]} />,
    );
    const svg = container.querySelector('svg[aria-label="Trend sparkline"]');
    expect(svg).not.toBeInTheDocument();
  });

  it('does not render sparkline when trend has single point', () => {
    const { container } = render(
      <MetricCard {...defaultProps} trend={[5]} />,
    );
    const svg = container.querySelector('svg[aria-label="Trend sparkline"]');
    expect(svg).not.toBeInTheDocument();
  });
});

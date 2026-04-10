import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, type Column } from './data-table';

interface TestRow {
  name: string;
  score: number;
  status: string;
  [key: string]: unknown;
}

const columns: Column<TestRow>[] = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'score', label: 'Score', sortable: true },
  {
    key: 'status',
    label: 'Status',
    sortable: false,
    render: (value) => <span data-testid="status">{String(value)}</span>,
  },
];

const data: TestRow[] = [
  { name: 'Alpha', score: 90, status: 'active' },
  { name: 'Charlie', score: 75, status: 'inactive' },
  { name: 'Bravo', score: 85, status: 'active' },
];

describe('DataTable', () => {
  it('renders all column headers', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('renders all data rows', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
  });

  it('uses custom render function', () => {
    render(<DataTable columns={columns} data={data} />);
    const statusCells = screen.getAllByTestId('status');
    expect(statusCells).toHaveLength(3);
    expect(statusCells[0].textContent).toBe('active');
  });

  it('sorts ascending on first header click', () => {
    const { container } = render(
      <DataTable columns={columns} data={data} />,
    );

    // Click on Name header to sort
    fireEvent.click(screen.getByText('Name'));

    const rows = container.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Alpha');
    expect(rows[1].textContent).toContain('Bravo');
    expect(rows[2].textContent).toContain('Charlie');
  });

  it('sorts descending on second header click', () => {
    const { container } = render(
      <DataTable columns={columns} data={data} />,
    );

    // Click twice to toggle to descending
    fireEvent.click(screen.getByText('Name'));
    fireEvent.click(screen.getByText('Name'));

    const rows = container.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Charlie');
    expect(rows[1].textContent).toContain('Bravo');
    expect(rows[2].textContent).toContain('Alpha');
  });

  it('sorts numeric values correctly', () => {
    const { container } = render(
      <DataTable columns={columns} data={data} />,
    );

    fireEvent.click(screen.getByText('Score'));

    const rows = container.querySelectorAll('tbody tr');
    // Ascending: 75, 85, 90
    expect(rows[0].textContent).toContain('75');
    expect(rows[1].textContent).toContain('85');
    expect(rows[2].textContent).toContain('90');
  });

  it('shows empty message when no data', () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('applies row className function', () => {
    const { container } = render(
      <DataTable
        columns={columns}
        data={data}
        rowClassName={(row) => (row.score >= 90 ? 'highlight' : '')}
      />,
    );

    const rows = container.querySelectorAll('tbody tr');
    expect(rows[0].className).toContain('highlight');
    expect(rows[1].className).not.toContain('highlight');
  });
});

'use client';

interface BoardChipProps {
  boardId: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function BoardChip({ boardId, selected, disabled, onClick }: BoardChipProps) {
  const base =
    'inline-flex items-center rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors select-none';

  const variant = disabled
    ? 'cursor-not-allowed border-border bg-gray-100 text-muted opacity-60'
    : selected
      ? 'cursor-pointer border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100'
      : 'cursor-pointer border-border bg-card text-foreground hover:bg-gray-50';

  return (
    <button
      type="button"
      className={`${base} ${variant}`}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      title={disabled ? 'No sprints for Kanban boards' : undefined}
    >
      {boardId}
    </button>
  );
}

import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './auth-store';
import { useFilterStore, ALL_BOARDS } from './filter-store';

// ---------------------------------------------------------------------------
// Auth Store
// ---------------------------------------------------------------------------

describe('useAuthStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store state
    useAuthStore.setState({ apiKey: null });
  });

  it('starts with null apiKey', () => {
    const { apiKey } = useAuthStore.getState();
    expect(apiKey).toBeNull();
  });

  it('sets apiKey and persists to localStorage', () => {
    useAuthStore.getState().setApiKey('test-key-123');

    expect(useAuthStore.getState().apiKey).toBe('test-key-123');
    expect(localStorage.getItem('dashboard_api_key')).toBe('test-key-123');
  });

  it('clears apiKey and removes from localStorage', () => {
    useAuthStore.getState().setApiKey('some-key');
    useAuthStore.getState().clearApiKey();

    expect(useAuthStore.getState().apiKey).toBeNull();
    expect(localStorage.getItem('dashboard_api_key')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Filter Store
// ---------------------------------------------------------------------------

describe('useFilterStore', () => {
  beforeEach(() => {
    useFilterStore.setState({
      selectedBoards: ALL_BOARDS,
      periodType: 'quarter',
      selectedSprint: null,
      selectedQuarter: null,
    });
  });

  it('starts with all boards selected', () => {
    const { selectedBoards } = useFilterStore.getState();
    expect(selectedBoards).toEqual(ALL_BOARDS);
  });

  it('starts with quarter period type', () => {
    const { periodType } = useFilterStore.getState();
    expect(periodType).toBe('quarter');
  });

  it('sets selected boards', () => {
    useFilterStore.getState().setSelectedBoards(['ACC', 'BPT']);
    expect(useFilterStore.getState().selectedBoards).toEqual(['ACC', 'BPT']);
  });

  it('resets period selections when changing period type', () => {
    useFilterStore.getState().setSelectedSprint('sprint-1');
    useFilterStore.getState().setSelectedQuarter('2025-Q1');

    useFilterStore.getState().setPeriodType('sprint');

    const state = useFilterStore.getState();
    expect(state.periodType).toBe('sprint');
    expect(state.selectedSprint).toBeNull();
    expect(state.selectedQuarter).toBeNull();
  });

  it('sets selected sprint', () => {
    useFilterStore.getState().setSelectedSprint('sprint-42');
    expect(useFilterStore.getState().selectedSprint).toBe('sprint-42');
  });

  it('sets selected quarter', () => {
    useFilterStore.getState().setSelectedQuarter('2025-Q2');
    expect(useFilterStore.getState().selectedQuarter).toBe('2025-Q2');
  });
});

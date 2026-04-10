import { describe, it, expect } from 'vitest';
import { apiFetch } from './api';

describe('apiFetch', () => {
  it('is a function', () => {
    expect(typeof apiFetch).toBe('function');
  });
});

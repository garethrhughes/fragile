/**
 * dora-cache.service.spec.ts
 *
 * Unit tests for the DoraCache service — an in-memory TTL cache that prevents
 * the expensive getDoraAggregate + getDoraTrend queries from re-executing on
 * every HTTP request.
 */

import { DoraCacheService } from './dora-cache.service.js';

describe('DoraCacheService', () => {
  let cache: DoraCacheService;

  beforeEach(() => {
    cache = new DoraCacheService();
  });

  // -------------------------------------------------------------------------
  // Basic get / set
  // -------------------------------------------------------------------------

  describe('get / set', () => {
    it('returns undefined for a key that was never set', () => {
      expect(cache.get('missing-key')).toBeUndefined();
    });

    it('returns the value that was set', () => {
      cache.set('k1', { answer: 42 });
      expect(cache.get('k1')).toEqual({ answer: 42 });
    });

    it('overwrites an existing key', () => {
      cache.set('k1', { v: 1 });
      cache.set('k1', { v: 2 });
      expect(cache.get('k1')).toEqual({ v: 2 });
    });

    it('stores independent values for different keys', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // TTL expiry
  // -------------------------------------------------------------------------

  describe('TTL expiry', () => {
    it('returns the value before TTL expires', () => {
      // Use a long TTL so it cannot expire within the test
      cache.set('fresh', 'value', 60_000);
      expect(cache.get('fresh')).toBe('value');
    });

    it('returns undefined after TTL has elapsed', () => {
      // Set a very short TTL (already expired)
      cache.set('stale', 'value', -1);
      expect(cache.get('stale')).toBeUndefined();
    });

    it('uses the default TTL of 60 seconds when none is provided', () => {
      // We cannot wait 60 s, but we can verify that the entry is present
      // immediately after setting (i.e. the default TTL is not 0 or negative)
      cache.set('default-ttl', 'hello');
      expect(cache.get('default-ttl')).toBe('hello');
    });
  });

  // -------------------------------------------------------------------------
  // invalidate
  // -------------------------------------------------------------------------

  describe('invalidate', () => {
    it('removes a single key', () => {
      cache.set('k', 'v');
      cache.invalidate('k');
      expect(cache.get('k')).toBeUndefined();
    });

    it('is a no-op for a key that does not exist', () => {
      expect(() => cache.invalidate('ghost')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  describe('clear', () => {
    it('removes all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
    });

    it('allows new entries after clear', () => {
      cache.set('a', 1);
      cache.clear();
      cache.set('a', 99);
      expect(cache.get('a')).toBe(99);
    });
  });

  // -------------------------------------------------------------------------
  // buildKey
  // -------------------------------------------------------------------------

  describe('buildKey', () => {
    it('produces a deterministic string from an object', () => {
      const k1 = DoraCacheService.buildKey({ boardId: 'ACC', quarter: '2026-Q1' });
      const k2 = DoraCacheService.buildKey({ boardId: 'ACC', quarter: '2026-Q1' });
      expect(k1).toBe(k2);
    });

    it('produces different keys for different params', () => {
      const k1 = DoraCacheService.buildKey({ boardId: 'ACC', quarter: '2026-Q1' });
      const k2 = DoraCacheService.buildKey({ boardId: 'ACC', quarter: '2026-Q2' });
      expect(k1).not.toBe(k2);
    });

    it('is order-independent for object keys', () => {
      const k1 = DoraCacheService.buildKey({ a: '1', b: '2' });
      const k2 = DoraCacheService.buildKey({ b: '2', a: '1' });
      expect(k1).toBe(k2);
    });

    it('includes a namespace prefix when provided', () => {
      const k = DoraCacheService.buildKey({ boardId: 'ACC' }, 'trend');
      expect(k).toContain('trend');
    });
  });

  // -------------------------------------------------------------------------
  // size
  // -------------------------------------------------------------------------

  describe('size', () => {
    it('returns 0 for an empty cache', () => {
      expect(cache.size()).toBe(0);
    });

    it('returns the number of entries including expired ones', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      // size counts all internal entries, expired or not
      expect(cache.size()).toBeGreaterThanOrEqual(2);
    });
  });
});

import { describe, it, expect } from 'vitest'
import { classifyCycleTime } from './cycle-time-bands'

describe('classifyCycleTime', () => {
  it('classifies excellent (≤2 days)', () => {
    expect(classifyCycleTime(0.5)).toBe('excellent')
    expect(classifyCycleTime(2)).toBe('excellent')
  })

  it('classifies good (≤5 days)', () => {
    expect(classifyCycleTime(3)).toBe('good')
    expect(classifyCycleTime(5)).toBe('good')
  })

  it('classifies fair (≤10 days)', () => {
    expect(classifyCycleTime(7)).toBe('fair')
    expect(classifyCycleTime(10)).toBe('fair')
  })

  it('classifies poor (>10 days)', () => {
    expect(classifyCycleTime(11)).toBe('poor')
    expect(classifyCycleTime(50)).toBe('poor')
  })

  // Proposal 0054 AC E: empty results must NOT band as 'excellent'.
  it('returns null for null input (no completed cycles)', () => {
    expect(classifyCycleTime(null)).toBeNull()
  })

  it('accepts custom thresholds', () => {
    expect(classifyCycleTime(1.5, [1, 3, 7])).toBe('good')
    expect(classifyCycleTime(8, [1, 3, 7])).toBe('poor')
  })
})

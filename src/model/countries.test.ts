import { describe, expect, it } from 'vitest';
import { COUNTRIES, US_STATES } from './countries';

describe('COUNTRIES', () => {
  it('has 249 unique ISO codes, sorted by name, with English labels', () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES.map((c) => c.value)).size).toBe(249);
    expect(COUNTRIES.find((c) => c.value === 'US')?.label).toBe('United States');
    const labels = COUNTRIES.map((c) => c.label);
    expect([...labels].sort((a, b) => a.localeCompare(b))).toEqual(labels);
  });
});

describe('US_STATES', () => {
  it('has 50 states plus DC with 2-letter codes', () => {
    expect(US_STATES).toHaveLength(51);
    expect(US_STATES.every((s) => /^[A-Z]{2}$/.test(s.value))).toBe(true);
    expect(US_STATES.find((s) => s.value === 'DC')?.label).toBe('District of Columbia');
    expect(US_STATES.find((s) => s.value === 'CA')?.label).toBe('California');
  });
});

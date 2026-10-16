import { describe, expect, it } from 'vitest';
import { LIMITS } from './Splitter';

describe('column limits', () => {
  it('keep every column usable', () => {
    for (const [min, max] of Object.values(LIMITS)) {
      expect(min).toBeGreaterThanOrEqual(180);
      expect(max).toBeGreaterThan(min);
    }
  });
});

import { describe, expect, it } from 'vitest';

describe('apps/web smoke', () => {
  it('vitest is wired', () => {
    expect(1 + 1).toBe(2);
  });
});

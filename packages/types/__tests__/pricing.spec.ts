import { describe, expect, it } from 'vitest';

import { GEMINI_2_5_FLASH, MONTHLY_CAP_USD } from '../src/pricing.js';

describe('pricing constants', () => {
  it('exposes Gemini 2.5 Flash rates per 1M tokens (USD)', () => {
    expect(GEMINI_2_5_FLASH.INPUT_USD_PER_1M).toBe(0.3);
    expect(GEMINI_2_5_FLASH.OUTPUT_USD_PER_1M).toBe(2.5);
  });

  it('exposes the monthly cap as USD 10', () => {
    expect(MONTHLY_CAP_USD).toBe(10);
  });
});

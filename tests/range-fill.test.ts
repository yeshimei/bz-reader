import { describe, expect, it } from 'vitest';
import { rangeFill } from '../src/shell/range-fill';

describe('滑杆 --fill 换算', () => {
  it('按 min/max 线性换算', () => {
    expect(rangeFill(0, 100, 25)).toBe('25.0%');
    expect(rangeFill(14, 26, 18.5)).toBe('37.5%');
    expect(rangeFill(1, 2, 1)).toBe('0.0%');
    expect(rangeFill(1, 2, 2)).toBe('100.0%');
  });

  it('超出范围夹回 0–100', () => {
    expect(rangeFill(0, 10, -5)).toBe('0.0%');
    expect(rangeFill(0, 10, 99)).toBe('100.0%');
  });

  it('退化输入不会算出 NaN%', () => {
    expect(rangeFill(5, 5, 5)).toBe('0%');
    expect(rangeFill(0, 10, Number.NaN)).toBe('0.0%');
  });
});

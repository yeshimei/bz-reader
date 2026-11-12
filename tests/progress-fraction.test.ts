import { describe, expect, it } from 'vitest';
import { safeFraction } from '../src/engine/progress-fraction';

/*
 * 真机回归（2026-11-13）：剪藏本每翻一章都弹「读完一本书」。
 * 分页器在「本章正好两页」时算出 1/0 = Infinity，夹到 1 就成了读完了。
 */
describe('safeFraction · 进度小数', () => {
  it('正常小数原样返回', () => {
    expect(safeFraction(0)).toBe(0);
    expect(safeFraction(0.25)).toBe(0.25);
    expect(safeFraction(1)).toBe(1);
  });

  it('超出 0..1 的有限数夹回去', () => {
    expect(safeFraction(-0.5)).toBe(0);
    expect(safeFraction(3)).toBe(1);
  });

  it('Infinity 不当成读到底——两页章节的第 2 页就是它', () => {
    expect(safeFraction(Infinity)).toBe(0);
    expect(safeFraction(-Infinity)).toBe(0);
  });

  it('NaN / undefined / 字符串都给 0', () => {
    expect(safeFraction(NaN)).toBe(0);
    expect(safeFraction(undefined)).toBe(0);
    expect(safeFraction(null)).toBe(0);
    expect(safeFraction('abc')).toBe(0);
  });
});

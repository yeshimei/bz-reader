import { describe, expect, it } from 'vitest';
import { safeFraction, shouldMarkComplete } from '../src/engine/progress-fraction';

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

describe('shouldMarkComplete · 活书不结书', () => {
  it('剪藏本（live）翻到最后一页也不标读完', () => {
    expect(shouldMarkComplete({ percent: 1, live: true, completed: false })).toBe(false);
  });

  it('普通书到 99% 标读完；已标过不重复', () => {
    expect(shouldMarkComplete({ percent: 0.995, live: false, completed: false })).toBe(true);
    expect(shouldMarkComplete({ percent: 0.9, live: false, completed: false })).toBe(false);
    expect(shouldMarkComplete({ percent: 1, live: false, completed: true })).toBe(false);
  });
});

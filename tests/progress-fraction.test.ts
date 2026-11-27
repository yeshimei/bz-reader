import { describe, expect, it } from 'vitest';
import { safeFraction, shouldMarkComplete, shouldPromptFinish } from '../src/engine/progress-fraction';

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

/*
 * 2026-11-27 用户拍板：滑到最后一页不再自动算读完，要「再往后翻一次」才弹
 * 结束界面，确认后才算读完。所以判定从「进度到 99%」改成「翻不动了」。
 */
describe('shouldPromptFinish · 末页再翻才弹结束界面', () => {
  it('往后再翻、但已经翻不动（末页）→ 弹', () => {
    expect(shouldPromptFinish({ dir: 'next', moved: false, live: false })).toBe(true);
  });

  it('真的翻动了（还有下一页 / 下一章）→ 不弹', () => {
    expect(shouldPromptFinish({ dir: 'next', moved: true, live: false })).toBe(false);
  });

  it('往前翻不动（书首）→ 不弹', () => {
    expect(shouldPromptFinish({ dir: 'prev', moved: false, live: false })).toBe(false);
    expect(shouldPromptFinish({ dir: 'prev', moved: true, live: false })).toBe(false);
  });

  it('剪藏本是持续更新的流：到底也不弹', () => {
    expect(shouldPromptFinish({ dir: 'next', moved: false, live: true })).toBe(false);
  });
});

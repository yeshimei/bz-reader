import { describe, expect, it } from 'vitest';
import { chromeBottomOverlap, navBottomGap } from '../src/view/bottom-gap';

/**
 * 手机底部导航栏 / 桌面状态栏压在阅读区上，剪藏本底条要给它们让位。
 *
 * 真机量到的两处：桌面 1024×800 阅读区底边 800、状态栏顶边 765（重叠 35，
 * 底条「剪藏本」被切掉一半）；手机 390×844 阅读区底边 844、导航栏顶边 760
 * （重叠 84，底条整条压在栏上，三个按钮全点不到）。
 */
describe('chromeBottomOverlap', () => {
  it('按「阅读区底边 − 浮层顶边」让位（含安全区）', () => {
    expect(chromeBottomOverlap(800, 765)).toBe(35);
    expect(chromeBottomOverlap(844, 760)).toBe(84);
  });

  it('浮层不在 / 阅读区没伸到浮层下面：不让位', () => {
    expect(chromeBottomOverlap(700, 765)).toBe(0);
    expect(chromeBottomOverlap(800, null)).toBe(0);
    expect(chromeBottomOverlap(null, 765)).toBe(0);
    expect(chromeBottomOverlap(800, Number.NaN)).toBe(0);
  });

  it('量到一个巨大的值也夹在上限内，不凭空挖白', () => {
    expect(chromeBottomOverlap(2000, 0)).toBe(120);
  });
});

describe('navBottomGap', () => {
  it('按栏自己的高度让位（旧口径，保留给只拿得到高度的调用方）', () => {
    expect(navBottomGap(44)).toBe(44);
    expect(navBottomGap(56.4)).toBe(56);
  });

  it('拿不到栏 / 栏被隐藏：不让位', () => {
    expect(navBottomGap(null)).toBe(0);
    expect(navBottomGap(undefined)).toBe(0);
    expect(navBottomGap(0)).toBe(0);
    expect(navBottomGap(-10)).toBe(0);
  });

  it('命中了一个巨大的容器也不会吃掉整页', () => {
    expect(navBottomGap(800)).toBe(96);
  });
});

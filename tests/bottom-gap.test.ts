import { describe, expect, it } from 'vitest';
import { navBottomGap } from '../src/view/bottom-gap';

/**
 * 手机底部导航栏压在正文上，要给阅读区让出它的高度。
 *
 * 量的是**栏自己的高度**，不是「阅读区底边 − 栏顶边」：那两个坐标经常不在
 * 同一个参照里，一量就是一整屏，底部凭空多出一大块空白（真机反馈）。
 */
describe('navBottomGap', () => {
  it('按栏自己的高度让位', () => {
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

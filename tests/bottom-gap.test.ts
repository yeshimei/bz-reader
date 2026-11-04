import { describe, expect, it } from 'vitest';
import { bottomOverlap } from '../src/view/bottom-gap';

/**
 * 手机底部导航栏压在正文上。
 *
 * 阅读区伸到屏幕最底、分页按容器高度排，栏又是浮着的——最后一行就
 * 正好被它盖住。这里量的是「压住多少」，量到 0 就不动，绝不凭空调白。
 */
describe('bottomOverlap', () => {
  it('阅读区伸到栏下面：量出重叠的高度', () => {
    expect(bottomOverlap(2400, 2356)).toBe(44);
  });

  it('栏在阅读区之下（已经扣过高度）：不加留白', () => {
    expect(bottomOverlap(2300, 2356)).toBe(0);
  });

  it('拿不到栏就当没有遮挡', () => {
    expect(bottomOverlap(2400, null)).toBe(0);
  });

  it('小数取整，别把 0.4px 的缝变成留白', () => {
    expect(bottomOverlap(2400.4, 2356)).toBe(44);
    expect(bottomOverlap(2355.6, 2356)).toBe(0);
  });
});

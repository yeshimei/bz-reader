import { describe, expect, it } from 'vitest';
import { arrowDirection, tapDirection } from '../src/view/tap-direction';

/**
 * B1：点按方向只有一份规则。
 *
 * 以前桌面端在阅读视图里现算「点在左半还是右半」，键盘在 paging-key 里另算
 * 一套，两边都对竖排做了反转、都对 RTL 没做。一本阿拉伯语书从右往左排，
 * 点右边却翻到下一页——和整本书的阅读方向顶着来。
 */
describe('点按方向（B1）', () => {
  const ltr = { vertical: false, rtl: false };
  const vertical = { vertical: true, rtl: false };
  const rtl = { vertical: false, rtl: true };

  it('横排 LTR：左 = 上一页，右 = 下一页', () => {
    expect(tapDirection('left', ltr)).toBe('prev');
    expect(tapDirection('right', ltr)).toBe('next');
  });

  it('竖排：前进在左边（从右往左排字）', () => {
    expect(tapDirection('left', vertical)).toBe('next');
    expect(tapDirection('right', vertical)).toBe('prev');
  });

  it('RTL 书：与竖排同一条反转规则', () => {
    expect(tapDirection('left', rtl)).toBe('next');
    expect(tapDirection('right', rtl)).toBe('prev');
  });

  it('竖排 + RTL：两次反转抵消，回到左 = 上一页', () => {
    expect(tapDirection('left', { vertical: true, rtl: true })).toBe('prev');
    expect(tapDirection('right', { vertical: true, rtl: true })).toBe('next');
  });

  it('上下分区不看书写方向：上方永远是上一页', () => {
    for (const ctx of [ltr, vertical, rtl, { vertical: true, rtl: true }]) {
      expect(tapDirection('top', ctx)).toBe('prev');
      expect(tapDirection('bottom', ctx)).toBe('next');
    }
  });

  it('方向键与点按共用同一条规则', () => {
    expect(arrowDirection('ArrowLeft', ltr)).toBe('prev');
    expect(arrowDirection('ArrowRight', ltr)).toBe('next');
    expect(arrowDirection('ArrowLeft', rtl)).toBe('next');
    expect(arrowDirection('ArrowRight', vertical)).toBe('prev');
    expect(arrowDirection('ArrowUp', ltr)).toBeNull();
  });
});

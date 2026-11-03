import { describe, expect, it } from 'vitest';
import { ANCHOR_GAP, anchoredPlacement } from '../src/shell/anchored-style';

/**
 * 文字浮层贴哪儿 = 这个函数的输出。
 *
 * 回归目标：**紧挨着文字，不留大缝**。
 *   · 移动端优先下方，桌面端优先上方；
 *   · 那一侧放不下才翻到另一侧；
 *   · 任何情况下都不出可视区。
 * 以前用固定阈值猜上下、给 14/26px 的偏移，结果就是「和文字差很远」。
 */
const view = { width: 390, height: 844 };
const panel = { width: 200, height: 44 };
const anchor = { left: 100, top: 300, width: 120, height: 20 };

describe('anchoredPlacement', () => {
  it('下方：顶边 = 锚点底边 + 间距', () => {
    const pos = anchoredPlacement(anchor, panel, view, 'below');
    expect(pos.top).toBe(anchor.top + anchor.height + ANCHOR_GAP);
  });

  it('上方：底边 = 锚点顶边 - 间距', () => {
    const pos = anchoredPlacement(anchor, panel, view, 'above');
    expect(pos.top + panel.height).toBe(anchor.top - ANCHOR_GAP);
  });

  it('水平居中在锚点上', () => {
    const pos = anchoredPlacement(anchor, panel, view, 'below');
    expect(pos.left).toBe(anchor.left + anchor.width / 2 - panel.width / 2);
  });

  it('下方放不下就翻到上方', () => {
    const low = { left: 100, top: 800, width: 120, height: 20 };
    const pos = anchoredPlacement(low, { width: 200, height: 60 }, view, 'below');
    expect(pos.top + 60).toBe(low.top - ANCHOR_GAP);
  });

  it('上方放不下就翻到下方', () => {
    const high = { left: 100, top: 10, width: 120, height: 20 };
    const pos = anchoredPlacement(high, panel, view, 'above');
    expect(pos.top).toBe(high.top + high.height + ANCHOR_GAP);
  });

  it('靠左的锚点被夹住，浮层不越出左边界', () => {
    const pos = anchoredPlacement({ left: 0, top: 300, width: 10, height: 20 }, panel, view, 'below');
    expect(pos.left).toBe(8);
  });

  it('靠右的锚点被夹住，浮层不越出右边界', () => {
    const pos = anchoredPlacement({ left: 380, top: 300, width: 10, height: 20 }, panel, view, 'below');
    expect(pos.left).toBe(view.width - panel.width - 8);
  });

  it('键盘弹起后按可视区顶部夹取，不会跑到键盘下面', () => {
    const visible = { width: 390, height: 400, top: 200 };
    const pos = anchoredPlacement({ left: 100, top: 560, width: 120, height: 20 }, panel, visible, 'below');
    expect(pos.top).toBeGreaterThanOrEqual(visible.top + 8);
    expect(pos.top + panel.height).toBeLessThanOrEqual(visible.top + visible.height - 8);
  });

  it('上下都放不下时也留在可视区内（不甩出屏幕）', () => {
    const tiny = { width: 390, height: 100 };
    const pos = anchoredPlacement({ left: 100, top: 40, width: 120, height: 20 }, { width: 200, height: 120 }, tiny, 'below');
    expect(pos.top).toBe(8);
  });

  it('间距是「贴着但不压字」，不会给成几十像素', () => {
    expect(ANCHOR_GAP).toBeLessThanOrEqual(8);
    const below = anchoredPlacement(anchor, panel, view, 'below');
    const above = anchoredPlacement(anchor, panel, view, 'above');
    expect(below.top - (anchor.top + anchor.height)).toBe(ANCHOR_GAP);
    expect(anchor.top - (above.top + panel.height)).toBe(ANCHOR_GAP);
  });
});

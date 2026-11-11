import { describe, expect, it } from 'vitest';
import { ANCHOR_GAP, anchoredBelowRight, anchoredBelowRightIn, anchoredPlacement } from '../src/shell/anchored-style';

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

  it('间距钉在定稿的 4px（showcase-read 的 Placement 一栏）', () => {
    expect(ANCHOR_GAP).toBe(4);
  });
});

/**
 * 落点在哪一侧：手机要据此决定「工具条贴划线」还是「气泡贴划线」。
 *
 * 坐标只能说明浮层在屏幕上的位置，不能说明它翻没翻边；
 * 手机上翻到划线上方时，顺序要反过来（气泡在上、工具条在下）。
 */
describe('anchoredPlacement · 落点在哪一侧', () => {
  it('手机优先下方、且下方放得下：side = below', () => {
    expect(anchoredPlacement(anchor, panel, view, 'below').side).toBe('below');
  });

  it('手机下方放不下、翻到上方：side = above', () => {
    const low = { left: 100, top: 800, width: 120, height: 20 };
    expect(anchoredPlacement(low, { width: 200, height: 60 }, view, 'below').side).toBe('above');
  });

  it('桌面优先上方、且上方放得下：side = above', () => {
    expect(anchoredPlacement(anchor, panel, view, 'above').side).toBe('above');
  });

  it('桌面上方放不下、翻到下方：side = below', () => {
    const high = { left: 100, top: 10, width: 120, height: 20 };
    expect(anchoredPlacement(high, panel, view, 'above').side).toBe('below');
  });
});

/**
 * 排版浮层贴着头栏按钮：右下角对齐按钮右缘，顶边在按钮下方 8px。
 *
 * 它和「贴文字」的浮层不是一回事：文字工具条要居中盖在选区上，
 * 排版面板是一张 320px 的卡，右缘对齐按钮才不会压住头栏那一排图标；
 * 放不下（窄窗、按钮靠右）时整体夹回可视区。
 */
describe('anchoredBelowRight · 排版浮层贴按钮', () => {
  const button = { left: 700, top: 20, width: 32, height: 32 };
  const panel = { width: 320, height: 300 };
  const wide = { width: 1200, height: 900 };

  it('右缘与按钮右缘对齐', () => {
    const pos = anchoredBelowRight(button, panel, wide, 8);
    expect(pos.left + panel.width).toBe(button.left + button.width);
  });

  it('顶边 = 按钮底边 + 间距', () => {
    const pos = anchoredBelowRight(button, panel, wide, 8);
    expect(pos.top).toBe(button.top + button.height + 8);
  });

  it('间距默认 8px：贴着按钮，但留一条缝', () => {
    expect(anchoredBelowRight(button, panel, wide)).toEqual(anchoredBelowRight(button, panel, wide, 8));
  });

  it('按钮靠右、面板会越界时夹回可视区', () => {
    const pos = anchoredBelowRight({ left: 1180, top: 20, width: 20, height: 32 }, panel, wide, 8);
    expect(pos.left).toBe(wide.width - panel.width - 8);
  });

  it('按钮靠左时面板不越出左边界', () => {
    const pos = anchoredBelowRight({ left: 4, top: 20, width: 24, height: 32 }, panel, wide, 8);
    expect(pos.left).toBe(8);
  });

  it('按钮贴着底边时面板被顶上去，不会挂到屏幕外', () => {
    const pos = anchoredBelowRight({ left: 700, top: 880, width: 32, height: 32 }, panel, wide, 8);
    expect(pos.top + panel.height).toBeLessThanOrEqual(wide.height - 8);
  });

  it('键盘弹起时按可视区顶部夹取', () => {
    const visible = { width: 1200, height: 500, top: 300 };
    const pos = anchoredBelowRight({ left: 700, top: 310, width: 32, height: 32 }, { width: 320, height: 600 }, visible, 8);
    expect(pos.top).toBeGreaterThanOrEqual(visible.top + 8);
  });
});

/**
 * 面板挂在阅读区里（绝对定位），按钮矩形却是视口坐标。
 *
 * PDF 的排版面板就是这种情况：`anchor` 来自头栏按钮的
 * `getBoundingClientRect()`，面板 `appendChild` 到 `.bzr-pdf`，用的是容器内
 * 偏移。少减这一下，卡片就会整体偏出「阅读区顶部 - 头栏高度」那一截——
 * 头栏越高偏得越多，看起来像浮在正文中间（2026-11-10 真机截图）。
 */
describe('anchoredBelowRightIn · 面板挂在容器里', () => {
  const rootBox = { left: 60, top: 120, width: 900, height: 700 };
  const button = { left: 860, top: 20, width: 32, height: 32 };
  const card = { width: 320, height: 300 };

  it('落点是容器内坐标：右缘仍对齐按钮', () => {
    const pos = anchoredBelowRightIn(button, card, rootBox);
    const buttonInRoot = button.left - rootBox.left + button.width;
    expect(pos.left + card.width).toBe(buttonInRoot);
  });

  it('顶边在按钮下方 8px，且以容器顶为界', () => {
    const pos = anchoredBelowRightIn(button, card, rootBox);
    /* 按钮在容器上方（头栏里）：换算后顶边是负的，夹到容器内 8px */
    expect(pos.top).toBe(8);
  });

  it('容器完全在视口里时等价于先换算再调用 anchoredBelowRight', () => {
    const anchorInRoot = {
      left: 400 - rootBox.left,
      top: 300 - rootBox.top,
      width: 32,
      height: 32,
    };
    expect(
      anchoredBelowRightIn({ left: 400, top: 300, width: 32, height: 32 }, card, rootBox, 8),
    ).toEqual(anchoredBelowRight(anchorInRoot, card, { width: rootBox.width, height: rootBox.height }, 8));
  });

  it('容器放不下卡片时靠左贴边，不会把右缘再往外推', () => {
    const narrow = { left: 0, top: 0, width: 240, height: 700 };
    const pos = anchoredBelowRightIn({ left: 200, top: 20, width: 32, height: 32 }, card, narrow);
    /* 卡片（320）比容器（240）还宽：只能靠左，保证左边不越界 */
    expect(pos.left).toBe(8);
  });

  it('容器比卡片略窄但放得下时，仍是右缘对齐后夹回', () => {
    const narrow = { left: 0, top: 0, width: 400, height: 700 };
    const pos = anchoredBelowRightIn({ left: 380, top: 20, width: 32, height: 32 }, card, narrow);
    expect(pos.left).toBe(narrow.width - card.width - 8);
  });
});

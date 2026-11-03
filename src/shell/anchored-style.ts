/**
 * 文字浮层的落点（纯函数，可在 node 里直接测）。
 *
 * 只有一条硬约束：**紧挨着文字**。
 *   · 移动端优先在文字下方，桌面端优先在文字上方；
 *   · 那一侧放不下才翻到另一侧；
 *   · 最后夹在可视区内（含键盘弹起后的 visualViewport）。
 *
 * 以前这里用固定阈值（top > 280）猜上下、再给 14/26px 的偏移，
 * 手机上的贴底卡更是直接写死 bottom:10px——落点与文字差出半屏，
 * 用户看到的就是「偏移特别远」。
 */

export interface AnchorRect {
  left: number;
  top: number;
  width?: number;
  height?: number;
}

export interface PanelBox {
  width: number;
  height: number;
}

export interface ViewBox {
  width: number;
  height: number;
  /** 可视区顶边（键盘弹起时 visualViewport.offsetTop；没有键盘就是 0） */
  top?: number;
}

export type AnchoredSide = 'above' | 'below';

export interface Placement {
  left: number;
  top: number;
}

/**
 * 浮层与文字之间的间距：贴着，但不压住字。
 *
 * 4px 是定稿量出来的（showcase-read 的 Placement 一栏：「桌面：胶囊在选区上方
 * 4px，卡片再往上 10px」）。改大会让胶囊看起来悬在段落中间。
 */
export const ANCHOR_GAP = 4;

/** 离可视区边缘的最小距离 */
const VIEW_MARGIN = 8;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * 算出浮层左上角该放哪儿。
 *
 * @param anchor 文字矩形；`height` 缺省按 0 算（比如只拿到一个点）
 * @param panel  浮层自身尺寸（渲染后量出来的）
 * @param view   可视区（`top` 供键盘弹起时使用）
 * @param prefer 期望在哪一侧：移动端 below、桌面端 above
 */
export function anchoredPlacement(
  anchor: AnchorRect,
  panel: PanelBox,
  view: ViewBox,
  prefer: AnchoredSide,
): Placement {
  const viewTop = view.top ?? 0;
  const viewBottom = viewTop + view.height;

  const left = clamp(
    anchor.left + (anchor.width ?? 0) / 2 - panel.width / 2,
    VIEW_MARGIN,
    Math.max(VIEW_MARGIN, view.width - panel.width - VIEW_MARGIN),
  );

  const belowTop = anchor.top + (anchor.height ?? 0) + ANCHOR_GAP;
  const aboveTop = anchor.top - ANCHOR_GAP - panel.height;
  const fitsBelow = belowTop + panel.height <= viewBottom - VIEW_MARGIN;
  const fitsAbove = aboveTop >= viewTop + VIEW_MARGIN;

  let top: number;
  if (prefer === 'below') top = fitsBelow || !fitsAbove ? belowTop : aboveTop;
  else top = fitsAbove || !fitsBelow ? aboveTop : belowTop;

  top = clamp(top, viewTop + VIEW_MARGIN, Math.max(viewTop + VIEW_MARGIN, viewBottom - panel.height - VIEW_MARGIN));

  return { left: Math.round(left), top: Math.round(top) };
}

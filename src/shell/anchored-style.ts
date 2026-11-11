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
  /**
   * 最终落在锚点的哪一侧。
   *
   * 坐标只说明浮层在屏幕上的位置，不说明它翻没翻边。手机要据此决定
   * 「谁贴着划线」：落在下方时工具条在上，落在上方时工具条在下。
   */
  side: AnchoredSide;
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

  /* 先按偏好选边，放不下再翻；选中的这一边同时告诉调用方
     「工具条该贴在哪」——两边各有一套顺序。 */
  const chooseBelow = prefer === 'below' ? fitsBelow || !fitsAbove : !(fitsAbove || !fitsBelow);
  const side: AnchoredSide = chooseBelow ? 'below' : 'above';
  let top = chooseBelow ? belowTop : aboveTop;

  top = clamp(top, viewTop + VIEW_MARGIN, Math.max(viewTop + VIEW_MARGIN, viewBottom - panel.height - VIEW_MARGIN));

  return { left: Math.round(left), top: Math.round(top), side };
}

/**
 * 排版浮层贴着头栏按钮：右缘对齐按钮右缘，顶边在按钮下方。
 *
 * 它和「贴文字」的浮层不是一回事：文字工具条要居中盖在选区上，
 * 排版面板是一张 320px 的卡，居中会把头栏那一排图标压掉一半；
 * 右缘对齐按钮，卡片自然落在按钮下方、靠阅读区右边。
 * 放不下（窄窗、按钮靠右）时整体夹回可视区。
 */
export const ANCHOR_BUTTON_GAP = 8;

export function anchoredBelowRight(
  anchor: AnchorRect,
  panel: PanelBox,
  view: ViewBox,
  gap = ANCHOR_BUTTON_GAP,
): { left: number; top: number } {
  const viewTop = view.top ?? 0;
  const left = clamp(
    anchor.left + (anchor.width ?? 0) - panel.width,
    VIEW_MARGIN,
    Math.max(VIEW_MARGIN, view.width - panel.width - VIEW_MARGIN),
  );
  const top = clamp(
    anchor.top + (anchor.height ?? 0) + gap,
    viewTop + VIEW_MARGIN,
    Math.max(viewTop + VIEW_MARGIN, viewTop + view.height - panel.height - VIEW_MARGIN),
  );
  return { left: Math.round(left), top: Math.round(top) };
}

/** 容器的视口矩形：面板挂在它里面，写的是容器内偏移 */
export interface RootBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 面板绝对定位在某个容器里、锚点却是视口坐标时的落点。
 *
 * PDF 的排版面板就是这样：按钮矩形来自头栏 `getBoundingClientRect()`（视口
 * 坐标），卡片却 `appendChild` 到 `.bzr-pdf`（容器内坐标）。少减这一下，
 * 卡片会整体偏出「头栏高度」那一截——头栏越高偏得越多，看起来像浮在正文
 * 中间，而不是从按钮下面弹出来（2026-11-10 真机截图）。
 *
 * 换算成容器坐标后仍走 `anchoredBelowRight`：右缘对齐、下沿 8px、
 * 越界夹回，规则只有一份。
 */
export function anchoredBelowRightIn(
  anchor: AnchorRect,
  panel: PanelBox,
  rootBox: RootBox,
  gap = ANCHOR_BUTTON_GAP,
): { left: number; top: number } {
  return anchoredBelowRight(
    {
      left: anchor.left - rootBox.left,
      top: anchor.top - rootBox.top,
      width: anchor.width,
      height: anchor.height,
    },
    panel,
    { width: rootBox.width, height: rootBox.height, top: 0 },
    gap,
  );
}

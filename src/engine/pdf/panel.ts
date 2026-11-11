/* ============================================================
 * bz-reader · PDF 缩放与排版入口（engine/pdf/panel.ts）
 *
 * 2026-11-10 真机反馈：右下角浮条与头栏「排版」面板各管一半版面设置——
 * 「适合宽度 / 适合页面」在浮条里，旋转 / 单双页 / 翻页在面板里。
 * 同一件事要往两个角落找。现在：
 *   · 浮条只留「放大 / 百分比 / 缩小 + 页码 + 滑块」；
 *   · 面板第一行就是缩放三档（宽 / 页 / 实际大小）。
 *
 * 这里是两张清单的唯一真源：视图按它渲染，测试按它断言。
 * ============================================================ */

/** 右下角浮条的控件，顺序即视觉顺序 */
export type PdfBarItem = 'out' | 'zoom' | 'in' | 'pageno' | 'range';

export const PDF_BAR_ITEMS: readonly PdfBarItem[] = ['out', 'zoom', 'in', 'pageno', 'range'];

/** 排版面板的行：缩放搬进来之后排在第一行 */
export type PdfLayoutRow = 'zoom' | 'rotate' | 'pages' | 'flow';

export const PDF_LAYOUT_ROWS: readonly PdfLayoutRow[] = ['zoom', 'rotate', 'pages', 'flow'];

/** 缩放三档：适合宽度 / 适合页面 / 实际大小（100%） */
export type PdfZoomTarget = 'width' | 'page' | 'actual';

export const PDF_ZOOM_MODES: readonly PdfZoomTarget[] = ['width', 'page', 'actual'];

/**
 * 缩放档落到视图上是什么。
 *
 * 「适合宽度 / 适合页面」交给适配计算（`scale: null` 表示「按页面尺寸算」）；
 * 「实际大小」直接 100%，并把 fitMode 退回 `none`——和手动缩放同一档，
 * 窗口再变也不抢用户的缩放（`none` 在 ResizeObserver 里就是「别动」）。
 */
export function zoomTargetPlan(target: PdfZoomTarget): {
  fitMode: 'width' | 'page' | 'none';
  scale: number | null;
} {
  if (target === 'actual') return { fitMode: 'none', scale: 1 };
  return { fitMode: target, scale: null };
}

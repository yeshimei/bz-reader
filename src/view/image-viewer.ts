/* ============================================================
 * bz-reader · 图片查看器的状态计算（view/image-viewer.ts）
 *
 * DOM 与手势挂在 reader-view（真机），这里只放能在 node 里钉死的状态：
 * 缩放档位、平移边界、翻图边界、下滑关闭、按钮显隐。
 * 逻辑集中在此，查看器改交互不用去几百行的 reader-view 里翻。
 * ============================================================ */

export interface ViewerState {
  index: number;
  total: number;
  zoom: number;
  panX: number;
  panY: number;
}

export type ViewerAction = 'prev' | 'next' | 'copy' | 'save' | 'plate' | 'reset' | 'close';

/** 滚轮缩放：向上滚（deltaY<0）放大，向下缩小，夹在 1×–4× */
export function wheelZoom(current: number, deltaY: number): number {
  const factor = deltaY < 0 ? 1.12 : 1 / 1.12;
  return Math.max(1, Math.min(4, Math.round(current * factor * 100) / 100));
}

/**
 * 缩放后新的平移量：让鼠标底下那一点图片内容保持不动（白板手感）。
 * mouse/center 是相对查看器中心的偏移，pan 是旧平移量。
 */
export function zoomAtPointer(mouse: number, center: number, pan: number, from: number, to: number): number {
  const at = mouse - center - pan; // 鼠标相对图片中心的偏移（视图坐标）
  return pan + at * (1 - to / from);
}

/**
 * 自由拖拽：拖到哪就是哪，不夹在视口内（白板可把图拖到任何地方）。
 * 保留签名是为了测试与触摸路径共用同一入口。
 */
export function freePan(offset: number, _viewport: number, _content: number): number {
  return offset;
}

/** 拖过或缩放过才需要复位按钮——原样打开时不给一堆没用的按钮 */
export function needsReset(s: ViewerState): boolean {
  return s.zoom !== 1 || s.panX !== 0 || s.panY !== 0;
}

/** 双击缩放只有两档，循环切换——无限放大会把一张糊图放到满屏马赛克 */
export function nextZoom(current: number): number {
  return current >= 2 ? 1 : 2;
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/**
 * 把平移夹在画面内：内容宽度 <= 视口时不能拖（始终 0）；
 * 否则偏移量落在 [-(内容-视口)/2, +(内容-视口)/2]。
 */
export function clampPan(offset: number, viewport: number, content: number): number {
  const slack = (content - viewport) / 2;
  if (slack <= 0) return 0;
  return Math.max(-slack, Math.min(slack, offset));
}

/** 下滑关闭：向下为主、位移够大；上滑和横向翻图都不算 */
export function closeOnSwipe(dx: number, dy: number): boolean {
  return dy > 120 && Math.abs(dy) > Math.abs(dx) * 1.5;
}

/** 当前这一屏该给哪些按钮。顺序就是工具条上的顺序。 */
export function viewerActions(state: ViewerState, opts: { bzPlate: boolean }): ViewerAction[] {
  const out: ViewerAction[] = [];
  if (state.total > 1 && state.index > 0) out.push('prev');
  if (state.total > 1 && state.index < state.total - 1) out.push('next');
  out.push('copy', 'save');
  if (needsReset(state)) out.push('reset');
  if (opts.bzPlate) out.push('plate');
  out.push('close');
  return out;
}

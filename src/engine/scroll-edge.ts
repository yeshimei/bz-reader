/* ============================================================
 * bz-reader · 滚动模式的「贴边翻章」（engine/scroll-edge.ts）
 *
 * 滚动模式下滚动的是 paginator 的 `#container`（overflow:auto），
 * foliate 自己不监听「已经滚到底了」——一章滚完就停在那里，想进下一章
 * 得点目录或点「下一章」。这个模块把「贴边之后还在继续滚」换算成翻章意图：
 *
 *   · 贴底 + 向下滚 ≥ 阈值 → 下一章
 *   · 贴顶 + 向上滚 ≥ 阈值 → 上一章
 *
 * 为什么要累加而不是一贴边就切：触控板惯性、鼠标滚轮一格一格都会在贴边后
 * 继续派发事件，一贴边就切会「一章被吞掉」。阈值取 48px，和 SWIPE_MIN 同档。
 *
 * 纯函数：host 只负责把 `start / end / viewSize` 和手势位移喂进来。
 * ============================================================ */

/** 距离边缘多少像素以内算「贴边」 */
export const SCROLL_EDGE_EPS = 2;
/** 贴边后还要继续滚多少像素才切章 */
export const SCROLL_EDGE_TURN = 48;

export type ScrollEdge = 'top' | 'bottom' | 'both' | null;

export interface ScrollEdgeMetrics {
  /** 可见区顶端（滚动偏移） */
  start: number;
  /** 可见区底端 = start + 容器高度 */
  end: number;
  /** 章节内容总高度 */
  viewSize: number;
}

/** 贴边状态。内容不足一屏时顶与底同时成立（`both`），交给滚动方向决定翻哪边 */
export function scrollEdgeOf(m: ScrollEdgeMetrics): ScrollEdge {
  if (!Number.isFinite(m.start) || !Number.isFinite(m.end) || !Number.isFinite(m.viewSize)) return null;
  if (m.viewSize <= 0) return null;
  const top = m.start <= SCROLL_EDGE_EPS;
  const bottom = m.viewSize - m.end <= SCROLL_EDGE_EPS;
  if (top && bottom) return 'both';
  if (top) return 'top';
  if (bottom) return 'bottom';
  return null;
}

export interface EdgeAccumulator {
  acc: number;
  side: 'top' | 'bottom' | null;
}

/**
 * 累加「贴边后继续滚」的位移。够阈值就返回翻章方向并清空累计。
 *
 * `delta` 用手势的**页面方向**：向下滚 / 手指上滑为正，向上滚 / 手指下滑为负。
 */
export function accumulateEdgeTurn(
  state: EdgeAccumulator,
  delta: number,
  edge: ScrollEdge,
  threshold = SCROLL_EDGE_TURN,
): { state: EdgeAccumulator; turn: 'next' | 'prev' | null } {
  const next = (edge === 'bottom' || edge === 'both') && delta > 0;
  const prev = (edge === 'top' || edge === 'both') && delta < 0;
  const turn: 'next' | 'prev' | null = next ? 'next' : prev ? 'prev' : null;
  if (!turn) return { state: { acc: 0, side: null }, turn: null };

  const side = turn === 'next' ? 'bottom' : 'top';
  const acc = (state.side === side ? state.acc : 0) + Math.abs(delta);
  if (acc < threshold) return { state: { acc, side }, turn: null };
  return { state: { acc: 0, side: null }, turn };
}

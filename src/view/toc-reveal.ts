/**
 * 目录跟随当前章：把高亮行滚进可视区。
 *
 * 以前点目录跳到第 12 篇后，面板还停在第一屏——高亮项在可视区外，读者
 * 看不到「我现在在哪」。这里只算目标 scrollTop，不调 scrollIntoView：
 * 侧栏是嵌套滚动容器，scrollIntoView 会连带滚外层（真机上整页会跳）。
 */
export interface Box {
  top: number;
  bottom: number;
}

export function revealScrollTop(current: number, item: Box, view: Box, pad = 8): number {
  const top = view.top + pad;
  const bottom = view.bottom - pad;
  if (item.top < top) return Math.max(0, current - (top - item.top));
  if (item.bottom > bottom) return Math.max(0, current + (item.bottom - bottom));
  return Math.max(0, current);
}

/* ============================================================
 * bz-reader · 分页器的「当前屏」几何（engine/visible-span.ts）
 *
 * 为什么不能直接拿 iframe 的 innerWidth 当视口宽：
 * 分页模式把整章横排进一个 iframe（围城第一章实测宽 38577px），再由
 * 外层 `translateX(-Npx)` 把当前那一屏推到宿主视口里。iframe 内部元素的
 * `getBoundingClientRect()` 是**内容坐标**，`innerWidth` 是整章宽度——
 * 拿它做「与视口相交」会把整章都算成这一页（真机：一页 207 段、预估
 * 8.15 元，实际一页只有 2 段）。
 *
 * 正确做法：把 iframe 在宿主里的位置（已含 translate）与宿主视口宽度
 * 相交，换算回内容坐标，再让段落和这个区间比。
 * ============================================================ */

/** iframe 在宿主文档里的位置（getBoundingClientRect 的结果，已含外层平移） */
export interface FrameBox {
  left: number;
  width: number;
}

/** 内容坐标里的可见横区间 */
export interface Span {
  x0: number;
  x1: number;
}

/** 块元素在内容坐标里的包围盒 */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 当前可见的横区间；iframe 完全移出宿主视口时返回 null（这一章没在显示）。
 *
 * `host` 是**阅读区**（foliate-view 元素）在宿主视口里的位置，不是整个窗口：
 * 左侧还有侧栏，把窗口当可见区会把侧栏底下的字也算进来（真机实测偏 390px，
 * 正好一栏）。留在宿主里的 iframe 只有两段矩形的交集，减掉 left 就回到内容坐标。
 */
export function visibleSpan(frame: FrameBox, host: FrameBox): Span | null {
  const left = frame.left;
  const visL = Math.max(left, host.left);
  const visR = Math.min(left + frame.width, host.left + host.width);
  /* 亚像素交集（缩放后常见 0.3px）不算可见，避免把相邻页的边缘算进来 */
  if (visR - visL < 1) return null;
  return { x0: visL - left, x1: visR - left };
}

/**
 * 块与可见区间是否相交。
 *
 * 横向用「相交」而不是「段首落在区间里」：一段可以横跨两三页（foliate
 * 不分栏断段），按段首判会漏掉后半页的字；按相交判最多把上一页的尾巴
 * 多念一遍，漏字比重复糟。
 */
export function overlapsSpan(box: Box, span: Span, height: number): boolean {
  if (box.bottom <= 0 || box.top >= height) return false;
  if (box.right <= span.x0 || box.left >= span.x1) return false;
  return true;
}

/**
 * 朗读高亮的那一行在不在当前页上（2026-11-14）。
 *
 * 描出来的框必须和「读的是不是这一屏」一致：分栏模式下 `getClientRects()`
 * 给的是整章布局坐标，屏外的句子照样有矩形，照画就会把框画到看不见的地方；
 * 更糟的是视图层用「有没有框」判断这句在不在眼前，框一多就永远不翻页
 * （真机表现：整章播完，页面一动不动）。所以这里跟 `overlapsSpan` 同一套
 * 边界规则，只是作用在单行矩形上。
 *
 * `span` 为 null（拿不到 iframe 位置，比如滚动模式）时一律放行：宁可框歪，
 * 也别把高亮整个吞掉。
 */
export function lineInSpan(rect: { left: number; right: number }, span: Span | null): boolean {
  if (!span) return true;
  return rect.right > span.x0 && rect.left < span.x1;
}

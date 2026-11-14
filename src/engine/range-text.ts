/* ============================================================
 * bz-reader · 朗读用的文字 Range（engine/range-text.ts）
 *
 * 这里所有矩形都在**同一个坐标系**里：iframe 视口。
 *
 *   · iframe 内元素的 `getBoundingClientRect()` / `getClientRects()` 给的是
 *     **视口坐标**（当前一栏 0..632），分栏时前面几页在负区；
 *   · `window.innerWidth` 才是整章宽（实测 38577）。拿它当视口宽，整章都会
 *     算成「这一页」——真机症状：站在第二页点朗读，它从第一页开头念。
 *
 * 所以「这一屏的横区间」就是 `[0, documentElement 的渲染宽]`，不需要跟宿主
 * 矩形求交、不需要减 translate。逐字符扫一遍把起点/终点找出来，一页只做
 * 一次，几十毫秒，换来的是「从屏幕第一个字开始念」。
 * ============================================================ */

export interface Span {
  x0: number;
  x1: number;
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PageSpanInput {
  /** foliate 给的当前页起点（内容坐标像素）。第一页、滚动模式都是 0 */
  start: number;
  /** 一页宽（视口宽） */
  size: number;
  /** 当前页左上角那个字符所在元素的 `left`；取不到传 NaN */
  probeLeft: number;
}

/**
 * 当前页的横区间，口径与 `cropToSpan` 里的块矩形一致。
 *
 * 页起点与一页宽都取自 foliate 自己的量（`renderer.start` / `renderer.viewSize`），
 * 不从宿主矩形推。唯一要现场判断的是「块矩形给的是内容坐标还是视口坐标」：
 * 用 caret 取到的那根字符的 `left` 当标尺——贴着 0 就是视口坐标，贴着页起点
 * 就是内容坐标。
 *
 * **别按「文档元素的渲染宽」拼区间**：那是整章宽，前面所有页都会算成可见，
 * 真机表现就是「站在第二页点朗读，它从第一页开头念」。
 */
export function pageSpan({ start, size, probeLeft }: PageSpanInput): Span | null {
  if (!(size >= 8)) return null;
  if (!(start >= 1)) return { x0: 0, x1: size };
  const viewport = Number.isFinite(probeLeft) && Math.abs(probeLeft) < Math.abs(probeLeft - start);
  return viewport ? { x0: 0, x1: size } : { x0: start, x1: start + size };
}

/** 元素的全部内容包成 Range */
export function contentRangeOf(el: Element): Range {
  const r = el.ownerDocument.createRange();
  r.selectNodeContents(el);
  return r;
}

/**
 * 把元素裁到「这一屏」的 Range；一个可见字符都没有就返回 null。
 *
 * `span` / `height` 都是**iframe 视口坐标**下这一屏的范围（见 `viewportSpan`）。
 */
export function cropToSpan(el: Element, span: Span, height: number): Range | null {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const probe = doc.createRange();
  let start: { node: Text; offset: number } | null = null;
  let end: { node: Text; offset: number } | null = null;
  let node = walker.nextNode();
  while (node) {
    const t = node as Text;
    const len = t.data.length;
    for (let i = 0; i < len; i += 1) {
      if (/\s/.test(t.data[i])) continue;
      probe.setStart(t, i);
      probe.setEnd(t, i + 1);
      const r = probe.getBoundingClientRect();
      const visible = r.right > span.x0 && r.left < span.x1 && r.bottom > 0 && r.top < height;
      if (!visible) continue;
      if (!start) start = { node: t, offset: i };
      end = { node: t, offset: i + 1 };
    }
    node = walker.nextNode();
  }
  if (!start || !end) return null;
  const out = doc.createRange();
  out.setStart(start.node, start.offset);
  out.setEnd(end.node, end.offset);
  return out;
}

/* 2026-11-14 删掉 findVisibleText / findInRange：句子定位改走
   core/tts-anchor.ts 的「块内字符偏移」，不再需要拿文本去 DOM 里搜。
   那两级搜索的最后一级会在整块里找，同一块里的重复短语、标点差异都会
   命到别处——真机表现就是离线朗读的高亮偏几个字。 */

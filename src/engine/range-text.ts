/* ============================================================
 * bz-reader · 朗读用的文字 Range（engine/range-text.ts）
 *
 * 分栏模式下有两套坐标，混用就会「念的字和屏幕上的字对不上」：
 *
 *   · `getClientRects()` / 块元素：**整章布局坐标**（实测 0–38529，一章横排）；
 *   · `caretPositionFromPoint()`：只认 **iframe 视口坐标**（0–632，当前一栏）。
 *
 * caret 取不到布局坐标 22113 处（那是第 36 页），所以「这一屏从哪开始」不能
 * 用 caret，只能拿块的行矩形跟可见区间比。逐字符扫一遍把起点/终点找出来，
 * 一页只做一次，几十毫秒，换来的是「从屏幕第一个字开始念」。
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

/** 元素的全部内容包成 Range */
export function contentRangeOf(el: Element): Range {
  const r = el.ownerDocument.createRange();
  r.selectNodeContents(el);
  return r;
}

/**
 * 把元素裁到「这一屏」的 Range；一个可见字符都没有就返回 null。
 *
 * `span` / `height` 都是**布局坐标**下这一屏的范围（见 visible-span.ts）。
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

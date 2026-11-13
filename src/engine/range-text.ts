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

/**
 * 在 Range 里找第一处 needle，返回精确子 Range；找不到返回 null。
 *
 * 把 Range 覆盖的文本节点拼成一个字符串再 `indexOf`，所以句子跨节点也
 * 找得到（引号、行内 span 常把一句话拆成几个节点）。映射回节点时按每个
 * 节点贡献的字符数累加。
 */
export function findInRange(root: Range, needle: string): Range | null {
  const text = needle.replace(/\s+/g, '');
  if (!text) return null;
  const doc = root.startContainer.ownerDocument;
  if (!doc) return null;
  const chunks: Array<{ node: Text; from: number; to: number }> = [];
  const walker = doc.createTreeWalker(root.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let full = '';
  while (node) {
    const t = node as Text;
    let from = 0;
    if (t === root.startContainer) from = root.startOffset;
    let to = t.data.length;
    if (t === root.endContainer) to = root.endOffset;
    if (to > from) {
      chunks.push({ node: t, from, to });
      full += t.data.slice(from, to);
    }
    node = walker.nextNode();
  }
  if (!chunks.length) return null;

  /* 去掉所有空白再比：原文里的换行、全角空格、段首缩进都不会出现在
     buildScript 产出的句子里，直接 indexOf 会「差一个空格就找不到」，
     然后退化成整块高亮（真机表现为整段亮起）。 */
  let flat = '';
  const map: number[] = [];
  for (let i = 0; i < full.length; i += 1) {
    const ch = full[i];
    if (/\s/.test(ch)) continue;
    map.push(i);
    flat += ch;
  }
  const at = flat.indexOf(text);
  if (at < 0) return null;
  const startAt = map[at];
  const endAt = map[at + text.length - 1] + 1;

  const locate = (offset: number): { node: Text; offset: number } | null => {
    let acc = 0;
    for (const c of chunks) {
      const len = c.to - c.from;
      if (offset >= acc && offset <= acc + len) {
        return { node: c.node, offset: c.from + (offset - acc) };
      }
      acc += len;
    }
    return null;
  };
  const start = locate(startAt);
  const end = locate(endAt);
  if (!start || !end) return null;
  const r = doc.createRange();
  r.setStart(start.node, start.offset);
  r.setEnd(end.node, end.offset);
  return r;
}

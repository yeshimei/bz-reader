/* ============================================================
 * bz-reader · 朗读锚点（core/tts-anchor.ts）
 *
 * 句子的位置不再靠「拿文本去 DOM 里搜」，而是一对整数：
 *
 *   { block: 第几块, at: 块内原始文本的起点, len: 长度 }
 *
 * 建脚本时算好（见 core/tts-script.ts），播放时按块 + 字符偏移直接造
 * Range。好处是没有第二种解释：同一块里出现十次「他说。」也不会认错，
 * 引号 / 空白 / 正文改过都不会让定位漂走。
 *
 * 2026-11-14 之前的做法是 `findVisibleText` / `findInRange` 三级文本
 * 搜索，退到最后一级（整块）时会命中上一页的同类短语——真机表现就是
 * 「离线朗读的高亮偏了一点，实时朗读不偏」。
 *
 * 本模块只做**纯计算**：偏移 → 文本节点下标；DOM 那一层是薄封装，
 * 方便在 node 里逐条断言。
 * ============================================================ */

/** 一句话在正文里的位置：第几块、块内起点、长度 */
export interface Anchor {
  block: number;
  at: number;
  len: number;
}

/** 区间落在哪些文本节点的哪些偏移上 */
export interface Located {
  startIndex: number;
  startOffset: number;
  /** 编号是 `lengths` 的下标（只数非空文本节点） */
  endIndex: number;
  endOffset: number;
}

/**
 * 字符偏移 → 文本节点定位。
 *
 * `lengths` 是块内**按文档顺序**列出的每个文本节点的长度（空节点可以
 * 直接给 0，会跳过）。返回的下标就是 `lengths` 的下标，调用方用同一份
 * 节点表取 node 即可——两边不会数岔。
 *
 * 越界处理：起点超出总长、或长度不为正，返回 null（这一句没法框，别瞎框）；
 * 终点超出总长就截到末尾，宁可少框一个字，也别整句不亮。
 */
export function locateSpan(lengths: readonly number[], at: number, len: number): Located | null {
  if (!Number.isFinite(at) || !Number.isFinite(len)) return null;
  let total = 0;
  for (const n of lengths) total += Math.max(0, n);
  if (!total) return null;

  const start = Math.max(0, Math.floor(at));
  const end = Math.min(total, start + Math.max(0, Math.floor(len)));
  if (start >= total || end <= start) return null;

  const pick = (offset: number, isEnd: boolean): { index: number; offset: number } | null => {
    let acc = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      const n = Math.max(0, lengths[i]);
      if (n === 0) continue;
      /* 终点刚好压在节点边界上时归前一个节点（setEnd 用节点末尾更自然） */
      if (isEnd && offset === acc + n) return { index: i, offset: n };
      if (offset < acc + n) return { index: i, offset: offset - acc };
      acc += n;
    }
    return null;
  };

  const s = pick(start, false);
  const e = pick(end, true);
  if (!s || !e) return null;
  return { startIndex: s.index, startOffset: s.offset, endIndex: e.index, endOffset: e.offset };
}

/** 基准 Range 覆盖到的文本片段（文档顺序，带片内起止） */
export interface TextChunk {
  node: Text;
  from: number;
  to: number;
}

/**
 * 一个 Range 覆盖到的文本片段。
 *
 * 锚点的偏移是相对**基准 Range 的起点**算的，不是相对块元素：页级朗读的
 * 基准是「裁到这一屏」的 Range，段落跨页时它从段落中间开始，按元素起点
 * 数一定错位。
 */
export function textChunksOf(range: Range): TextChunk[] {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return [];
  const root = range.commonAncestorContainer;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: TextChunk[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    if (!node.data.length) continue;
    try {
      if (!range.intersectsNode(node)) continue;
    } catch {
      /* 节点已经不在文档里：跳过 */
      continue;
    }
    let from = 0;
    if (node === range.startContainer) from = range.startOffset;
    let to = node.data.length;
    if (node === range.endContainer) to = range.endOffset;
    if (to > from) out.push({ node, from, to });
  }
  return out;
}

/**
 * 锚点 → Range。拿不到（块里没字、偏移越界）返回 null，调用方就不画框。
 *
 * Range 必须由**书页文档**创建：iframe 的 Range 在宿主文档里 setStart
 * 会直接抛（跨 realm）。
 */
export function rangeOfAnchor(base: Range, anchor: Anchor): Range | null {
  const chunks = textChunksOf(base);
  if (!chunks.length) return null;
  const located = locateSpan(
    chunks.map((c) => c.to - c.from),
    anchor.at,
    anchor.len,
  );
  if (!located) return null;
  const s = chunks[located.startIndex];
  const e = chunks[located.endIndex];
  if (!s || !e) return null;
  const doc = base.startContainer.ownerDocument;
  if (!doc) return null;
  try {
    const range = doc.createRange();
    range.setStart(s.node, s.from + located.startOffset);
    range.setEnd(e.node, e.from + located.endOffset);
    return range;
  } catch {
    return null;
  }
}

/**
 * 这组矩形里有没有一行落在 iframe 视口内（`0…w` × `0…h`）。
 *
 * 分页模式下 `getClientRects()` 给的是**当前栏的视口坐标**（屏外那一栏
 * 是负数或大于宽度），所以不需要任何宿主坐标换算：留在 iframe 里比就行。
 * 2026-11-14 之前把矩形搬回宿主再比，多出的每一步都是偏差来源。
 */
export function anyRectInView(
  rects: ArrayLike<{ left: number; right: number; top: number; bottom: number }>,
  w: number,
  h: number,
): boolean {
  if (!(w > 0) || !(h > 0)) return false;
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (r.right <= 0 || r.left >= w) continue;
    if (r.bottom <= 0 || r.top >= h) continue;
    return true;
  }
  return false;
}

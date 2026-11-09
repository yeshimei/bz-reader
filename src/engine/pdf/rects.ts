/* ============================================================
 * bz-reader · PDF 高亮矩形合并（engine/pdf/rects.ts）
 *
 * pdf.js 的文字层把每个词（有时每个字）拆成一个 `<span>`，一段话光
 * `Range.getClientRects()` 就能返回上千个矩形。直接拿来画高亮会：
 *   · 一页塞进上千个绝对定位的 div，滚动明显掉帧；
 *   · 相邻块之间的亚像素缝隙在深色底上连成一条条白线。
 *
 * 这里把「同一行、彼此相接」的矩形并成一块。只做水平合并，不跨行——
 * 跨行会变成一个大方块，把行距也一起染上色。
 *
 * 双栏 PDF 的左右栏 top 相同但中间隔着一整个栏间距，靠 `gapSlack` 分开：
 * 合并会变成横贯两栏的一条，读起来像是整段都被划了。
 * ============================================================ */

export interface PdfNormRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MergeRectsOptions {
  /** 两个矩形 top 相差多少以内算同一行（比例，默认 0.004 ≈ 3px） */
  rowSlack?: number;
  /** 同一行里两个矩形左右间隙多少以内算连着（比例，默认 0.012 ≈ 8px） */
  gapSlack?: number;
}

/** 同一行内相接的矩形合并，其余原样返回。入参不会被改动 */
export function mergeRects(
  rects: readonly PdfNormRect[],
  opts: MergeRectsOptions = {},
): PdfNormRect[] {
  const rowSlack = opts.rowSlack ?? 0.004;
  const gapSlack = opts.gapSlack ?? 0.012;
  const items = rects
    .filter((r) => r && r.width > 0 && r.height > 0)
    .map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }))
    .sort((a, b) => a.top - b.top || a.left - b.left);
  if (items.length <= 1) return items;

  /* 先按 top 分桶。排序在前，所以只要和**当前桶的第一个**比：
     同一行的碎片 top 差很小，换行时 top 会跳一整行高 */
  const rows: PdfNormRect[][] = [];
  for (const rect of items) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(rect.top - row[0].top) <= rowSlack) {
      row.push(rect);
    } else {
      rows.push([rect]);
    }
  }

  const out: PdfNormRect[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.left - b.left);
    let cur: PdfNormRect | null = null;
    for (const rect of row) {
      if (cur && rect.left <= cur.left + cur.width + gapSlack) {
        const right = Math.max(cur.left + cur.width, rect.left + rect.width);
        const bottom = Math.max(cur.top + cur.height, rect.top + rect.height);
        cur.width = right - cur.left;
        cur.height = bottom - cur.top;
        continue;
      }
      if (cur) out.push(cur);
      cur = { ...rect };
    }
    if (cur) out.push(cur);
  }
  return out;
}

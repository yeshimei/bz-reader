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
 *
 * **判行不能只看 top**（2026-11-09 真机）：pdf.js 给同一行的 span 两种盒子，
 * 一种含升部、一种只到基线，top 能差 4px、高度差 7px。按 top 分桶会把一行
 * 判成两行，画出来就是两条深浅不一的半截色块——用户的原话是「背景色很乱」。
 * 现在按**竖直重叠**判行，并行的碎片再统一成同一段竖向区间。
 * ============================================================ */

export interface PdfNormRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MergeRectsOptions {
  /** 两个矩形左右间隙多少以内算连着（比例，默认 0.012 ≈ 8px） */
  gapSlack?: number;
}

/** 竖直重叠达到较矮那个的多大比例，才算同一行 */
const ROW_OVERLAP = 0.6;

/** 同一行内相接的矩形合并，其余原样返回。入参不会被改动 */
export function mergeRects(
  rects: readonly PdfNormRect[],
  opts: MergeRectsOptions = {},
): PdfNormRect[] {
  const gapSlack = opts.gapSlack ?? 0.012;
  const items = rects
    .filter((r) => r && r.width > 0 && r.height > 0)
    .map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }))
    .sort((a, b) => a.top - b.top || a.left - b.left);
  if (items.length <= 1) return items;

  /* 按竖直重叠分行。排序在前，所以只有「当前行」需要比：
     与当前行的竖直重叠够多就并进来，否则另起一行。 */
  const rows: PdfNormRect[][] = [];
  let rowTop = 0;
  let rowBottom = 0;
  for (const rect of items) {
    const bottom = rect.top + rect.height;
    if (rows.length) {
      const overlap = Math.min(bottom, rowBottom) - Math.max(rect.top, rowTop);
      const shorter = Math.min(rect.height, rowBottom - rowTop);
      if (overlap > 0 && overlap >= shorter * ROW_OVERLAP) {
        rows[rows.length - 1].push(rect);
        rowBottom = Math.max(rowBottom, bottom);
        continue;
      }
    }
    rows.push([rect]);
    rowTop = rect.top;
    rowBottom = bottom;
  }

  const out: PdfNormRect[] = [];
  for (const row of rows) {
    /* 整行统一到同一段竖向区间：同一行里盒子高低不一，各自画就是深浅不一的
       半截条；统一之后一行只有一条，颜色也就平了。 */
    let top = Number.POSITIVE_INFINITY;
    let bottom = 0;
    for (const rect of row) {
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.top + rect.height);
    }
    row.sort((a, b) => a.left - b.left);
    let cur: PdfNormRect | null = null;
    for (const rect of row) {
      if (cur && rect.left <= cur.left + cur.width + gapSlack) {
        const right = Math.max(cur.left + cur.width, rect.left + rect.width);
        cur.width = right - cur.left;
        continue;
      }
      if (cur) out.push(cur);
      cur = { left: rect.left, top, width: rect.width, height: bottom - top };
    }
    if (cur) out.push(cur);
  }
  return out;
}

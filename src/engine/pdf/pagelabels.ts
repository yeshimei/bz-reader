/* ============================================================
 * bz-reader · PDF 页标签（engine/pdf/pagelabels.ts）
 *
 * 论文和很多书的正文页码不是从 1 开始的：前置页用 i、ii、iii，正文再从 1
 * 重新数。PDF 自己用 `/PageLabels` 记着这套映射，页脚却一直只报物理页号，
 * 于是「目录写 xii，页脚显示 13」。
 *
 * 这里只做三件纯事：把 pdf.js 给的那份标签整理干净、按页取、拼页脚文案。
 * 大量 PDF 根本没有 `/PageLabels`，所以每一层都允许「没有」。
 * ============================================================ */

import { screenRange } from './layout';

/**
 * pdf.js 的 `getPageLabels()` → 逐页标签。
 *
 * 返回数组里空项用物理页号补；**整本都和物理页号一样时返回 null**——
 * 那等于没有页标签，调用方拿 null 走原来的快路径，不必逐页比对。
 */
export function labelsFromPdf(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const out = raw.map((value, index) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || String(index + 1);
  });
  if (out.every((label, index) => label === String(index + 1))) return null;
  return out;
}

/** 某一页的标签；越界 / 没有标签时退回物理页号 */
export function labelOfPage(labels: readonly string[] | null | undefined, page: number): string {
  const n = Math.max(1, Math.floor(Number(page) || 1));
  return labels?.[n - 1] ?? String(n);
}

/**
 * 页脚文案：`4 / 278`、双页 `ii–iii / 278`。
 *
 * 与 `layout.pageLabel` 同形，只是左右两侧换成书的页码标签；总页数始终报
 * 物理页数——那是「这本书有多厚」，不该跟着罗马数字走。
 */
export function pageLabelText(
  page: number,
  total: number,
  spread: boolean,
  labels: readonly string[] | null | undefined,
): string {
  const { from, to } = screenRange(page, total, spread);
  const left = from === to ? labelOfPage(labels, from) : `${labelOfPage(labels, from)}–${labelOfPage(labels, to)}`;
  return `${left} / ${Math.max(1, Math.floor(total))}`;
}

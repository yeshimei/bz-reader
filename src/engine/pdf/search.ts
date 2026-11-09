/* ============================================================
 * bz-reader · PDF 全文搜索（engine/pdf/search.ts）
 *
 * 和 EPUB 不同，PDF 没有现成的 `view.search()`：foliate 的搜索靠章节
 * createDocument 遍历 DOM，而 PDF 的文本要逐页 `getTextContent()`。
 * 这里只负责「已经拿到每页文本之后」的纯计算：
 *   · 大小写不敏感（拉丁字母），CJK 按字面；
 *   · 每页最多 5 条，总数有上限——搜索结果面板不做虚拟滚动，
 *     一本 800 页的 PDF 出现几千条会直接把 DOM 撑爆；
 *   · 结果按页序，偏移是页文本内的下标，供跳转后定位。
 * ============================================================ */

import { excerptAt } from './text';

export interface PdfSearchHit {
  /** 1 基页码 */
  page: number;
  /** 页文本内的起始下标 */
  offset: number;
  excerpt: { pre: string; match: string; post: string };
}

/** 每页最多返回几条命中：同一页出现 50 次「的」对用户没有信息量 */
const PER_PAGE = 5;

export function searchPageTexts(
  pages: ReadonlyArray<{ page: number; text: string }>,
  query: string,
  limit = 200,
): PdfSearchHit[] {
  const q = String(query ?? '').trim();
  if (!q || !Array.isArray(pages)) return [];
  const cap = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 200));
  const needle = q.toLowerCase();
  const out: PdfSearchHit[] = [];
  for (const entry of pages) {
    if (out.length >= cap) break;
    const text = String(entry?.text ?? '');
    if (!text) continue;
    const haystack = text.toLowerCase();
    let from = 0;
    let count = 0;
    while (count < PER_PAGE && out.length < cap) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      out.push({
        page: entry.page,
        offset: at,
        excerpt: excerptAt(text, at, at + q.length),
      });
      count += 1;
      from = at + Math.max(1, q.length);
    }
  }
  return out;
}

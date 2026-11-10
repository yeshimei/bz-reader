/* ============================================================
 * bz-reader · PDF 全文搜索（engine/pdf/search.ts）
 *
 * 和 EPUB 不同，PDF 没有现成的 `view.search()`：foliate 的搜索靠章节
 * createDocument 遍历 DOM，而 PDF 的文本要逐页 `getTextContent()`。
 * 这里只负责「已经拿到每页文本之后」的纯计算：
 *   · 大小写不敏感（拉丁字母），CJK 按字面；
 *   · 每页最多 perPage 条、总数有上限——搜索结果面板不做虚拟滚动，
 *     一本 800 页的 PDF 出现几千条会直接把 DOM 撑爆；
 *   · 截断要能说清楚：`total` 是真实命中数，`hits` 只是留下来的那些，
 *     界面据此写「共 N 处 · 已显示 M 处」；
 *   · 结果按页序，偏移是页文本内的下标，供跳转后定位。
 * ============================================================ */

import { encodePdfLocator } from './locator';
import { excerptAt } from './text';

export interface PdfSearchHit {
  /** 1 基页码 */
  page: number;
  /** 页文本内的起始下标 */
  offset: number;
  /** 页文本内的结束下标（不含） */
  end: number;
  excerpt: { pre: string; match: string; post: string };
}

export interface PdfSearchOptions {
  /** 一次最多留多少条命中（默认 300） */
  limit?: number;
  /** 同一页最多留多少条（默认 50） */
  perPage?: number;
}

export interface PdfSearchResult {
  hits: PdfSearchHit[];
  /** 整本书的真实命中数，不受 limit / perPage 影响 */
  total: number;
}

/** 面板不做虚拟滚动，留太多条会把 DOM 撑爆；300 条已经够翻 */
const DEFAULT_LIMIT = 300;

/** 同一页留 50 条：以前是 5 条，同页第 6 处起根本看不见 */
const DEFAULT_PER_PAGE = 50;

function intOr(value: unknown, fallback: number): number {
  return Math.max(1, Math.floor(Number.isFinite(value) ? (value as number) : fallback));
}

export function searchPageTexts(
  pages: ReadonlyArray<{ page: number; text: string }>,
  query: string,
  opts: PdfSearchOptions = {},
): PdfSearchResult {
  const q = String(query ?? '').trim();
  if (!q || !Array.isArray(pages)) return { hits: [], total: 0 };
  const limit = intOr(opts.limit, DEFAULT_LIMIT);
  const perPage = intOr(opts.perPage, DEFAULT_PER_PAGE);
  const needle = q.toLowerCase();
  const hits: PdfSearchHit[] = [];
  let total = 0;
  for (const entry of pages) {
    const text = String(entry?.text ?? '');
    if (!text) continue;
    const haystack = text.toLowerCase();
    let from = 0;
    let count = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      /* total 照实数：命中已经放满也要把后面的页数完，界面上的「共 N 处」才对 */
      total += 1;
      if (count < perPage && hits.length < limit) {
        hits.push({
          page: entry.page,
          offset: at,
          end: at + q.length,
          excerpt: excerptAt(text, at, at + q.length),
        });
        count += 1;
      }
      from = at + Math.max(1, q.length);
    }
  }
  return { hits, total };
}

/**
 * 一条命中的定位串：`pdf/<页>/<起>-<止>`。
 *
 * 区间必须是**文字层**坐标（划线与页内高亮都按它还原），不是搜索文本的
 * 下标——搜索文本里补出来的空格在文字层里并不存在。映射缺失或越界就退回
 * 整页，宁可不精确，也不写一个会画错地方的区间。
 */
export function pdfHitLocator(hit: PdfSearchHit, layerIndex: readonly number[]): string {
  const start = layerIndex?.[hit.offset];
  const last = layerIndex?.[Math.max(hit.offset, hit.end - 1)];
  if (typeof start !== 'number' || typeof last !== 'number' || last < start) {
    return encodePdfLocator(hit.page);
  }
  return encodePdfLocator(hit.page, start, last + 1);
}

/**
 * 一段文字里 `query` 出现的所有区间（大小写不敏感，按出现顺序）。
 *
 * 搜索面板只给「第几页」；用户点进去还得自己在整页里找那一处。有了区间，
 * 视图层就能把命中落到页面上。每页单独算、上限 cap 条——一页出现几百次
 * 「的」时，画出来只会糊成一片，也没有信息量。
 */
export function rangesInText(
  text: string,
  query: string,
  cap = 40,
): Array<{ start: number; end: number }> {
  const haystack = String(text ?? '');
  const needle = String(query ?? '').trim().toLowerCase();
  if (!haystack || !needle) return [];
  const lower = haystack.toLowerCase();
  const limit = Math.max(1, Math.floor(Number.isFinite(cap) ? cap : 40));
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (out.length < limit) {
    const at = lower.indexOf(needle, from);
    if (at < 0) break;
    out.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
  return out;
}

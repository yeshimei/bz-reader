/* ============================================================
 * bz-reader · 页码数字整理（engine/page-info.ts）
 *
 * 两个来源的数字口径都不一样，业务层不该各算各的：
 *
 *   · 本章：分页器（foliate-paginator）的 `page` / `pages`。
 *     `pages` 含首尾两页空白，正文屏数 = pages - 2；`page` 是 1 基。
 *     滚动模式下分页器把整章铺成一条，没有「屏」，一律当未知。
 *
 *   · 全书：foliate 的 `location`（按 1500 字节估出来的「页」）太粗——
 *     一屏常常跨不到一个 location，翻好几页数字才动一下（2026-11-12 用户
 *     反馈）。现在改成**按章累加**：
 *       全书页码 = 前面各章页数 + 本章当前页；
 *       总页数   = 前面各章 + 本章 + 后面各章。
 *     读过的章用实测页数，没读过的按「每页字节数」估——每页字节数取
 *     已测章节的加权平均，所以字号、页边距一改，估算也跟着变。
 *     同一章内翻一页，全书页码必定 +1。
 * ============================================================ */

export interface PagePair {
  /** 1 基页码；0 = 未知 */
  page: number;
  /** 总页数；0 = 未知 */
  pages: number;
}

const UNKNOWN: PagePair = { page: 0, pages: 0 };

/** foliate 自己用的每页字节数：一章都没测过时的兜底 */
const FALLBACK_BYTES_PER_PAGE = 1500;

function positiveInt(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * 本章页码。`scrolled` 为真时直接未知：连续滚动没有「翻到第几屏」。
 */
export function chapterPageInfo(
  renderer: { page?: number; pages?: number } | null | undefined,
  scrolled: boolean,
): PagePair {
  if (scrolled || !renderer) return UNKNOWN;
  const total = positiveInt(renderer.pages);
  const pages = total > 2 ? total - 2 : 0;
  if (!pages) return UNKNOWN;
  const page = positiveInt(renderer.page);
  return { page: Math.min(pages, Math.max(1, page)), pages };
}

export interface BookPageInput {
  /** 每章字节数（book.sections 的 size）；拿不到就是 0 */
  sizes: readonly number[];
  /** 已测章节页数（章节序号 → 页数） */
  measured: ReadonlyMap<number, number>;
  /** 当前章序号 */
  index: number;
  /** 本章 1 基页码；0 = 未知 */
  pageInChapter: number;
  /** 本章页数；0 = 未知 */
  pagesInChapter: number;
}

/**
 * 全书页码（按章累加）。
 *
 * 关键点：同一章内翻一页，`page` 一定 +1；换章时上一章的实测页数已经
 * 写进 `measured`，下一页接着数。没读过的章节按字节数估，估得准不准
 * 只影响总页数，不影响「当前第几页」的连续性。
 */
export function bookPageInfo(input: BookPageInput): PagePair {
  const { sizes, measured, index, pageInChapter, pagesInChapter } = input;
  if (!sizes.length || index < 0 || index >= sizes.length) return UNKNOWN;
  if (pagesInChapter <= 0 || pageInChapter <= 0) return UNKNOWN;

  /* 每页字节数：已测章节的加权平均（总字节 / 总页数）。
     一章都没测过就退回 foliate 的 1500——只是估算起点，读完第一章就换成实测。 */
  let sizeSum = 0;
  let pageSum = 0;
  for (const [i, pages] of measured) {
    const size = positiveInt(sizes[i]);
    if (size > 0 && pages > 0) {
      sizeSum += size;
      pageSum += pages;
    }
  }
  const bytesPerPage = pageSum > 0 && sizeSum > 0 ? sizeSum / pageSum : FALLBACK_BYTES_PER_PAGE;

  const pagesOf = (i: number): number => {
    if (i === index) return pagesInChapter;
    const hit = positiveInt(measured.get(i));
    if (hit) return hit;
    const size = positiveInt(sizes[i]);
    /* 空章节（封面、版权页）算 0 页，不硬凑 1 页，否则总页数虚高 */
    return size > 0 ? Math.max(1, Math.round(size / bytesPerPage)) : 0;
  };

  let before = 0;
  let after = 0;
  for (let i = 0; i < sizes.length; i += 1) {
    const pages = pagesOf(i);
    if (i < index) before += pages;
    else if (i > index) after += pages;
  }
  return {
    page: before + Math.min(pageInChapter, pagesInChapter),
    pages: before + pagesInChapter + after,
  };
}

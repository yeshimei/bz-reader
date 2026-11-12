/* ============================================================
 * bz-reader · 页码数字整理（engine/page-info.ts）
 *
 * 两个来源的数字口径都不一样，业务层不该各算各的：
 *
 *   · 本章：分页器（foliate-paginator）的 `page` / `pages`。
 *     `pages` 含首尾两页空白，正文屏数 = pages - 2；`page` 是 1 基。
 *     滚动模式下分页器把整章铺成一条，没有「屏」，一律当未知。
 *
 *   · 全书：foliate 的 `location`（按 1500 字节估出来的「页」）。
 *     `current` 是 0 基，`total` 是总数。它不是真实排版页数，
 *     但胜在跟字号、窗口无关，整本书内是连续且稳定的。
 *
 * 两个函数都只返回「1 基页码 + 总页数」，拿不到就返回 0——
 * 调用方据此退回百分比，绝不显示「1 / 0」。
 * ============================================================ */

export interface PagePair {
  /** 1 基页码；0 = 未知 */
  page: number;
  /** 总页数；0 = 未知 */
  pages: number;
}

const UNKNOWN: PagePair = { page: 0, pages: 0 };

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

/**
 * 全书估算页码。`current` 0 基 → 展示 1 基。
 */
export function bookPageInfo(location: { current?: number; total?: number } | null | undefined): PagePair {
  if (!location) return UNKNOWN;
  const pages = positiveInt(location.total);
  if (!pages) return UNKNOWN;
  const page = positiveInt(location.current) + 1;
  return { page: Math.min(pages, Math.max(1, page)), pages };
}

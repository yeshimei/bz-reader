/* ============================================================
 * bz-reader · 阅读页页码文案（view/page-label.ts）
 *
 * EPUB / TXT 没有固定页码：排版随字号、窗口宽度变，全书页码只能按字数
 * 估算。所以这里分两档口径（2026-11-12 用户拍板「两种都做，默认关」）：
 *
 *   · chapter —— 本章第几屏 / 本章共几屏 + 全书百分比（真实数字）
 *   · book    —— 按字数估算的全书第几页 / 共几页 + 全书百分比
 *
 * 页面上只写数字（用户明确不要「本章」二字）：`3 / 12 · 42%`。
 * 两档都拿不到有效页数时退回百分比——宁可少一个数字，也别显示「1 / 0」。
 * ============================================================ */

import type { PageLabelMode } from '../data/prefs';

export type { PageLabelMode };

export interface PageLabelInput {
  /** 1 基：本章当前屏；0 = 未知 */
  pageInChapter: number;
  /** 本章文本屏数；0 = 未知（滚动模式 / 整章一屏） */
  pagesInChapter: number;
  /** 1 基：全书估算页；0 = 未知 */
  bookPage: number;
  /** 全书估算总页；0 = 未知 */
  bookPages: number;
  /** 全书进度 0..1 */
  percent: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** 有限正整数才算有效页数：负数、小数、NaN 一律当未知 */
function valid(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 页码文案。`off` 返回空串（调用方据此隐藏整块）。
 *
 * 页码越界时夹到总页数：引擎换章的空窗里可能先给旧页号配新页数，
 * 显示「13 / 12」比不显示更让人怀疑坏了。
 */
export function pageLabelText(mode: PageLabelMode, n: PageLabelInput): string {
  if (mode === 'off') return '';
  const pct = `${Math.round(clamp01(n.percent) * 100)}%`;
  const total = valid(mode === 'chapter' ? n.pagesInChapter : n.bookPages);
  const page = valid(mode === 'chapter' ? n.pageInChapter : n.bookPage);
  if (!total || !page) return pct;
  return `${Math.min(page, total)} / ${total} · ${pct}`;
}

/* ============================================================
 * bz-reader · 划线是否已在复习计划（shell/review-marks.ts）
 *
 * 工具栏是同步渲染的：打开那一刻就要决定按钮写什么，不能等一次读盘。
 * 所以这里维护一份内存缓存——
 *   · 开书时批量问一次 Review（一趟读盘，几十条也是一次）；
 *   · 加入复习成功后直接写缓存（不用再问）；
 *   · 工具栏只读缓存，永远不阻塞。
 *
 * 2026-11-20 起缓存多存一个下次复习日期：已加入的划线按「去复习 / 已排期」
 * 分状态显示，点它跳到 Review 的那张卡，不再走一遍加入流程。
 * ============================================================ */
import type { App } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import { findReviewApi, markCardKey } from '../data/review-bridge';

/** key = 书 id + 划线 id；两组之间用不可见分隔，避免拼接碰撞 */
interface MarkStatus {
  planned: boolean;
  nextReviewDate: string | null;
}
const planned = new Map<string, MarkStatus>();

function keyOf(bookId: string, markId: string): string {
  return `${bookId}\u0000${markId}`;
}

/** 这条划线已知在复习计划里（同步，纯内存） */
export function markReviewPlanned(bookId: string | undefined, markId: string | undefined): boolean {
  if (!bookId || !markId) return false;
  return planned.get(keyOf(bookId, markId))?.planned === true;
}

/** 下次复习日期（ISO）；未加入 / 未知为 null */
export function markReviewNextDate(bookId: string | undefined, markId: string | undefined): string | null {
  if (!bookId || !markId) return null;
  return planned.get(keyOf(bookId, markId))?.nextReviewDate ?? null;
}

/** 按本地日历日算状态：过去 = 逾期，今天 = 去复习，之后 = 已排期 */
export function reviewDueState(
  nextReviewDate: string | null | undefined,
  now = Date.now(),
): { due: 'overdue' | 'today' | 'future' | null; days: number | null } {
  if (!nextReviewDate) return { due: null, days: null };
  const at = new Date(nextReviewDate).getTime();
  if (!Number.isFinite(at)) return { due: null, days: null };
  const today = new Date(now);
  const target = new Date(at);
  const todayZero = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const targetZero = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const days = Math.round((targetZero - todayZero) / 86400000);
  if (days < 0) return { due: 'overdue', days: -days };
  if (days === 0) return { due: 'today', days: 0 };
  return { due: 'future', days };
}

/** 刚加入成功 / 已知在计划里：写缓存 */
export function setMarkReviewPlanned(
  bookId: string,
  markId: string,
  on = true,
  nextReviewDate: string | null = null,
): void {
  if (!bookId || !markId) return;
  const k = keyOf(bookId, markId);
  if (on) planned.set(k, { planned: true, nextReviewDate: nextReviewDate ?? planned.get(k)?.nextReviewDate ?? null });
  else planned.delete(k);
}

/** 删划线 / 换书时清掉这一本（bookId 缺省清空全部，给测试与退出用） */
export function forgetReviewMarks(bookId?: string): void {
  if (!bookId) {
    planned.clear();
    return;
  }
  const prefix = `${bookId}\u0000`;
  for (const k of [...planned.keys()]) if (k.startsWith(prefix)) planned.delete(k);
}

/**
 * 开书后批量同步：一趟 statusOf 问完这本书的所有划线。
 * 返回是否发生了变化（调用方据此决定要不要重画）。
 */
export async function refreshBookReviewMarks(app: App | undefined, book: ReaderBook | undefined): Promise<boolean> {
  if (!app || !book) return false;
  const api = findReviewApi(app);
  if (!api?.statusOf) return false;
  const marks = book.notes?.highlights ?? [];
  if (!marks.length) return false;

  const keys = marks.map((h) => markCardKey(book.id, h.id));
  const markIdOf = new Map(keys.map((k, i) => [k, marks[i]?.id ?? '']));
  let changed = false;
  try {
    const rows = await api.statusOf(keys);
    for (const row of rows) {
      const markId = markIdOf.get(row.path);
      if (!markId) continue;
      const k = keyOf(book.id, markId);
      const on = !!row.planned;
      const date = row.nextReviewDate ?? null;
      const before = planned.get(k);
      if (on) {
        if (before?.planned !== true || before.nextReviewDate !== date) {
          changed = true;
          planned.set(k, { planned: true, nextReviewDate: date });
        }
      } else if (before) {
        changed = true;
        planned.delete(k);
      }
    }
  } catch {
    /* 查询失败：保持旧缓存，不把「已知」擦掉（Review 可能只是还没初始化） */
  }
  return changed;
}

/* ============================================================
 * bz-reader · 划线是否已在复习计划（shell/review-marks.ts）
 *
 * 工具栏是同步渲染的：打开那一刻就要决定「复习」还是「已在复习」，
 * 不能等一次读盘。所以这里维护一份内存缓存——
 *   · 开书时批量问一次 Review（一趟读盘，几十条也是一次）；
 *   · 加入复习成功后直接写缓存（不用再问）；
 *   · 工具栏只读缓存，永远不阻塞。
 *
 * 只存「已知在计划里」的集合：查不到 / 没装 Review / 查询失败都按不在处理，
 * 最坏情况是按钮还写「复习」，点进去 Review 会告诉他已在计划——不会误报。
 * ============================================================ */
import type { App } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import { findReviewApi, markCardKey } from '../data/review-bridge';

/** key = 书 id + 划线 id；两组之间用不可见分隔，避免拼接碰撞 */
const planned = new Set<string>();

function keyOf(bookId: string, markId: string): string {
  return `${bookId}\u0000${markId}`;
}

/** 这条划线已知在复习计划里（同步，纯内存） */
export function markReviewPlanned(bookId: string | undefined, markId: string | undefined): boolean {
  if (!bookId || !markId) return false;
  return planned.has(keyOf(bookId, markId));
}

/** 刚加入成功 / 已知在计划里：写缓存 */
export function setMarkReviewPlanned(bookId: string, markId: string, on = true): void {
  if (!bookId || !markId) return;
  if (on) planned.add(keyOf(bookId, markId));
  else planned.delete(keyOf(bookId, markId));
}

/** 删划线 / 换书时清掉这一本（bookId 缺省清空全部，给测试与退出用） */
export function forgetReviewMarks(bookId?: string): void {
  if (!bookId) {
    planned.clear();
    return;
  }
  const prefix = `${bookId}\u0000`;
  for (const k of [...planned]) if (k.startsWith(prefix)) planned.delete(k);
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
      if (on !== planned.has(k)) {
        changed = true;
        if (on) planned.add(k);
        else planned.delete(k);
      }
    }
  } catch {
    /* 查询失败：保持旧缓存，不把「已知」擦掉（Review 可能只是还没初始化） */
  }
  return changed;
}

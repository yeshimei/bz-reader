/* ============================================================
 * bz-reader · 跨书搜索的范围（ui/cross-search-scope.ts）
 *
 * 「搜全库」经常太大：用户知道自己想找的是哪几本、或哪个分类里的书。
 * 范围只有三种：全部、某个分类、指定几本。过滤抽成纯函数，面板只管画界面。
 * ============================================================ */
import type { ReaderBook } from '../data/schema';
import { NO_SHELF } from '../data/shelves';

export type CrossSearchScope =
  | { kind: 'all' }
  | { kind: 'shelf'; shelf: string }
  | { kind: 'books'; ids: string[] };

export const ALL_BOOKS_SCOPE: CrossSearchScope = { kind: 'all' };

/**
 * 按范围筛书。
 *
 * `shelvesOf` 返回空数组表示「未分类」；分类名 `未分类` 专门拦这一类，
 * 不能拿空数组去 includes——那样一本书都匹配不上。
 */
export function filterBooksByScope(
  books: readonly ReaderBook[],
  scope: CrossSearchScope,
  shelvesOf: (book: ReaderBook) => string[],
): ReaderBook[] {
  if (scope.kind === 'shelf') {
    if (scope.shelf === NO_SHELF) return books.filter((b) => shelvesOf(b).length === 0);
    return books.filter((b) => shelvesOf(b).includes(scope.shelf));
  }
  if (scope.kind === 'books') {
    const ids = new Set(scope.ids);
    return books.filter((b) => ids.has(b.id));
  }
  return [...books];
}

/** 书架里出现过的分类名（含「未分类」），按当前书的顺序去重 */
export function shelvesInBooks(
  books: readonly ReaderBook[],
  shelvesOf: (book: ReaderBook) => string[],
): string[] {
  const seen = new Set<string>();
  for (const b of books) {
    const own = shelvesOf(b);
    if (!own.length) seen.add(NO_SHELF);
    else for (const s of own) seen.add(s);
  }
  return [...seen];
}

/** 范围的一句话文案不在这里拼：它要跟界面语言走，由面板用 t() 组装 */

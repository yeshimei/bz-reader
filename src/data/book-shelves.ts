/* ============================================================
 * bz-reader · 一本书归属多个分类（data/book-shelves.ts）
 *
 * 2026-11-18 起，一本书可以同时归到几个分类（不再用 tag 系统）。
 * 数据上保留 `book.shelf` 作为主分类（兼容旧数据与所有只读 shelfOf 的
 * 地方），新增 `book.shelves` 存完整归属；主分类恒等于 shelves[0]。
 *
 * 这里只放纯逻辑：读归属、加减一类、改名、删名。界面与 store 只负责调用。
 * ============================================================ */
import { cleanShelfName } from './shelves';

/**
 * 一本书的完整分类归属，规整去重、保序。
 *
 * 兼容旧数据：只有 `shelf` 时视作单元素；`shelves` 存在时以它为准，
 * 但把 `shelf` 也并入（防止升级过程中两边写过、丢了一边）。
 */
export function bookShelves(book: { shelf?: string; shelves?: readonly string[] }): string[] {
  const raw = [...(book.shelves ?? []), ...(typeof book.shelf === 'string' ? [book.shelf] : [])];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = cleanShelfName(item);
    /* 空串 = 未分类，不是真分类，不进归属数组 */
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** 主分类（展示用）：恒等于归属数组的第一格；没归类返回空串 */
export function primaryShelf(book: { shelf?: string; shelves?: readonly string[] }): string {
  return bookShelves(book)[0] ?? '';
}

/** 加入一个分类：已存在则不重复，保序追加 */
export function addShelf(
  book: { shelf?: string; shelves?: readonly string[] },
  name: string,
): string[] {
  const list = bookShelves(book);
  const clean = cleanShelfName(name);
  if (!clean || list.includes(clean)) return list;
  return [...list, clean];
}

/** 移出一个分类：不存在则原样返回 */
export function removeShelf(
  book: { shelf?: string; shelves?: readonly string[] },
  name: string,
): string[] {
  const clean = cleanShelfName(name);
  return bookShelves(book).filter((x) => x !== clean);
}

/**
 * 切换一个分类的归属：已在其中就移出，否则加入。
 * 菜单里勾选/取消走同一个函数，点两下就撤销。
 */
export function toggleShelf(
  book: { shelf?: string; shelves?: readonly string[] },
  name: string,
): string[] {
  const clean = cleanShelfName(name);
  return bookShelves(book).includes(clean) ? removeShelf(book, clean) : addShelf(book, clean);
}

/**
 * 分类改名：书里所有命中旧名的归属都换成新名，保序去重。
 *
 * `to` 是空串时等同「删掉这一格」——删分类就走这条路（actions 里的
 * reshapeShelfCache）。空名绝不能留在归属数组里：`shelvesOf` 会把它当成
 * 一个真实分类，书就从「未分类」和所有分类里一起消失（2026-11-18 的坑）。
 */
export function renameInBook(
  book: { shelf?: string; shelves?: readonly string[] },
  from: string,
  to: string,
): string[] {
  const oldName = cleanShelfName(from);
  const newName = cleanShelfName(to);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of bookShelves(book)) {
    const name = item === oldName ? newName : item;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * 某个分类下面有几本（菜单「名字 + 本数」用）。
 *
 * 「未分类」不在归属数组里——它表示「数组为空」，所以必须单独数：
 * 按 `list.includes(name)` 数会让那一格恒为 0。
 */
export function countInShelf(
  lists: readonly (readonly string[])[],
  name: string,
  noShelf: string,
): number {
  if (name === noShelf) return lists.filter((list) => list.length === 0).length;
  return lists.filter((list) => list.includes(name)).length;
}

/** 删分类：从书的所有归属里剔除该名 */
export function dropFromBook(
  book: { shelf?: string; shelves?: readonly string[] },
  name: string,
): string[] {
  const target = cleanShelfName(name);
  return bookShelves(book).filter((x) => x !== target);
}

/** 是否在某个分类里（「未分类」= 没有任何归属） */
export function bookInShelf(
  book: { shelf?: string; shelves?: readonly string[] },
  name: string,
  noShelf: string,
): boolean {
  if (name === noShelf) return bookShelves(book).length === 0;
  return bookShelves(book).includes(cleanShelfName(name));
}

/* ============================================================
 * bz-reader · 分类名单（data/shelves.ts）
 *
 * 2026-11-08 之前，「分类」只是书本上的一个字符串：书架上的那一排分类条
 * 是**从书上反推**出来的，没有名单，于是改名、排序、空分类全做不到——
 * 刚建好一个分类，因为里面还没书，下一次重绘就消失了。
 *
 * 这里就是那份名单的纯逻辑：规整、校验、排序、改名、删除、上下移动。
 * 界面只负责调用，不自己算顺序。
 *
 * 两个保留名：
 *   「全部」——分类条的第一格，是筛选总开关，不是分类；
 *   「未分类」——收尾那格，代表「书上没有归属」，永远排最后。
 * 两者都不许写进名单，也不许用户拿来当分类名。
 * ============================================================ */

export const ALL_SHELF = '全部';
export const NO_SHELF = '未分类';

/** 分类名长度上限：分类条是一排小标签，名字一长整排都放不下 */
const MAX_LEN = 20;

/** 去首尾空白、把中间连续空白压成一个，再截断 */
export function cleanShelfName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LEN);
}

/** '' = 可用；其余是拒掉的原因（对应语言包的 shelves.err.*） */
export type ShelfNameError = '' | 'empty' | 'reserved' | 'dup';

export function shelfNameError(raw: string, existing: readonly string[]): ShelfNameError {
  const name = cleanShelfName(raw);
  if (!name) return 'empty';
  if (name === ALL_SHELF || name === NO_SHELF) return 'reserved';
  if (existing.some((x) => cleanShelfName(x) === name)) return 'dup';
  return '';
}

/** 名单规整：清洗、去重、剔掉保留名。落盘前统一走它 */
export function cleanShelfList(list: readonly string[]): string[] {
  const seen = new Set<string>([ALL_SHELF, NO_SHELF]);
  const out: string[] = [];
  for (const raw of list) {
    const n = cleanShelfName(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * 分类条的完整顺序。
 *
 * 「全部」→ 名单里的（用户排的先后）→ 书上有但名单里没有的（按拼音兜底）
 * → 「未分类」收尾。
 *
 * 名单里的空分类照样出格子：用户刚建完就得看得见，否则他会以为没建成。
 */
export function orderShelves(saved: readonly string[], used: readonly string[]): string[] {
  const clean = cleanShelfList(saved);
  const seen = new Set<string>([ALL_SHELF, NO_SHELF, ...clean]);
  const extra: string[] = [];
  for (const raw of used) {
    const n = cleanShelfName(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    extra.push(n);
  }
  extra.sort((a, b) => a.localeCompare(b, 'zh'));
  const out = [ALL_SHELF, ...clean, ...extra];
  /* 没有「未分类」的书就不画那一格，但只要有，它必须压在最后 */
  if (used.some((u) => cleanShelfName(u) === NO_SHELF)) out.push(NO_SHELF);
  return out;
}

/** 改名：原地换掉；原名不在名单里（书自带的分类）就接在末尾 */
export function renameShelf(saved: readonly string[], from: string, to: string): string[] {
  const clean = cleanShelfList(saved);
  const name = cleanShelfName(to);
  if (!name) return clean;
  const at = clean.indexOf(cleanShelfName(from));
  if (at < 0) return clean.includes(name) ? clean : [...clean, name];
  clean[at] = name;
  return cleanShelfList(clean);
}

export function dropShelf(saved: readonly string[], name: string): string[] {
  const target = cleanShelfName(name);
  return cleanShelfList(saved).filter((x) => x !== target);
}

/**
 * 上移 / 下移一格。
 *
 * 挪一个书自带的分类（不在名单里）会把它**收进名单**——挪动本身就等于
 * 用户说「这个我要自己排」，所以顺序从这一刻起由他定了。
 */
export function moveShelf(saved: readonly string[], name: string, dir: 'up' | 'down'): string[] {
  const target = cleanShelfName(name);
  if (!target) return cleanShelfList(saved);
  const list = cleanShelfList(saved);
  if (!list.includes(target)) list.push(target);
  const i = list.indexOf(target);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

/**
 * 分类名 → 写进书里的归属。
 *
 * 「未分类」写成空串：书的归属字段留空才叫「没归类」，写死一个「未分类」
 * 会让它和用户自己起的名字混在一起，删都删不掉。
 */
export function shelfOfName(name: string): string {
  const n = cleanShelfName(name);
  return n === NO_SHELF ? '' : n;
}

/* ============================================================
 * bz-reader · 导入页的行模型（ui/import-rows.ts）
 *
 * 导入页要同时回答三件事：哪些书还没加入、哪些已经在架上、用户勾了哪几本。
 * 这三件事以前和 DOM 揉在 `import-panel.ts` 里，改一次分组就得靠真机看。
 * 抽到这里以后它们都是纯函数，测试直接盯行为。
 *
 * 两条规则写死在下面，别再改回去：
 *   · 打开页面时**一台都不勾**——默认全勾时一键就能把整库塞进书架；
 *   · 已在书架的书不进主列表，只出现在底部折叠区（`inShelf` 为真的行）。
 * ============================================================ */
import type { BookFormat } from '../data/schema';
import { titleFromPath } from '../data/book-repo';

export interface ImportRow {
  path: string;
  format: BookFormat;
  size: number;
  title: string;
  /** 这条记录已经在书架里（归档记录不算：它要能被重新勾上复活） */
  inShelf: boolean;
  /** 只有还没加入书架的行才允许为 true */
  checked: boolean;
}

/** 扫描结果 → 行。`isOnShelf` 由调用方查仓储决定（归档记录要返回 false） */
export function buildRows(
  found: ReadonlyArray<{ path: string; format: BookFormat; size: number }>,
  isOnShelf: (path: string) => boolean,
): ImportRow[] {
  return found.map((f) => ({
    path: f.path,
    format: f.format,
    size: f.size,
    title: titleFromPath(f.path),
    inShelf: isOnShelf(f.path),
    checked: false,
  }));
}

export function matchesKeyword(row: ImportRow, keyword: string): boolean {
  if (!keyword) return true;
  const k = keyword.toLowerCase();
  return row.title.toLowerCase().includes(k) || row.path.toLowerCase().includes(k);
}

export interface ImportSections {
  /** 主列表：没加入书架、且命中筛选的行（保持原顺序） */
  fresh: ImportRow[];
  /** 底部折叠区：已在书架、且命中筛选的行（保持原顺序） */
  onShelf: ImportRow[];
  /** 未加入的总数：不受筛选影响，用来决定「全选未加入」显不显示 */
  freshTotal: number;
  /** 已在书架的总数：不受筛选影响 */
  shelfTotal: number;
}

export function splitRows(rows: ReadonlyArray<ImportRow>, keyword: string): ImportSections {
  const fresh: ImportRow[] = [];
  const onShelf: ImportRow[] = [];
  let freshTotal = 0;
  let shelfTotal = 0;
  for (const row of rows) {
    if (row.inShelf) shelfTotal += 1;
    else freshTotal += 1;
    if (!matchesKeyword(row, keyword)) continue;
    if (row.inShelf) onShelf.push(row);
    else fresh.push(row);
  }
  return { fresh, onShelf, freshTotal, shelfTotal };
}

/**
 * 折叠头右侧的数字。
 * 有筛选时显示「命中 / 总数」，全命中就退回单个数字——写 5 / 5 是噪音。
 */
export function shelfCountLabel(sections: ImportSections, keyword: string): string {
  if (!keyword) return String(sections.shelfTotal);
  if (sections.onShelf.length === sections.shelfTotal) return String(sections.shelfTotal);
  return `${sections.onShelf.length} / ${sections.shelfTotal}`;
}

/**
 * 开始筛选时要不要把折叠区展开一次。
 * 不展开的话，用户搜一个已经在书架上的书名会看到「没有匹配项」，以为书丢了。
 */
export function shelfMatches(rows: ReadonlyArray<ImportRow>, keyword: string): boolean {
  if (!keyword) return false;
  return rows.some((row) => row.inShelf && matchesKeyword(row, keyword));
}

/** 真正会被「加入书架」取走的行：屏幕可见、未加入、已勾选 */
export function checkedFresh(rows: ReadonlyArray<ImportRow>, keyword: string): ImportRow[] {
  return rows.filter((row) => !row.inShelf && row.checked && matchesKeyword(row, keyword));
}

/** 「全选未加入」此刻该显示成已全选还是未全选（空集合一律不算全选） */
export function everyFreshChecked(rows: ReadonlyArray<ImportRow>, keyword: string): boolean {
  const fresh = rows.filter((row) => !row.inShelf && matchesKeyword(row, keyword));
  return fresh.length > 0 && fresh.every((row) => row.checked);
}

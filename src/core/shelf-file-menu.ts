/* ============================================================
 * bz-reader · 文件浏览器右键菜单的纯逻辑（core/shelf-file-menu.ts）
 *
 * 用户右键书文件时，菜单里该多出「加入书架」还是「移除书架」，只看两件事：
 *   ① 选中的条目摊开成书文件路径（文件夹要往下翻，笔记 / 图片不算）；
 *   ② 每条路径在书架上的状态（在架 → 移除，没在 / 已归档 → 加入）。
 *
 * 混合选中时两条各走各的：在架的移除、不在的加入，互不拖累。
 * 这里不碰 Obsidian API、不碰 DOM，真机上不好反复摆文件，逻辑全在这里测。
 * ============================================================ */
import { formatOf } from '../data/book-repo';
import type { MsgKey } from '../i18n/zh';

export interface ShelfMenuTarget {
  path: string;
  isFolder: boolean;
}

/**
 * 右键选中的条目 → 书文件路径（去重、稳定排序）。
 *
 * 文件夹按 `path + '/'` 做前缀匹配，免得 `Books` 把 `Books2` 的书也收进来；
 * 只认书格式，笔记、图片和插件数据都不进菜单。
 */
export function bookPathsFromTargets(
  targets: readonly ShelfMenuTarget[],
  vaultPaths: readonly string[],
): string[] {
  const found = new Set<string>();
  for (const t of targets) {
    if (t.isFolder) {
      const prefix = `${t.path.replace(/\/+$/, '')}/`;
      for (const p of vaultPaths) {
        if (p.startsWith(prefix) && formatOf(p)) found.add(p);
      }
    } else if (formatOf(t.path)) {
      found.add(t.path);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, 'zh'));
}

export interface ShelfMenuPlan {
  addPaths: string[];
  removePaths: string[];
}

/**
 * 按在架状态把路径分成两组。
 *
 * `onShelf` 由调用方给：只有「有记录且没归档」才算在架——归档书虽然文件还在，
 * 对书架来说等于没加入，点「加入书架」走的是复活那条路（进度划线都接上）。
 */
export function planShelfMenu(
  paths: readonly string[],
  onShelf: (path: string) => boolean,
): ShelfMenuPlan {
  const addPaths: string[] = [];
  const removePaths: string[] = [];
  for (const p of paths) {
    (onShelf(p) ? removePaths : addPaths).push(p);
  }
  return { addPaths, removePaths };
}

/** 单条不带数字，多条才在文案里带上本数 */
export function menuLabelKey(kind: 'add' | 'remove', count: number): MsgKey {
  if (kind === 'add') return count === 1 ? 'filemenu.add' : 'filemenu.addN';
  return count === 1 ? 'filemenu.remove' : 'filemenu.removeN';
}

/** 移除要二次确认：一条和一批用两种说法 */
export function confirmBodyKey(count: number): MsgKey {
  return count === 1 ? 'filemenu.confirmOne' : 'filemenu.confirmMany';
}

/* ============================================================
 * bz-reader · 分类条的显示名（shell/shelf-label.ts）
 *
 * 「全部」「未分类」是两个系统格子：既是分类条上的一格，也是筛选与存储
 * 里的值。数据层不能改名（改名会让已经存进 localStorage 的 libShelf 全部
 * 对不上），但**显示**必须跟着界面语言走——以前英文 / 日文界面的分类条
 * 最前面一格写着中文「全部」、最后一格写着「未分类」，一眼就看出半截没
 * 本地化（2026-11-09 发版复核）。
 *
 * 用户自己起的分类名原样返回：那是数据，不翻译。
 * ============================================================ */
import { t } from '../i18n';
import { ALL_SHELF, NO_SHELF } from '../data/shelves';

/** 分类条 / 归类菜单 / 分类管理里显示的分类名 */
export function shelfLabel(name: string): string {
  if (name === ALL_SHELF) return t('shelf.filter.all');
  if (name === NO_SHELF) return t('shelf.uncategorized');
  return name;
}

/* ============================================================
 * bz-reader · 书库批量选择的纯逻辑（shell/book-select.ts）
 *
 * 书库一次能勾中几十本，两件事最容易出事：
 *   1. 换了一格筛选 / 换分类 / 打了搜索词，旧选择里那几本还留着，
 *      于是「全选」或「移出书架」把看不见的书一起动了；
 *   2. 条件都变了还挂着「已选 3 本」的工具条，用户以为勾的是眼前这几本。
 *
 * 所以抽两条纯函数：`visiblePicked` 让所有批量动作只认当前可见的书，
 * `leavesBookSelect` 让浏览条件一变就自动退出多选。两者都不碰 DOM，
 * 直接测得到。
 * ============================================================ */
import type { ShellState } from './state';

/** 决定「眼前是哪批书」的六个条件。换了其中任何一个，选择就该作废。 */
export type BookSelectContext = Pick<
  ShellState,
  'studyPage' | 'libFilter' | 'libShelf' | 'libKw' | 'libSort' | 'libView'
>;

export function bookSelectContext(s: ShellState): BookSelectContext {
  return {
    studyPage: s.studyPage,
    libFilter: s.libFilter,
    libShelf: s.libShelf,
    libKw: s.libKw,
    libSort: s.libSort,
    libView: s.libView,
  };
}

export function leavesBookSelect(before: BookSelectContext, after: BookSelectContext): boolean {
  return (Object.keys(before) as Array<keyof BookSelectContext>).some((k) => before[k] !== after[k]);
}

/**
 * 选中集合 ∩ 当前可见集合，保持「先选的在前」并去重。
 *
 * 切筛选时不清 `libSel` 也安全：不可见的那些在这里自动出局，取消筛选后
 * 它们还会回来——这比在渲染层直接改状态更不容易漏掉某个切换入口。
 */
export function visiblePicked(selected: string[], visibleIds: string[]): string[] {
  const visible = new Set(visibleIds);
  return [...new Set(selected)].filter((id) => visible.has(id));
}

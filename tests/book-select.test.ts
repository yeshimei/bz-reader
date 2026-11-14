import { describe, expect, it } from 'vitest';
import { DEFAULT_SHELL_STATE, type ShellState } from '../src/shell/state';
import { bookSelectContext, leavesBookSelect, visiblePicked } from '../src/shell/book-select';

/**
 * 书库多选的两条不变量（批量归类 / 批量移出共用）。
 *
 * 1. 只有当前筛选、分类、搜索词下**看得见**的书才算选中：换一格筛选后
 *    旧选择里那几本不能跟着一起被移出书架。
 * 2. 浏览条件一变就退出多选：留着一条「已选 3 本」的工具条对着另一批书，
 *    用户会以为勾的还是眼前这几本。
 */
describe('书库多选 · 只有当前看得见的书才算选中', () => {
  it('按先选的顺序取交集，重复 id 只算一次', () => {
    expect(visiblePicked(['b', 'a'], ['a', 'b', 'c'])).toEqual(['b', 'a']);
    expect(visiblePicked(['a', 'a', 'b'], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('筛选后看不见的书自动剔除，不会被批量操作误伤', () => {
    expect(visiblePicked(['a', 'b', 'c'], ['a', 'c'])).toEqual(['a', 'c']);
    expect(visiblePicked(['gone'], [])).toEqual([]);
  });

  it('不改入参', () => {
    const selected = ['a', 'b'];
    visiblePicked(selected, ['a']);
    expect(selected).toEqual(['a', 'b']);
  });
});

describe('书库多选 · 浏览条件一变就退出', () => {
  const ctx = (patch: Partial<ShellState> = {}) => bookSelectContext({ ...DEFAULT_SHELL_STATE, ...patch });

  it('筛选 / 分类 / 搜索词 / 排序 / 视图 / 换页，六个条件任何一个变了都要退出', () => {
    const base = ctx();
    const patches: Partial<ShellState>[] = [
      { libFilter: 'fav' },
      { libShelf: '工具书' },
      { libKw: '红' },
      { libSort: 'title' },
      { libView: 'list' },
      { studyPage: 'notes' },
    ];
    for (const patch of patches) {
      expect(leavesBookSelect(base, ctx(patch)), JSON.stringify(patch)).toBe(true);
    }
  });

  it('同一个值再写一次不算变化', () => {
    expect(leavesBookSelect(ctx(), ctx({ libFilter: 'all' }))).toBe(false);
  });

  it('换书、开弹层、动笔记选择都不该打断书库多选', () => {
    const base = ctx();
    expect(leavesBookSelect(base, ctx({ bookId: 'a', overlay: null, noteSel: ['x'] }))).toBe(false);
  });
});

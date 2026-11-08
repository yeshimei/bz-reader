import { describe, expect, it } from 'vitest';
import { allPicked, toggleAll, togglePick } from '../src/shell/note-select';

describe('标注多选（纯函数）', () => {
  it('togglePick 选中 / 取消，不会重复', () => {
    expect(togglePick([], 'a')).toEqual(['a']);
    expect(togglePick(['a'], 'a')).toEqual([]);
    expect(togglePick(['a'], 'b')).toEqual(['a', 'b']);
    expect(togglePick(['a', 'b'], 'b')).toEqual(['a']);
  });

  it('toggleAll 没全选就全选，全选了再点就取消这些', () => {
    expect(toggleAll([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(toggleAll(['a'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(toggleAll(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('toggleAll 只动当前可见的那批，不可见的不被误取消', () => {
    expect(toggleAll(['a', 'c'], ['a', 'b'])).toEqual(['a', 'c', 'b']);
    expect(toggleAll(['a', 'b', 'c'], ['a', 'b'])).toEqual(['c']);
  });

  it('toggleAll 对空列表无副作用（别把已选清空）', () => {
    expect(toggleAll(['a'], [])).toEqual(['a']);
  });

  it('allPicked 只有「非空且全部选中」才算', () => {
    expect(allPicked(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(allPicked(['a'], ['a', 'b'])).toBe(false);
    expect(allPicked([], [])).toBe(false);
  });

  /* 判重与包含判断改成了 Set（D5）：语义一点没变，但批量勾选不再随条数
     平方增长。这条用例把「大批量下顺序 / 去重 / 只动可见项」钉住。 */
  it('上千条也按同样规则走：顺序保持、不重复、只动可见的那批', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `m${i}`);
    const all = toggleAll([], ids);
    expect(all).toHaveLength(2000);
    expect(all[0]).toBe('m0');
    expect(all[1999]).toBe('m1999');

    expect(toggleAll(all, ids)).toEqual([]);

    const half = ids.slice(0, 1000);
    const left = toggleAll(all, half);
    expect(left).toHaveLength(1000);
    expect(left[0]).toBe('m1000');
  });

  it('可见列表里有重复 id 时只算一条', () => {
    expect(toggleAll([], ['a', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

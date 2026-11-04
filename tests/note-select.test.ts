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
});

import { describe, expect, it } from 'vitest';
import { kbLinkLabel, kbLinkOf, upsertKbLink, type KbLink } from '../src/data/kb-entry';

/**
 * 知识盒双链：**存在划线自己身上，不写进想法**。
 *
 * 一条划线最多两格：名词一格、段落一格。同一格再存一次（比如名词笔记改了名
 * 又存一遍）是替换，不是叠加——否则工具条上会同时出现两个「看名词」。
 */
const term = (path: string, at = 1): KbLink => ({ kind: 'term', path, at });
const passage = (path: string, at = 2): KbLink => ({ kind: 'passage', path, at });

describe('upsertKbLink · 一格一条', () => {
  it('空列表放进去就是一条', () => {
    expect(upsertKbLink(undefined, term('文献/心流.md'))).toEqual([term('文献/心流.md')]);
    expect(upsertKbLink([], term('文献/心流.md'))).toEqual([term('文献/心流.md')]);
  });

  it('名词与段落各占一格，互不覆盖', () => {
    const list = upsertKbLink(upsertKbLink([], term('文献/心流.md')), passage('文献/注意力.md'));
    expect(list.map((x) => x.kind)).toEqual(['term', 'passage']);
    expect(kbLinkOf(list, 'term')?.path).toBe('文献/心流.md');
    expect(kbLinkOf(list, 'passage')?.path).toBe('文献/注意力.md');
  });

  it('同一格再存是替换（笔记改名后不留旧链接）', () => {
    const once = upsertKbLink([], term('文献/心流.md', 1));
    const twice = upsertKbLink(once, term('文献/心流（新版）.md', 9));
    expect(twice).toHaveLength(1);
    expect(twice[0].path).toBe('文献/心流（新版）.md');
    expect(twice[0].at).toBe(9);
  });

  it('路径为空的一律不收', () => {
    expect(upsertKbLink(undefined, term(''))).toEqual([]);
    expect(upsertKbLink([term('a.md')], term('   '))).toEqual([term('a.md')]);
  });

  it('反面括号与反斜杠统一成正斜杠，去掉 .md 之外不动大小写', () => {
    const list = upsertKbLink([], term('文献\\心流.MD'));
    expect(list[0].path).toBe('文献/心流.MD');
  });
});

describe('kbLinkOf · 取某一格', () => {
  it('没有就是 undefined', () => {
    expect(kbLinkOf(undefined, 'term')).toBeUndefined();
    expect(kbLinkOf([], 'passage')).toBeUndefined();
    expect(kbLinkOf([term('a.md')], 'passage')).toBeUndefined();
  });
});

describe('kbLinkLabel · 显示名', () => {
  it('取笔记名，去掉 .md', () => {
    expect(kbLinkLabel('文献/心流.md')).toBe('心流');
    expect(kbLinkLabel('文献/注意力')).toBe('注意力');
  });

  it('空路径给空串，不抛错', () => {
    expect(kbLinkLabel('')).toBe('');
    expect(kbLinkLabel(undefined as unknown as string)).toBe('');
  });
});

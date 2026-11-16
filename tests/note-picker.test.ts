import { describe, expect, it } from 'vitest';
import {
  groupNotes,
  searchNotes,
  togglePicked,
  type PickerNote,
} from '../src/shell/note-picker';
import { notePickerListHtml } from '../src/shell/render/sidebar';

/* ============================================================
 * 侧栏 AI · 连接笔记浮层：纯计算层。
 *
 * 这里只断言行为：怎么分组、怎么勾选、全库里怎么按词找。
 * 不碰 DOM，才能在 node 里直接跑。
 * ============================================================ */

const note = (title: string, path: string, desc = ''): PickerNote => ({ title, path, desc });

describe('groupNotes · 按所在目录分组', () => {
  it('按 desc 分组，组内保持原来的先后顺序', () => {
    const rows = [
      note('围城', 'notes/AI/围城.md', 'notes/AI'),
      note('MECHA', 'games/MECHA.md', 'games'),
      note('Cat Mail', 'games/Cat.md', 'games'),
    ];
    const groups = groupNotes(rows);
    expect(groups.map((g) => g.group)).toEqual(['notes/AI', 'games']);
    expect(groups[1].rows.map((r) => r.title)).toEqual(['MECHA', 'Cat Mail']);
  });

  it('目录相同的笔记收进同一组，不重复出现', () => {
    const groups = groupNotes([
      note('a', 'x/a.md', 'x'),
      note('b', 'x/b.md', 'x'),
      note('c', 'y/c.md', 'y'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('没有目录的笔记也能成组，不丢', () => {
    const groups = groupNotes([note('root', 'root.md', '')]);
    expect(groups).toEqual([{ group: '', rows: [note('root', 'root.md', '')] }]);
  });

  it('不改传进来的数组', () => {
    const rows = [note('a', 'a.md', 'x')];
    groupNotes(rows);
    expect(rows).toEqual([note('a', 'a.md', 'x')]);
  });
});

describe('togglePicked · 勾选集合', () => {
  it('不在集合里就加进去', () => {
    expect(togglePicked([], 'a.md')).toEqual(['a.md']);
  });

  it('已经在集合里就去掉', () => {
    expect(togglePicked(['a.md', 'b.md'], 'a.md')).toEqual(['b.md']);
  });

  it('重复点同一条不会攒出两份', () => {
    const once = togglePicked([], 'a.md');
    expect(togglePicked(once, 'a.md')).toEqual([]);
  });

  it('不改传进来的数组', () => {
    const picked = ['a.md'];
    togglePicked(picked, 'b.md');
    expect(picked).toEqual(['a.md']);
  });
});

describe('searchNotes · 全库过滤', () => {
  const all = [
    note('围城', 'notes/AI/围城.md', 'notes/AI'),
    note('MECHA CHAMELEON', 'games/mecha.md', 'games'),
    note('Cat Mail Co.', 'games/cat.md', 'games'),
    note('Librarian', 'books/library/librarian.md', 'books/library'),
  ];

  it('没给关键词时按顺序取前 limit 条', () => {
    expect(searchNotes(all, '', 2).map((n) => n.title)).toEqual(['围城', 'MECHA CHAMELEON']);
  });

  it('关键词命中标题', () => {
    expect(searchNotes(all, 'cat', 20).map((n) => n.title)).toEqual(['Cat Mail Co.']);
  });

  it('关键词命中路径', () => {
    expect(searchNotes(all, 'library', 20).map((n) => n.title)).toEqual(['Librarian']);
  });

  it('关键词命中所在目录', () => {
    expect(searchNotes(all, 'games', 20).map((n) => n.title)).toEqual(['MECHA CHAMELEON', 'Cat Mail Co.']);
  });

  it('不区分大小写', () => {
    expect(searchNotes(all, 'MECHA', 20)).toHaveLength(1);
    expect(searchNotes(all, 'mecha', 20)).toHaveLength(1);
  });

  it('关键词两头的空格不算数', () => {
    expect(searchNotes(all, '  cat  ', 20)).toHaveLength(1);
  });

  it('中文关键词照样能找', () => {
    expect(searchNotes(all, '围城', 20).map((n) => n.title)).toEqual(['围城']);
  });

  it('命中再多也只给 limit 条', () => {
    expect(searchNotes(all, 'a', 2)).toHaveLength(2);
  });

  it('找不到就给空', () => {
    expect(searchNotes(all, '不存在的笔记', 20)).toEqual([]);
  });
});

describe('notePickerListHtml · 浮层列表', () => {
  it('按目录分组，同一目录只出一个组标题', () => {
    const html = notePickerListHtml([note('a', 'a.md', 'x'), note('b', 'b.md', 'x')], '', []);
    expect(html).toContain('bzs-pk-group');
    expect(html.match(/bzs-pk-group/g)).toHaveLength(1);
  });

  it('勾上的行带 is-on 和 aria-pressed', () => {
    const html = notePickerListHtml([note('a', 'a.md', 'x')], '', ['a.md']);
    expect(html).toContain('bzs-pk-row is-on');
    expect(html).toContain('aria-pressed="true"');
  });

  it('搜索能捞到默认列表之外的笔记（全库，不是最近 20 篇）', () => {
    const rows = Array.from({ length: 50 }, (_, i) => note(`note${i}`, `p/${i}.md`, 'p'));
    rows.push(note('老笔记', 'archive/old.md', 'archive'));
    const html = notePickerListHtml(rows, 'old', []);
    expect(html).toContain('老笔记');
  });

  it('搜不到时给空态', () => {
    expect(notePickerListHtml([note('a', 'a.md', 'x')], '不存在', [])).toContain('bzs-pk-empty');
  });
});

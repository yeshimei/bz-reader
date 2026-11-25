import { describe, expect, it } from 'vitest';
import type { BookFormat } from '../src/data/schema';
import {
  buildRows,
  checkedFresh,
  everyFreshChecked,
  matchesKeyword,
  shelfCountLabel,
  shelfMatches,
  splitRows,
  type ImportRow,
} from '../src/ui/import-rows';

/* ============================================================
 * 导入页的分组与勾选（2026-11-25）。
 *
 * 两件事被抽成纯函数再测，因为 dom-stub 没有事件系统，挂载路径
 * 测不了点击；而这两条恰好是「点错一下就出事」的地方：
 *   1. 主列表只放还没加入书架的书，已加入的收进底部折叠区；
 *   2. 打开页面时一台都不勾（以前默认全勾，一键就能把整库塞进书架）。
 * ============================================================ */

function found(path: string, size = 1024, format: BookFormat = 'epub') {
  return { path, format, size };
}

function row(path: string, inShelf: boolean, checked = false): ImportRow {
  return {
    path,
    format: 'epub',
    size: 1024,
    title: path.split('/').pop()!.replace(/\.[^.]+$/, ''),
    inShelf,
    checked,
  };
}

describe('buildRows：默认一台都不勾', () => {
  it('没在书架的书进来也是未勾选', () => {
    const rows = buildRows([found('Books/甲.epub'), found('Books/乙.epub')], () => false);
    expect(rows.map((r) => r.checked)).toEqual([false, false]);
  });

  it('已在书架的书同样不勾，并带上 inShelf', () => {
    const rows = buildRows([found('Books/丙.epub')], () => true);
    expect(rows[0].inShelf).toBe(true);
    expect(rows[0].checked).toBe(false);
  });

  it('书名从路径推，格式与大小原样带过来', () => {
    const rows = buildRows([found('Books/历史/万历十五年.epub', 2048)], () => false);
    expect(rows[0]).toMatchObject({
      path: 'Books/历史/万历十五年.epub',
      title: '万历十五年',
      size: 2048,
      format: 'epub',
    });
  });
});

describe('splitRows：主列表与折叠区分家', () => {
  const rows = [
    row('Books/a.epub', false),
    row('Books/b.epub', true),
    row('Books/c.epub', false),
    row('Books/d.epub', true),
  ];

  it('主列表里不出现已在书架的书', () => {
    const sec = splitRows(rows, '');
    expect(sec.fresh.map((r) => r.path)).toEqual(['Books/a.epub', 'Books/c.epub']);
  });

  it('折叠区保持原列表顺序，不重排', () => {
    const sec = splitRows(rows, '');
    expect(sec.onShelf.map((r) => r.path)).toEqual(['Books/b.epub', 'Books/d.epub']);
  });

  it('总数不受筛选影响', () => {
    const sec = splitRows(rows, 'a.epub');
    expect(sec.freshTotal).toBe(2);
    expect(sec.shelfTotal).toBe(2);
  });

  it('筛选同时作用两边：书名或路径命中', () => {
    const mixed = [row('Books/历史/万历十五年.epub', false), row('Books/历史/明朝那些事儿.epub', true)];
    const byTitle = splitRows(mixed, '明朝');
    expect(byTitle.fresh).toHaveLength(0);
    expect(byTitle.onShelf.map((r) => r.title)).toEqual(['明朝那些事儿']);

    const byPath = splitRows(mixed, 'Books/历史');
    expect(byPath.fresh).toHaveLength(1);
    expect(byPath.onShelf).toHaveLength(1);
  });

  it('空关键词等于不筛', () => {
    const sec = splitRows(rows, '');
    expect(sec.fresh.length + sec.onShelf.length).toBe(rows.length);
  });
});

describe('matchesKeyword', () => {
  it('大小写不敏感', () => {
    expect(matchesKeyword(row('Books/Dune.epub', false), 'dune')).toBe(true);
  });
  it('空关键词一律命中', () => {
    expect(matchesKeyword(row('Books/x.epub', false), '')).toBe(true);
  });
});

describe('shelfCountLabel：折叠头右侧计数', () => {
  const base = { fresh: [], onShelf: [], freshTotal: 0, shelfTotal: 5 };

  it('没筛选时只报总数', () => {
    expect(shelfCountLabel(base, '')).toBe('5');
  });

  it('筛选命中一部分时显示 命中 / 总数', () => {
    expect(shelfCountLabel({ ...base, onShelf: [row('a', true), row('b', true)] }, '三体')).toBe('2 / 5');
  });

  it('筛选命中全部时就只报一个数，不写 5 / 5', () => {
    const all = [row('a', true), row('b', true), row('c', true), row('d', true), row('e', true)];
    expect(shelfCountLabel({ ...base, onShelf: all }, 'Books')).toBe('5');
  });
});

describe('shelfMatches：筛选时自动展开折叠区的判据', () => {
  const rows = [row('Books/a.epub', false), row('Books/三体.epub', true)];

  it('关键词命中已加入的书 → 展开', () => {
    expect(shelfMatches(rows, '三体')).toBe(true);
  });

  it('只命中未加入的书 → 不展开', () => {
    expect(shelfMatches(rows, 'a.epub')).toBe(false);
  });

  it('空关键词 → 不展开（打开页面时保持收起）', () => {
    expect(shelfMatches(rows, '')).toBe(false);
  });
});

describe('checkedFresh：真正会被加入的只有这些', () => {
  const rows = [
    row('Books/a.epub', false, true),
    row('Books/b.epub', false, true),
    row('Books/c.epub', false, false),
    row('Books/d.epub', true, true), // 已在书架，即使 checked 是脏的也不能进
  ];

  it('只取未加入且勾中的', () => {
    expect(checkedFresh(rows, '').map((r) => r.path)).toEqual(['Books/a.epub', 'Books/b.epub']);
  });

  it('被筛掉的行即使勾着也不算', () => {
    expect(checkedFresh(rows, 'a.epub').map((r) => r.path)).toEqual(['Books/a.epub']);
  });

  it('已在书架的脏 checked 不会把书重复加入', () => {
    expect(checkedFresh([rows[3]!], '')).toHaveLength(0);
  });
});

describe('everyFreshChecked：全选按钮的当前状态', () => {
  it('可见的全勾了才算全选', () => {
    const rows = [row('Books/a.epub', false, true), row('Books/b.epub', false, true)];
    expect(everyFreshChecked(rows, '')).toBe(true);
  });

  it('有一台没勾就不算', () => {
    const rows = [row('Books/a.epub', false, true), row('Books/b.epub', false, false)];
    expect(everyFreshChecked(rows, '')).toBe(false);
  });

  it('可见范围内全勾了也算，哪怕屏幕外还有没勾的', () => {
    const rows = [row('Books/a.epub', false, true), row('Books/b.epub', false, false)];
    expect(everyFreshChecked(rows, 'a.epub')).toBe(true);
  });

  it('一台可加入的都没有时不谎报全选', () => {
    expect(everyFreshChecked([row('Books/d.epub', true)], '')).toBe(false);
  });
});

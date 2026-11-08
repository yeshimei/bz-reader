import { describe, expect, it } from 'vitest';
import { makeBook } from '../src/data/book-repo';
import { sanitizeData } from '../src/data/store';
import { shelfOf } from '../src/shell/domain';
import { hydrateLibrary } from '../src/shell/state';
import {
  ALL_SHELF,
  NO_SHELF,
  cleanShelfName,
  dropShelf,
  moveShelf,
  orderShelves,
  renameShelf,
  shelfNameError,
  shelfOfName,
} from '../src/data/shelves';

/**
 * 分类名单（2026-11-08）。
 *
 * 之前「分类」只是书上的一个字符串：书架上的分类条从书反推出来，没有名单、
 * 不能改名、不能排序，空分类建完就消失。这个模块就是那份名单的纯逻辑——
 * 顺序、改名、删除、上移下移，全部在这里定，界面只负责调用。
 *
 * 「全部」是筛选条上的第一格、「未分类」是收尾那格，两个都不是真分类：
 * 名单里不许出现它们，用户也不能拿它们当名字。
 */

describe('名字规整', () => {
  it('去首尾空白、把中间连续空白压成一个', () => {
    expect(cleanShelfName('  工具   书 ')).toBe('工具 书');
  });

  it('全空白等于没写', () => {
    expect(cleanShelfName('   ')).toBe('');
  });

  it('过长截到 20 字：分类条是一排小标签，名字长了整排都放不下', () => {
    expect(cleanShelfName('书'.repeat(30))).toHaveLength(20);
  });
});

describe('名字校验', () => {
  it('空名字拒掉', () => {
    expect(shelfNameError('  ', [])).toBe('empty');
  });

  it('「全部」「未分类」是留着用的名字，不许当分类名', () => {
    expect(shelfNameError(ALL_SHELF, [])).toBe('reserved');
    expect(shelfNameError(NO_SHELF, [])).toBe('reserved');
  });

  it('重名拒掉（先规整再比）', () => {
    expect(shelfNameError(' 工具书 ', ['工具书'])).toBe('dup');
  });

  it('不重名就放行', () => {
    expect(shelfNameError('工具书', ['小说'])).toBe('');
  });
});

describe('分类条顺序', () => {
  it('全部 → 名单里的（用户排的顺序）→ 书上带出来的 → 未分类收尾', () => {
    expect(orderShelves(['工具书', '小说'], ['小说', '传记', NO_SHELF])).toEqual([
      ALL_SHELF,
      '工具书',
      '小说',
      '传记',
      NO_SHELF,
    ]);
  });

  it('空分类照样占一格：刚建完就看得到，不然会以为没建成', () => {
    expect(orderShelves(['今年要读'], [])).toEqual([ALL_SHELF, '今年要读']);
  });

  it('名单独有的分类不出现在条上以外的位置：没书也留在自己那一格', () => {
    const list = orderShelves(['A', 'B', 'C'], ['B']);
    expect(list).toEqual([ALL_SHELF, 'A', 'B', 'C']);
  });

  it('没有「未分类」的书就不画那一格', () => {
    expect(orderShelves([], ['小说'])).toEqual([ALL_SHELF, '小说']);
  });

  it('名单里的重复项只留一份', () => {
    expect(orderShelves(['小说', '小说', ' A '], [])).toEqual([ALL_SHELF, '小说', 'A']);
  });
});

describe('改名', () => {
  it('原地改名，位置不变', () => {
    expect(renameShelf(['A', 'B', 'C'], 'B', '传记')).toEqual(['A', '传记', 'C']);
  });

  it('改的是书自带分类（不在名单里）：新名字接在末尾', () => {
    expect(renameShelf(['A'], '小说', '长篇小说')).toEqual(['A', '长篇小说']);
  });

  it('改成同一个名字等于没改', () => {
    expect(renameShelf(['A', 'B'], 'B', 'B')).toEqual(['A', 'B']);
  });
});

describe('删除', () => {
  it('只把名字从名单里拿掉', () => {
    expect(dropShelf(['A', 'B'], 'A')).toEqual(['B']);
  });

  it('删不存在的名字不出错', () => {
    expect(dropShelf(['A'], '不存在')).toEqual(['A']);
  });
});

describe('上移 / 下移', () => {
  it('上移与相邻那格换位', () => {
    expect(moveShelf(['A', 'B', 'C'], 'B', 'up')).toEqual(['B', 'A', 'C']);
  });

  it('下移与相邻那格换位', () => {
    expect(moveShelf(['A', 'B', 'C'], 'B', 'down')).toEqual(['A', 'C', 'B']);
  });

  it('已经在头 / 尾就原样返回', () => {
    expect(moveShelf(['A', 'B'], 'A', 'up')).toEqual(['A', 'B']);
    expect(moveShelf(['A', 'B'], 'B', 'down')).toEqual(['A', 'B']);
  });

  it('书自带的分类被挪一次就进名单：挪动本身就等于「我要自己排它」', () => {
    expect(moveShelf(['A'], '小说', 'up')).toEqual(['小说', 'A']);
  });
});

describe('把名字翻译成书名上的归属', () => {
  it('「未分类」写进书里就是空串：书的归属字段留空才叫没归类', () => {
    expect(shelfOfName(NO_SHELF)).toBe('');
  });

  it('普通分类原样写', () => {
    expect(shelfOfName('工具书')).toBe('工具书');
  });
});

/**
 * 「明确未分类」与「没表过态」是两件事（2026-11-08）。
 *
 * 书里的 `shelf` 字段缺席时，分类会回落到 EPUB 自带的 subjects——那是导入
 * 时的默认值，不是用户的选择。用户点了「移出分类」或删掉这一类，必须留下
 * 一个明确的「这本书不属于任何分类」，否则读一次盘就被 subjects 顶回去，
 * 看起来像「删不干净」。
 */
describe('明确未分类 vs 没表过态', () => {
  const oneBook = () => {
    const b = makeBook('书/a.epub', 'epub', 100);
    b.id = 'b-1';
    b.meta.subjects = ['小说'];
    return b;
  };

  it('没有任何归属记录时，回落到书自带的分类', () => {
    hydrateLibrary([{ id: 'b-1' }], 20, []);
    expect(shelfOf(oneBook())).toBe('小说');
  });

  it('写了空串就是「未分类」，不再回落到书自带的分类', () => {
    hydrateLibrary([{ id: 'b-1', shelf: '' }], 20, []);
    expect(shelfOf(oneBook())).toBe(NO_SHELF);
  });

  it('读盘重建时不能把空串丢掉：丢了就等于撤销了用户的选择', () => {
    const b = oneBook();
    b.shelf = '';
    b.reading = { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] };
    b.notes = { highlights: [], excerpts: [], bookmarks: [] };
    const data = sanitizeData({ version: 1, schemaVersion: 3, books: [b] });
    expect(data?.books[0]?.shelf).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import {
  addShelf,
  bookInShelf,
  bookShelves,
  countInShelf,
  dropFromBook,
  primaryShelf,
  removeShelf,
  renameInBook,
  toggleShelf,
} from '../src/data/book-shelves';

/**
 * 一本书归入多个分类（2026-11-18）。
 *
 * 旧数据只有 `shelf` 单值，新数据多了 `shelves`。主分类恒等于 shelves[0]，
 * 让所有只读 shelfOf 的地方（统计、书库头栏）不感知这次升级。
 */
describe('读归属：兼容旧单值与新多值', () => {
  it('只有旧 shelf 时视作单元素', () => {
    expect(bookShelves({ shelf: '小说' })).toEqual(['小说']);
  });

  it('新 shelves 完整返回、保序', () => {
    expect(bookShelves({ shelves: ['想看', '科幻'] })).toEqual(['想看', '科幻']);
  });

  it('两边都写过时合并去重、 shelf 排最后', () => {
    expect(bookShelves({ shelf: '小说', shelves: ['想看', '小说'] })).toEqual(['想看', '小说']);
  });

  it('空串与空白不算真分类', () => {
    expect(bookShelves({ shelf: '', shelves: [' ', '科幻'] })).toEqual(['科幻']);
  });

  it('主分类就是第一格，没归类返回空串', () => {
    expect(primaryShelf({ shelves: ['想看', '科幻'] })).toBe('想看');
    expect(primaryShelf({ shelf: '' })).toBe('');
  });
});

describe('加减归属', () => {
  it('加入一个新分类，追加在末尾', () => {
    expect(addShelf({ shelves: ['想看'] }, '科幻')).toEqual(['想看', '科幻']);
  });

  it('重复加入不改变', () => {
    expect(addShelf({ shelves: ['想看', '科幻'] }, '科幻')).toEqual(['想看', '科幻']);
  });

  it('移出一个分类，其余保序', () => {
    expect(removeShelf({ shelves: ['想看', '科幻', '经典'] }, '科幻')).toEqual(['想看', '经典']);
  });

  it('切换：已在这类就移出（点两下撤销）', () => {
    const b = { shelves: ['想看', '科幻'] };
    expect(toggleShelf(b, '科幻')).toEqual(['想看']);
    expect(toggleShelf(b, '经典')).toEqual(['想看', '科幻', '经典']);
  });
});

describe('改名与删除', () => {
  it('分类改名：书里所有命中旧名的都换掉', () => {
    expect(renameInBook({ shelves: ['想看', '科幻'] }, '科幻', '硬科幻')).toEqual(['想看', '硬科幻']);
  });

  it('改名后与已有分类撞名会去重', () => {
    expect(renameInBook({ shelves: ['A', 'B'] }, 'B', 'A')).toEqual(['A']);
  });

  it('删分类：从归属里剔除，其余不动', () => {
    expect(dropFromBook({ shelves: ['想看', '科幻', '经典'] }, '科幻')).toEqual(['想看', '经典']);
  });

  /**
   * 删分类的第二条路：菜单上的「删除」是改名成空串（actions 的
   * reshapeShelfCache(name, '')）。空名绝不能留在归属数组里——留着的话
   * shelvesOf 会说「有归属」，那本书就从「未分类」和所有分类里一起消失。
   */
  it('改名成空串等于剔掉这一格，不留空名', () => {
    expect(renameInBook({ shelves: ['科幻'] }, '科幻', '')).toEqual([]);
    expect(renameInBook({ shelves: ['想看', '科幻'] }, '科幻', '')).toEqual(['想看']);
  });
});

describe('分类菜单的本数', () => {
  const noShelf = '未分类';

  it('普通分类数命中它的书', () => {
    expect(countInShelf([['想看', '科幻'], ['科幻'], []], '科幻', noShelf)).toBe(2);
  });

  /** 「未分类」不是归属数组里的一个名字，是「数组为空」。按名字数会恒为 0。 */
  it('未分类数的是没有归属的书', () => {
    expect(countInShelf([['想看'], [], ['科幻']], noShelf, noShelf)).toBe(1);
    expect(countInShelf([[], []], noShelf, noShelf)).toBe(2);
  });
});

describe('筛选命中', () => {
  const noShelf = '未分类';
  it('多分类里任一命中即算在这类', () => {
    expect(bookInShelf({ shelves: ['想看', '科幻'] }, '科幻', noShelf)).toBe(true);
    expect(bookInShelf({ shelves: ['想看', '科幻'] }, '传记', noShelf)).toBe(false);
  });

  it('没有任何归属才算未分类', () => {
    expect(bookInShelf({ shelf: '' }, noShelf, noShelf)).toBe(true);
    expect(bookInShelf({ shelves: ['想看'] }, noShelf, noShelf)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { shelfNames } from '../src/shell/adapt';
import type { BookRow } from '../src/shell/adapt';
import { ALL_SHELF, NO_SHELF } from '../src/data/shelves';

/** 只测分类条这一列，别的字段不参与，给个最小行 */
function row(shelf: string): BookRow {
  return { shelf } as BookRow;
}

/**
 * 书架上的分类条（2026-11-08）。
 *
 * 顺序不再是「拼音排序」：用户自己排过的名单优先，书自带的分类跟在后面，
 * 「未分类」永远收尾。以前全按 zh 排序，「未分类」会跑到中间去。
 */
describe('shelfNames · 分类条顺序', () => {
  it('第一格永远是「全部」', () => {
    expect(shelfNames([], [])[0]).toBe(ALL_SHELF);
  });

  it('名单顺序压过拼音顺序', () => {
    expect(shelfNames([row('小说'), row('工具书')], ['工具书', '小说'])).toEqual([
      ALL_SHELF,
      '工具书',
      '小说',
    ]);
  });

  it('书上有、名单里没有的分类跟在后面', () => {
    expect(shelfNames([row('小说'), row('传记')], ['小说'])).toEqual([ALL_SHELF, '小说', '传记']);
  });

  it('「未分类」永远在最后一格', () => {
    expect(shelfNames([row(NO_SHELF), row('小说')], ['小说'])).toEqual([
      ALL_SHELF,
      '小说',
      NO_SHELF,
    ]);
  });

  it('空分类也占一格（名单里存着就画）', () => {
    expect(shelfNames([row('小说')], ['今年要读', '小说'])).toEqual([
      ALL_SHELF,
      '今年要读',
      '小说',
    ]);
  });
});

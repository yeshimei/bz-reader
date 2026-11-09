import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n';
import { ALL_SHELF, NO_SHELF } from '../src/data/shelves';
import { shelfLabel } from '../src/shell/shelf-label';

/**
 * 分类条的显示名（2026-11-09 发版复核）。
 *
 * 「全部」「未分类」既是分类条上的两格，也是筛选与存储里的值——所以数据层
 * 不能改名（改了已存的 libShelf 对不上）。但**显示**必须走语言包：
 * 以前英文 / 日文界面的分类条最前面一格写着「全部」、最后一格写着「未分类」，
 * 用户自己起的分类名夹在中间，一眼就看出半截没本地化。
 */

afterEach(() => {
  setLocale('zh');
});

describe('分类名与系统格子的显示名', () => {
  it('两个系统格子走语言包', () => {
    expect(shelfLabel(ALL_SHELF)).toBe('全部');
    expect(shelfLabel(NO_SHELF)).toBe('未分类');
    setLocale('en');
    expect(shelfLabel(ALL_SHELF)).toBe('All');
    expect(shelfLabel(NO_SHELF)).toBe('Uncategorized');
  });

  it('用户自己起的分类名原样返回，不翻译', () => {
    setLocale('en');
    expect(shelfLabel('工具书')).toBe('工具书');
    expect(shelfLabel('Reference')).toBe('Reference');
  });

  it('繁体界面用繁体写法', () => {
    setLocale('zh-TW');
    expect(shelfLabel(NO_SHELF)).toBe('未分類');
  });
});

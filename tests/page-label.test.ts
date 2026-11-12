import { describe, expect, it } from 'vitest';
import { pageLabelText, type PageLabelInput } from '../src/view/page-label';

/* 页码显示的文案规则（2026-11-12 用户拍板）：
   · 三档：关 / 本章 / 全书；
   · 页面上只写数字：`3 / 12`，不写「本章」「全书」，也不要百分比；
   · 拿不到有效页数（滚动模式 / 还没定位）整块不显示。 */

function nums(over: Partial<PageLabelInput> = {}): PageLabelInput {
  return {
    pageInChapter: 3,
    pagesInChapter: 12,
    bookPage: 123,
    bookPages: 456,
    ...over,
  };
}

describe('阅读页页码文案', () => {
  it('关：一律空串', () => {
    expect(pageLabelText('off', nums())).toBe('');
  });

  it('本章：本章第几屏 / 本章共几屏', () => {
    expect(pageLabelText('chapter', nums())).toBe('3 / 12');
  });

  it('全书：按字数估算的全书页码', () => {
    expect(pageLabelText('book', nums())).toBe('123 / 456');
  });

  it('本章缺页数（滚动模式 / 整章一屏）：整块不显示', () => {
    expect(pageLabelText('chapter', nums({ pagesInChapter: 0, pageInChapter: 0 }))).toBe('');
  });

  it('全书缺页数：整块不显示', () => {
    expect(pageLabelText('book', nums({ bookPages: 0, bookPage: 0 }))).toBe('');
  });

  it('页码越界时夹到总页数，不出现「13 / 12」', () => {
    expect(pageLabelText('chapter', nums({ pageInChapter: 13 }))).toBe('12 / 12');
    expect(pageLabelText('book', nums({ bookPage: 999 }))).toBe('456 / 456');
  });

  it('页码为 0（引擎还没定位）时不当成有效页', () => {
    expect(pageLabelText('chapter', nums({ pageInChapter: 0 }))).toBe('');
  });

  it('总页数为负（引擎脏值）按未知处理', () => {
    expect(pageLabelText('chapter', nums({ pagesInChapter: -3 }))).toBe('');
    expect(pageLabelText('book', nums({ bookPages: -9 }))).toBe('');
  });
});

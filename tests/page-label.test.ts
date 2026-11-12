import { describe, expect, it } from 'vitest';
import { pageLabelText, type PageLabelInput } from '../src/view/page-label';

/* 页码显示的文案规则（2026-11-12 用户拍板）：
   · 三档：关 / 本章 / 全书；
   · 页面上只写数字，不写「本章」「全书」；
   · 两种口径都拿不到有效页数时退回百分比，绝不显示「1 / 0」。 */

function nums(over: Partial<PageLabelInput> = {}): PageLabelInput {
  return {
    pageInChapter: 3,
    pagesInChapter: 12,
    bookPage: 123,
    bookPages: 456,
    percent: 0.42,
    ...over,
  };
}

describe('阅读页页码文案', () => {
  it('关：一律空串，连百分比也不画', () => {
    expect(pageLabelText('off', nums())).toBe('');
  });

  it('本章：本章第几屏 / 本章共几屏 + 全书百分比', () => {
    expect(pageLabelText('chapter', nums())).toBe('3 / 12 · 42%');
  });

  it('全书：按字数估算的全书页码 + 全书百分比', () => {
    expect(pageLabelText('book', nums())).toBe('123 / 456 · 42%');
  });

  it('本章缺页数（滚动模式 / 整章一屏）：只显示百分比', () => {
    expect(pageLabelText('chapter', nums({ pagesInChapter: 0, pageInChapter: 0 }))).toBe('42%');
  });

  it('全书缺页数（老引擎没给 location）：只显示百分比', () => {
    expect(pageLabelText('book', nums({ bookPages: 0, bookPage: 0 }))).toBe('42%');
  });

  it('页码越界时夹到总页数，不出现「13 / 12」', () => {
    expect(pageLabelText('chapter', nums({ pageInChapter: 13 }))).toBe('12 / 12 · 42%');
    expect(pageLabelText('book', nums({ bookPage: 999 }))).toBe('456 / 456 · 42%');
  });

  it('页码为 0（引擎还没定位）时不当成有效页', () => {
    expect(pageLabelText('chapter', nums({ pageInChapter: 0 }))).toBe('42%');
  });

  it('百分比夹在 0..1，四舍五入；脏值按 0', () => {
    expect(pageLabelText('chapter', nums({ percent: 0 }))).toBe('3 / 12 · 0%');
    expect(pageLabelText('chapter', nums({ percent: 0.425 }))).toBe('3 / 12 · 43%');
    expect(pageLabelText('chapter', nums({ percent: 1 }))).toBe('3 / 12 · 100%');
    expect(pageLabelText('chapter', nums({ percent: -1 }))).toBe('3 / 12 · 0%');
    expect(pageLabelText('chapter', nums({ percent: 2 }))).toBe('3 / 12 · 100%');
    expect(pageLabelText('chapter', nums({ percent: Number.NaN }))).toBe('3 / 12 · 0%');
  });

  it('总页数为负（引擎脏值）按未知处理', () => {
    expect(pageLabelText('chapter', nums({ pagesInChapter: -3 }))).toBe('42%');
    expect(pageLabelText('book', nums({ bookPages: -9 }))).toBe('42%');
  });
});

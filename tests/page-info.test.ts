import { describe, expect, it } from 'vitest';
import { bookPageInfo, chapterPageInfo } from '../src/engine/page-info';

/* 引擎把分页器 / 章节大小整理成「1 基页码 + 总页数」。
   本章用分页器的真实屏数；全书按章累加（实测 + 估算），
   保证同一章内翻一页、全书页码就 +1。 */

describe('本章页码', () => {
  it('分页器给的总屏数扣掉前后两页空白', () => {
    expect(chapterPageInfo({ page: 3, pages: 14 }, false)).toEqual({ page: 3, pages: 12 });
  });

  it('只有一屏的章节：正文 1 页，页码 1', () => {
    expect(chapterPageInfo({ page: 1, pages: 3 }, false)).toEqual({ page: 1, pages: 1 });
  });

  it('整章没有可读页（pages <= 2）按未知处理', () => {
    expect(chapterPageInfo({ page: 0, pages: 2 }, false)).toEqual({ page: 0, pages: 0 });
    expect(chapterPageInfo({ page: 0, pages: 0 }, false)).toEqual({ page: 0, pages: 0 });
  });

  it('滚动模式没有「屏」的概念，一律未知', () => {
    expect(chapterPageInfo({ page: 3, pages: 14 }, true)).toEqual({ page: 0, pages: 0 });
  });

  it('页码越界夹在 [1, 正文页数]', () => {
    expect(chapterPageInfo({ page: 0, pages: 14 }, false)).toEqual({ page: 1, pages: 12 });
    expect(chapterPageInfo({ page: 99, pages: 14 }, false)).toEqual({ page: 12, pages: 12 });
    expect(chapterPageInfo({ page: -2, pages: 14 }, false)).toEqual({ page: 1, pages: 12 });
  });

  it('拿不到分页器时未知', () => {
    expect(chapterPageInfo(null, false)).toEqual({ page: 0, pages: 0 });
    expect(chapterPageInfo(undefined, false)).toEqual({ page: 0, pages: 0 });
    expect(chapterPageInfo({}, false)).toEqual({ page: 0, pages: 0 });
  });
});

describe('全书页码（按章累加）', () => {
  /* 4 章、每章 3000 字节：没测过别的章时按 1500 字节/页估，一章 2 页 */
  const sizes = [3000, 3000, 3000, 3000];

  it('第一章第一页：前面没有页，总页数含后面章节的估算', () => {
    const r = bookPageInfo({
      sizes,
      measured: new Map([[0, 2]]),
      index: 0,
      pageInChapter: 1,
      pagesInChapter: 2,
    });
    expect(r).toEqual({ page: 1, pages: 2 + 2 + 2 + 2 });
  });

  it('同一章内翻一页，全书页码一定 +1（不再几页才动一下）', () => {
    const base = { sizes, measured: new Map([[0, 2]]), index: 0, pagesInChapter: 2 };
    expect(bookPageInfo({ ...base, pageInChapter: 1 }).page).toBe(1);
    expect(bookPageInfo({ ...base, pageInChapter: 2 }).page).toBe(2);
  });

  it('换到下一章：接着上一章的实测页数数', () => {
    const r = bookPageInfo({
      sizes,
      measured: new Map([[0, 2]]),
      index: 1,
      pageInChapter: 1,
      pagesInChapter: 3,
    });
    expect(r.page).toBe(3);
  });

  it('读过的章用实测页数，不用估算', () => {
    const r = bookPageInfo({
      sizes: [3000, 3000, 3000],
      measured: new Map([
        [0, 5],
        [1, 7],
      ]),
      index: 2,
      pageInChapter: 1,
      pagesInChapter: 2,
    });
    expect(r.page).toBe(13);
    expect(r.pages).toBe(5 + 7 + 2);
  });

  it('没读过的章按已测章节的加权平均字节数估：字号越小估得越多', () => {
    /* 本章 1000 字节 2 页 → 500 字节/页；后面 2000 字节 → 4 页 */
    const r = bookPageInfo({
      sizes: [1000, 2000],
      measured: new Map([[0, 2]]),
      index: 0,
      pageInChapter: 1,
      pagesInChapter: 2,
    });
    expect(r.pages).toBe(2 + 4);
  });

  it('空章节（封面 / 版权页）算 0 页，不硬凑 1 页', () => {
    const r = bookPageInfo({
      sizes: [0, 3000],
      measured: new Map(),
      index: 1,
      pageInChapter: 1,
      pagesInChapter: 2,
    });
    expect(r).toEqual({ page: 1, pages: 2 });
  });

  it('拿不到章节目录 / 页码时未知，退回百分比', () => {
    expect(
      bookPageInfo({ sizes: [], measured: new Map(), index: 0, pageInChapter: 1, pagesInChapter: 2 }),
    ).toEqual({ page: 0, pages: 0 });
    expect(
      bookPageInfo({ sizes: [3000], measured: new Map(), index: 3, pageInChapter: 1, pagesInChapter: 2 }),
    ).toEqual({ page: 0, pages: 0 });
    expect(
      bookPageInfo({ sizes: [3000], measured: new Map(), index: 0, pageInChapter: 0, pagesInChapter: 2 }),
    ).toEqual({ page: 0, pages: 0 });
    expect(
      bookPageInfo({ sizes: [3000], measured: new Map(), index: 0, pageInChapter: 1, pagesInChapter: 0 }),
    ).toEqual({ page: 0, pages: 0 });
  });
});

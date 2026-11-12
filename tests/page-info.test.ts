import { describe, expect, it } from 'vitest';
import { bookPageInfo, chapterPageInfo } from '../src/engine/page-info';

/* 引擎把分页器 / foliate 的原始数字整理成「1 基页码 + 总页数」。
   这里只认两种来源：
   · 本章：分页器的 page / pages（pages 含前后两页空白，正文 = pages - 2）；
   · 全书：foliate 按 1500 字节估的 location（current 0 基，total 是总数）。 */

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

describe('全书估算页码', () => {
  it('location 的 current 是 0 基，展示要 +1', () => {
    expect(bookPageInfo({ current: 122, total: 456 })).toEqual({ page: 123, pages: 456 });
  });

  it('书首 current 0 → 第 1 页', () => {
    expect(bookPageInfo({ current: 0, total: 10 })).toEqual({ page: 1, pages: 10 });
  });

  it('total 缺失或非正数按未知处理', () => {
    expect(bookPageInfo(null)).toEqual({ page: 0, pages: 0 });
    expect(bookPageInfo({})).toEqual({ page: 0, pages: 0 });
    expect(bookPageInfo({ current: 5, total: 0 })).toEqual({ page: 0, pages: 0 });
    expect(bookPageInfo({ current: 5, total: -1 })).toEqual({ page: 0, pages: 0 });
  });

  it('current 越界夹在 [1, total]', () => {
    expect(bookPageInfo({ current: 999, total: 10 })).toEqual({ page: 10, pages: 10 });
    expect(bookPageInfo({ current: -3, total: 10 })).toEqual({ page: 1, pages: 10 });
  });
});

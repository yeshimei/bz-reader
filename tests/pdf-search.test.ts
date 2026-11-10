import { describe, expect, it } from 'vitest';
import { pdfHitLocator, rangesInText, searchPageTexts } from '../src/engine/pdf/search';

describe('pdf search', () => {
  const pages = [
    { page: 1, text: 'The quick brown fox jumps over the lazy dog' },
    { page: 2, text: '中文阅读器里搜索关键词，关键词出现两次关键词' },
    { page: 3, text: 'nothing here' },
  ];

  it('英文大小写不敏感，返回页码与偏移', () => {
    const { hits } = searchPageTexts(pages, 'QUICK', { limit: 20 });
    expect(hits).toHaveLength(1);
    expect(hits[0].page).toBe(1);
    expect(hits[0].excerpt.match).toBe('quick');
    expect(pages[0].text.slice(hits[0].offset, hits[0].end)).toBe('quick');
  });

  it('中文按原文字面匹配，一页多条', () => {
    const { hits } = searchPageTexts(pages, '关键词', { limit: 20 });
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.page === 2)).toBe(true);
  });

  it('每页命中数有上限，总数也有上限，但 total 记真实条数', () => {
    const dense = [{ page: 1, text: 'x '.repeat(200) }];
    expect(searchPageTexts(dense, 'x', { limit: 3, perPage: 50 }).hits).toHaveLength(3);
    expect(searchPageTexts(dense, 'x', { limit: 3, perPage: 50 }).total).toBe(200);

    const many = Array.from({ length: 10 }, (_, i) => ({ page: i + 1, text: 'y' }));
    const got = searchPageTexts(many, 'y', { limit: 4 });
    expect(got.hits).toHaveLength(4);
    expect(got.total).toBe(10);
  });

  it('每页默认留 50 条：同页密集命中不再被砍到 5 条', () => {
    const dense = [{ page: 1, text: '的'.repeat(60) }];
    const got = searchPageTexts(dense, '的');
    expect(got.hits).toHaveLength(50);
    expect(got.total).toBe(60);
  });

  it('按页序返回，空查询返回空', () => {
    const got = searchPageTexts(pages, 'fox', { limit: 20 });
    expect(got.hits.map((h) => h.page)).toEqual([1]);
    expect(searchPageTexts(pages, '   ', { limit: 20 })).toEqual({ hits: [], total: 0 });
    expect(searchPageTexts([], 'x', { limit: 20 })).toEqual({ hits: [], total: 0 });
  });

  it('摘录带上下文，且不跨页', () => {
    const { hits } = searchPageTexts(pages, 'lazy', { limit: 20 });
    expect(hits[0].excerpt.pre).not.toContain('nothing');
    expect(hits[0].excerpt.match).toBe('lazy');
  });
});

/* ============================================================
 * 命中定位串：PDF 没有 CFI，全仓都塞在 `cfiRange` 里。
 * 只写页码会让「同一页多处命中」在去重时塌成一条；带上文字层区间，
 * 每条各自成行，点哪条标哪处。
 * ============================================================ */
describe('pdf 命中的页内区间', () => {
  it('按文字层映射写 pdf/页/起-止', () => {
    const hit = { page: 9, offset: 0, end: 6, excerpt: { pre: '', match: 'parity', post: '' } };
    const sameText = [0, 1, 2, 3, 4, 5];
    expect(pdfHitLocator(hit, sameText)).toBe('pdf/9/0-6');
  });

  it('搜索文本里补出来的空格不占文字层位置，区间要跟着缩短', () => {
    /* 文本 "a b"，文字层只有 "ab"：映射 [0, 1, 1] */
    const hit = { page: 3, offset: 0, end: 3, excerpt: { pre: '', match: 'a b', post: '' } };
    expect(pdfHitLocator(hit, [0, 1, 1])).toBe('pdf/3/0-2');
  });

  it('映射缺失或越界时退回「整页」，不写坏的区间', () => {
    const hit = { page: 3, offset: 99, end: 105, excerpt: { pre: '', match: 'x', post: '' } };
    expect(pdfHitLocator(hit, [0, 1])).toBe('pdf/3');
  });
});

describe('页内命中区间（画到页面上用）', () => {
  it('英文大小写不敏感，按出现顺序给出区间', () => {
    expect(rangesInText('abcABCabc', 'abc')).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 9 },
    ]);
  });

  it('中文按字面，重叠处不重复计算', () => {
    expect(rangesInText('哈哈哈哈', '哈哈')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('有上限、空查询返回空', () => {
    expect(rangesInText('aaaa', 'a', 2)).toHaveLength(2);
    expect(rangesInText('abc', '')).toEqual([]);
    expect(rangesInText('', 'a')).toEqual([]);
  });
});

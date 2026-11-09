import { describe, expect, it } from 'vitest';
import { searchPageTexts } from '../src/engine/pdf/search';

describe('pdf search', () => {
  const pages = [
    { page: 1, text: 'The quick brown fox jumps over the lazy dog' },
    { page: 2, text: '中文阅读器里搜索关键词，关键词出现两次关键词' },
    { page: 3, text: 'nothing here' },
  ];

  it('英文大小写不敏感，返回页码与偏移', () => {
    const hits = searchPageTexts(pages, 'QUICK', 20);
    expect(hits).toHaveLength(1);
    expect(hits[0].page).toBe(1);
    expect(hits[0].excerpt.match).toBe('quick');
    expect(pages[0].text.slice(hits[0].offset, hits[0].offset + 5)).toBe('quick');
  });

  it('中文按原文字面匹配，一页多条', () => {
    const hits = searchPageTexts(pages, '关键词', 20);
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.page === 2)).toBe(true);
  });

  it('每页命中数有上限，总数也有上限', () => {
    const dense = [{ page: 1, text: 'x '.repeat(200) }];
    expect(searchPageTexts(dense, 'x', 3)).toHaveLength(3);
    const many = Array.from({ length: 10 }, (_, i) => ({ page: i + 1, text: 'y' }));
    expect(searchPageTexts(many, 'y', 4)).toHaveLength(4);
  });

  it('按页序返回，空查询返回空', () => {
    const hits = searchPageTexts(pages, 'fox', 20);
    expect(hits.map((h) => h.page)).toEqual([1]);
    expect(searchPageTexts(pages, '   ', 20)).toEqual([]);
    expect(searchPageTexts([], 'x', 20)).toEqual([]);
  });

  it('摘录带上下文，且不跨页', () => {
    const hits = searchPageTexts(pages, 'lazy', 20);
    expect(hits[0].excerpt.pre).not.toContain('nothing');
    expect(hits[0].excerpt.match).toBe('lazy');
  });
});

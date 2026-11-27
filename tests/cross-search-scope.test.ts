import { describe, expect, it } from 'vitest';
import { ALL_BOOKS_SCOPE, filterBooksByScope, shelvesInBooks } from '../src/ui/cross-search-scope';
import { NO_SHELF } from '../src/data/shelves';
import type { ReaderBook } from '../src/data/schema';

function book(id: string, title: string): ReaderBook {
  return {
    id,
    meta: { title },
    fileRef: { vaultPath: `${title}.epub`, format: 'epub', size: 0 },
    reading: { position: { percent: 0 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
    notes: { highlights: [], excerpts: [], bookmarks: [] },
    addedAt: 0,
    updatedAt: 0,
  };
}

const books = [book('a', '甲'), book('b', '乙'), book('c', '丙')];
const shelves: Record<string, string[]> = {
  a: ['技术'],
  b: ['技术', '小说'],
  c: [],
};
const shelvesOf = (b: ReaderBook): string[] => shelves[b.id] ?? [];

describe('filterBooksByScope · 搜索范围', () => {
  it('全部：原样返回一份新的数组', () => {
    const out = filterBooksByScope(books, ALL_BOOKS_SCOPE, shelvesOf);
    expect(out.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(out).not.toBe(books);
  });

  it('分类：只留挂在这个分类下的书（多分类也算）', () => {
    const out = filterBooksByScope(books, { kind: 'shelf', shelf: '技术' }, shelvesOf);
    expect(out.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('未分类：只留没有任何分类的书', () => {
    const out = filterBooksByScope(books, { kind: 'shelf', shelf: NO_SHELF }, shelvesOf);
    expect(out.map((b) => b.id)).toEqual(['c']);
  });

  it('指定几本：只留列出的 id，顺序按书架', () => {
    const out = filterBooksByScope(books, { kind: 'books', ids: ['c', 'a'] }, shelvesOf);
    expect(out.map((b) => b.id)).toEqual(['a', 'c']);
  });

  it('指定空列表：一本都不搜', () => {
    expect(filterBooksByScope(books, { kind: 'books', ids: [] }, shelvesOf)).toEqual([]);
  });
});

describe('shelvesInBooks · 分类清单', () => {
  it('去重、按出现顺序，未归类收成「未分类」', () => {
    expect(shelvesInBooks(books, shelvesOf)).toEqual(['技术', '小说', NO_SHELF]);
  });

  it('空书架返回空清单', () => {
    expect(shelvesInBooks([], shelvesOf)).toEqual([]);
  });
});

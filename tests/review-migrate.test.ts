/**
 * 复习卡搬家的规划（data/review-migrate.ts）。
 *
 * 规划是纯的，真正的移动在动作层。这里钉住三条边界：只搬划线上记着路径的、
 * 已经在新目录下的不再搬、目录没变就什么都不做——搬错一张就是一篇笔记挪到
 * 了别处，用户的链接全断。
 */
import { describe, expect, it } from 'vitest';
import { normalizeMoveDir, pathUnder, planCardMoves } from '../src/data/review-migrate';
import type { ReaderBook } from '../src/data/schema';

function book(id: string, marks: Array<{ id: string; path?: string }>): ReaderBook {
  return {
    id,
    meta: { title: '书' },
    notes: {
      highlights: marks.map((m) => ({
        id: m.id,
        text: '原文',
        createdAt: 1,
        ...(m.path ? { review: { path: m.path, at: 1, scheduled: true } } : {}),
      })),
      bookmarks: [],
    },
  } as unknown as ReaderBook;
}

describe('复习卡搬家规划', () => {
  it('目录归一：斜杠与空串都是库根', () => {
    expect(normalizeMoveDir('/')).toBe('');
    expect(normalizeMoveDir('')).toBe('');
    expect(normalizeMoveDir('/a/b/')).toBe('a/b');
    expect(normalizeMoveDir('  a/b  ')).toBe('a/b');
  });

  it('pathUnder：子目录算在，库根只认不带目录的', () => {
    expect(pathUnder('old/a.md', 'old')).toBe(true);
    expect(pathUnder('old/sub/a.md', 'old')).toBe(true);
    expect(pathUnder('older/a.md', 'old')).toBe(false);
    expect(pathUnder('a.md', '')).toBe(true);
    expect(pathUnder('old/a.md', '')).toBe(false);
  });

  it('只搬旧目录下、划线上记着路径的卡片', () => {
    const books = [
      book('b1', [
        { id: 'h1', path: 'old/卡片一.md' },
        { id: 'h2', path: 'other/卡片二.md' },
        { id: 'h3' },
      ]),
    ];
    const moves = planCardMoves(books, 'old', 'new');
    expect(moves).toEqual([{ bookId: 'b1', highlightId: 'h1', from: 'old/卡片一.md', to: 'new/卡片一.md' }]);
  });

  it('目录没变 / 已经在新目录：都不搬', () => {
    const books = [book('b1', [{ id: 'h1', path: 'new/卡片一.md' }])];
    expect(planCardMoves(books, 'new', 'new')).toEqual([]);
    expect(planCardMoves(books, 'old', 'new')).toEqual([]);
  });

  it('搬到库根：路径不带目录前缀', () => {
    const books = [book('b1', [{ id: 'h1', path: 'old/卡片一.md' }])];
    expect(planCardMoves(books, 'old', '')).toEqual([
      { bookId: 'b1', highlightId: 'h1', from: 'old/卡片一.md', to: '卡片一.md' },
    ]);
  });

  it('多本书一起规划', () => {
    const books = [
      book('b1', [{ id: 'h1', path: 'old/a.md' }]),
      book('b2', [{ id: 'h2', path: 'old/b.md' }]),
    ];
    expect(planCardMoves(books, 'old', 'new').map((m) => m.bookId)).toEqual(['b1', 'b2']);
  });
});

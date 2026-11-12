// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  CLIP_BOOK_ID,
  isClipBookRecord,
  makeClipBookRecord,
  syncClipBookEntry,
} from '../src/data/clip-book-entry';
import type { ReaderBook } from '../src/data/schema';

describe('clip-book-entry', () => {
  it('造出的记录是固定 id 的虚拟书（无文件路径）', () => {
    const book = makeClipBookRecord('剪藏本');
    expect(book.id).toBe(CLIP_BOOK_ID);
    expect(book.meta.clipBook).toBe(true);
    expect(book.fileRef.vaultPath).toBe('');
    expect(isClipBookRecord(book)).toBe(true);
  });

  it('开关打开：第一次创建，之后 kept 不重复加', () => {
    const books: ReaderBook[] = [];
    const a = syncClipBookEntry(books, true, '剪藏本', 100);
    expect(a.action).toBe('created');
    expect(books).toHaveLength(1);
    const b = syncClipBookEntry(books, true, '剪藏本', 200);
    expect(b.action).toBe('kept');
    expect(books).toHaveLength(1);
    expect(books[0].updatedAt).toBe(100);
  });

  it('关掉是归档，不是删除；再打开原样复活且进度保留', () => {
    const books: ReaderBook[] = [makeClipBookRecord('剪藏本', 'bz 剪藏本', 1)];
    books[0].reading.position.percent = 0.42;
    const off = syncClipBookEntry(books, false, '剪藏本', 300);
    expect(off.action).toBe('archived');
    expect(books[0].archivedAt).toBe(300);
    expect(books[0].reading.position.percent).toBe(0.42);

    const on = syncClipBookEntry(books, true, '剪藏本', 400);
    expect(on.action).toBe('revived');
    expect(books[0].archivedAt).toBeUndefined();
    expect(books[0].reading.position.percent).toBe(0.42);
  });

  it('关着且本来就没有：不动任何书', () => {
    const books: ReaderBook[] = [];
    const r = syncClipBookEntry(books, false, '剪藏本', 500);
    expect(r.changed).toBe(false);
    expect(books).toHaveLength(0);
  });
});

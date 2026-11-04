import { describe, expect, it } from 'vitest';
import { mergeData, sanitizeData } from '../src/data/store';

interface RawBook {
  id: string;
  meta: { title: string };
  fileRef: { vaultPath: string; format: string; size: number };
  reading: { position: { percent: number }; stats: { totalReadTime: number; lastReadTime: number }; sessions: unknown[] };
  notes: { highlights: Array<{ id: string; text: string; createdAt: number }>; excerpts: unknown[]; bookmarks: unknown[] };
  addedAt: number;
  updatedAt: number;
  notesUpdatedAt?: number;
}

function book(over: Partial<RawBook> = {}): RawBook {
  return {
    id: 'b1',
    meta: { title: '本地书名' },
    fileRef: { vaultPath: '书/a.epub', format: 'epub', size: 1 },
    reading: { position: { percent: 0.1 }, stats: { totalReadTime: 1, lastReadTime: 1 }, sessions: [] },
    notes: { highlights: [{ id: 'h-local', text: '本地划线', createdAt: 50 }], excerpts: [], bookmarks: [] },
    addedAt: 1,
    updatedAt: 300,
    notesUpdatedAt: 100,
    ...over,
  };
}

function data(b: RawBook): { version: 1; books: RawBook[] } {
  return { version: 1, books: [b] };
}

describe('mergeData · notes 与其余字段分开取（A-15）', () => {
  it('阅读进度取 updatedAt 新的，标注取 notesUpdatedAt 新的', () => {
    /* 本机一直在翻页（updatedAt 新），另一台设备刚补了想法（notesUpdatedAt 新）。
       整本二选一会丢掉其中一边：本机那次翻页会盖掉同步来的标注。 */
    const local = data(book({ updatedAt: 300, notesUpdatedAt: 100 }) as never);
    const diskBook = book({
      meta: { title: '磁盘书名' },
      reading: { position: { percent: 0.8 }, stats: { totalReadTime: 9, lastReadTime: 9 }, sessions: [] },
      notes: { highlights: [{ id: 'h-disk', text: '同步来的划线', createdAt: 400 }], excerpts: [], bookmarks: [] },
      updatedAt: 200,
      notesUpdatedAt: 400,
    });
    const disk = data(diskBook as never);

    const out = mergeData(local as never, disk as never);
    const merged = out.books[0] as unknown as RawBook;

    expect(merged.meta.title).toBe('本地书名');
    expect(merged.reading.position.percent).toBe(0.1);
    expect(merged.notes.highlights[0]!.text).toBe('同步来的划线');
    expect(merged.notesUpdatedAt).toBe(400);
  });

  it('磁盘进度更新但本机标注更新：进度取磁盘、标注取本机', () => {
    /* 反方向也要成立：本机刚写了想法（notes 新），另一台设备读到更后面
       （updatedAt 新）。整本二选一会把本机刚写的想法丢掉。 */
    const local = data(
      book({
        updatedAt: 100,
        notesUpdatedAt: 400,
        notes: { highlights: [{ id: 'h-local', text: '本机新想法', createdAt: 1 }], excerpts: [], bookmarks: [] },
      }) as never,
    );
    const disk = data(
      book({
        meta: { title: '磁盘书名' },
        reading: { position: { percent: 0.8 }, stats: { totalReadTime: 9, lastReadTime: 9 }, sessions: [] },
        updatedAt: 300,
        notesUpdatedAt: 50,
        notes: { highlights: [{ id: 'h-disk', text: '磁盘旧标注', createdAt: 1 }], excerpts: [], bookmarks: [] },
      }) as never,
    );

    const merged = mergeData(local as never, disk as never).books[0] as unknown as RawBook;

    expect(merged.meta.title).toBe('磁盘书名');
    expect(merged.reading.position.percent).toBe(0.8);
    expect(merged.notes.highlights[0]!.text).toBe('本机新想法');
    expect(merged.notesUpdatedAt).toBe(400);
  });

  it('notesUpdatedAt 相同则保持 updatedAt 大的整本（不拆字段）', () => {
    const local = data(book({ updatedAt: 100, notesUpdatedAt: 50 }) as never);
    const disk = data(
      book({
        meta: { title: '磁盘书名' },
        updatedAt: 200,
        notesUpdatedAt: 50,
        notes: { highlights: [{ id: 'h-disk', text: '磁盘划线', createdAt: 5 }], excerpts: [], bookmarks: [] },
      }) as never,
    );

    const out = mergeData(local as never, disk as never);
    const merged = out.books[0] as unknown as RawBook;
    expect(merged.meta.title).toBe('磁盘书名');
    expect(merged.notes.highlights[0]!.text).toBe('磁盘划线');
  });

  it('本机没有 notesUpdatedAt（旧数据）时，磁盘有就用磁盘的标注', () => {
    const localBook = book({ updatedAt: 300 });
    delete localBook.notesUpdatedAt;
    const disk = data(
      book({
        updatedAt: 200,
        notesUpdatedAt: 400,
        notes: { highlights: [{ id: 'h-disk', text: '新标注', createdAt: 1 }], excerpts: [], bookmarks: [] },
      }) as never,
    );

    const out = mergeData(data(localBook as never) as never, disk as never);
    const merged = out.books[0] as unknown as RawBook;
    expect(merged.notes.highlights[0]!.text).toBe('新标注');
  });
});

describe('sanitize 保留 notesUpdatedAt（A-15）', () => {
  it('读盘一次不会把标注时间戳洗掉', () => {
    const clean = sanitizeData({
      version: 1,
      books: [book({ notesUpdatedAt: 1234 })],
    });
    expect((clean!.books[0] as unknown as RawBook).notesUpdatedAt).toBe(1234);
  });
});

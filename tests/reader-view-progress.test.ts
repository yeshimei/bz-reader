import { describe, expect, it, vi } from 'vitest';
import { makeApp, makeReaderView, testBook } from './helpers/plugin-harness';

describe('进度与标注分时间戳（A-15）', () => {
  it('saveRelocate 只写进度与阅读时间，不再无条件改 book.updatedAt', () => {
    const app = makeApp();
    const { view } = makeReaderView(app);
    const book = testBook('b1');
    book.updatedAt = 111;
    (view as unknown as { book: unknown }).book = book;
    const tracker = { touch: vi.fn() };
    (view as unknown as { tracker: unknown }).tracker = tracker;

    (
      view as unknown as {
        saveRelocate(info: { percent: number; cfi: string; chapterTitle: string; chapterIndex: number }): void;
      }
    ).saveRelocate({ percent: 0.42, cfi: 'cfi-1', chapterTitle: '第二章', chapterIndex: 1 });

    expect(book.updatedAt).toBe(111);
    expect(book.notesUpdatedAt).toBeUndefined();
    const reading = book.reading as { position: { percent: number; cfi?: string }; stats: { lastReadTime: number } };
    expect(reading.position.percent).toBe(0.42);
    expect(reading.position.cfi).toBe('cfi-1');
    expect(reading.stats.lastReadTime).toBeGreaterThan(0);
    expect(view.api.store.touch).toHaveBeenCalled();
    expect(tracker.touch).toHaveBeenCalled();
  });
});

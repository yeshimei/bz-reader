import { describe, expect, it, vi } from 'vitest';
import { makeApp, makeReaderView, testBook } from './helpers/plugin-harness';

interface RelocateInfo {
  percent: number;
  cfi: string;
  chapterTitle: string;
  chapterIndex: number;
}

interface Reading {
  position: { percent: number; cfi?: string };
  stats: { lastReadTime: number; totalReadTime: number };
}

function wire(): {
  view: ReturnType<typeof makeReaderView>['view'];
  book: Record<string, unknown>;
  tracker: { touch: ReturnType<typeof vi.fn> };
  relocate: (info: RelocateInfo) => void;
} {
  const app = makeApp();
  const { view } = makeReaderView(app);
  const book = testBook('b1');
  book.updatedAt = 111;
  (view as unknown as { book: unknown }).book = book;
  const tracker = { touch: vi.fn() };
  (view as unknown as { tracker: unknown }).tracker = tracker;
  const relocate = (info: RelocateInfo): void => {
    (view as unknown as { saveRelocate(i: RelocateInfo): void }).saveRelocate(info);
  };
  return { view, book, tracker, relocate };
}

describe('进度与标注分时间戳（A-15）', () => {
  it('saveRelocate 只写进度与阅读时间，不再无条件改 book.updatedAt', () => {
    const { view, book, tracker, relocate } = wire();
    /* 用户已经翻过页（B14 的落盘闸门），这里只关心写什么，不关心什么时候写 */
    (view as unknown as { userTurned: boolean }).userTurned = true;

    relocate({ percent: 0.42, cfi: 'cfi-1', chapterTitle: '第二章', chapterIndex: 1 });

    expect(book.updatedAt).toBe(111);
    expect(book.notesUpdatedAt).toBeUndefined();
    const reading = book.reading as unknown as Reading;
    expect(reading.position.percent).toBe(0.42);
    expect(reading.position.cfi).toBe('cfi-1');
    expect(reading.stats.lastReadTime).toBeGreaterThan(0);
    expect(view.api.store.touch).toHaveBeenCalled();
    expect(tracker.touch).toHaveBeenCalled();
  });
});

/**
 * B14：打开书不再立即写进度。
 *
 * 打开一本书会先来一次「定位到上次读到的地方」的 relocate。以前那次也走
 * `store.touch()`，于是「在电脑上点开一本没读完的书、什么也没翻就关掉」
 * 也会把进度写下去——手机上读到的新位置就被这份旧位置盖回去了。
 */
describe('翻页才写进度（B14）', () => {
  it('初次定位：只更新内存，不把数据标脏', () => {
    const { view, book, relocate } = wire();

    relocate({ percent: 0.42, cfi: 'cfi-1', chapterTitle: '第二章', chapterIndex: 1 });

    /* 内存里要更新：界面上的百分比、目录高亮都读这一份 */
    expect((book.reading as unknown as Reading).position.percent).toBe(0.42);
    /* 但不落盘：这一份是「上次读到哪」，不是这次读了多少 */
    expect(view.api.store.touch).not.toHaveBeenCalled();
  });

  it('用户翻过页之后，relocate 才落盘', () => {
    const { view, book, relocate } = wire();
    (view as unknown as { userTurned: boolean }).userTurned = true;

    relocate({ percent: 0.5, cfi: 'cfi-2', chapterTitle: '第三章', chapterIndex: 2 });

    expect(view.api.store.touch).toHaveBeenCalledTimes(1);
    expect((book.reading as unknown as Reading).position.percent).toBe(0.5);
  });
});

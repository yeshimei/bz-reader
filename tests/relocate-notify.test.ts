import { describe, expect, it } from 'vitest';
import { RELOCATE_NOTIFY_MS, shouldNotifyRelocate } from '../src/view/relocate-notify';

describe('shouldNotifyRelocate', () => {
  it('换章立刻广播', () => {
    expect(shouldNotifyRelocate({ now: 10, lastAt: 9, lastPct: 0.1, pct: 0.1, chapterChanged: true })).toBe(true);
  });

  it('同一页内的连续 relocate 不广播（翻一页时会有好几次）', () => {
    expect(shouldNotifyRelocate({ now: 1000, lastAt: 900, lastPct: 0.2, pct: 0.2, chapterChanged: false })).toBe(
      false,
    );
  });

  it('过了节流窗口且百分比变了才广播', () => {
    expect(
      shouldNotifyRelocate({
        now: 9000,
        lastAt: 9000 - RELOCATE_NOTIFY_MS,
        lastPct: 0.2,
        pct: 0.21,
        chapterChanged: false,
      }),
    ).toBe(true);
    expect(
      shouldNotifyRelocate({
        now: 9000,
        lastAt: 9000 - RELOCATE_NOTIFY_MS,
        lastPct: 0.2,
        pct: 0.2,
        chapterChanged: false,
      }),
    ).toBe(false);
  });

  it('长时间没变化也给一次心跳（统计不停住）', () => {
    expect(shouldNotifyRelocate({ now: 6000, lastAt: 0, lastPct: 0.2, pct: 0.2, chapterChanged: false })).toBe(true);
  });

  it('时间倒流时宁可广播，不要静默', () => {
    expect(shouldNotifyRelocate({ now: 5, lastAt: 900, lastPct: 0.2, pct: 0.2, chapterChanged: false })).toBe(true);
  });
});

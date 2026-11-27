import { describe, expect, it } from 'vitest';
import {
  beginReadthrough,
  cancelFinishReadthrough,
  finishReadthrough,
  readthroughRows,
  type Readthrough,
} from '../src/data/reading-log';
import type { ReadingBlock, ReadingSession } from '../src/data/schema';

function reading(over: Partial<ReadingBlock> = {}): ReadingBlock {
  return {
    position: { percent: 0 },
    stats: { totalReadTime: 0, lastReadTime: 0 },
    sessions: [],
    ...over,
  };
}

function session(start: number, seconds: number): ReadingSession {
  return { start, end: start + seconds * 1000, durationSeconds: seconds };
}

const T = (iso: string): number => Date.parse(iso);

describe('beginReadthrough · 打开书时开一轮', () => {
  it('全新书：以现在为起点开第一条', () => {
    const r = reading();
    const list = beginReadthrough(r, T('2026-11-27T10:00:00+08:00'));
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ start: T('2026-11-27T10:00:00+08:00') });
  });

  it('老书没读完：按第一次打开时间补一条，不新开', () => {
    const r = reading({
      stats: {
        totalReadTime: 0,
        lastReadTime: 0,
        startReadTime: T('2026-11-01T09:00:00+08:00'),
      },
    });
    const list = beginReadthrough(r, T('2026-11-27T10:00:00+08:00'));
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ start: T('2026-11-01T09:00:00+08:00') });
    /* 再打开一次不新增 */
    beginReadthrough(r, T('2026-11-27T11:00:00+08:00'));
    expect(r.readthroughs).toHaveLength(1);
  });

  it('老书已读完：补完历史那一轮，再开一条新的（重读）', () => {
    const r = reading({
      stats: {
        totalReadTime: 0,
        lastReadTime: 0,
        startReadTime: T('2026-11-01T09:00:00+08:00'),
        completedTime: T('2026-11-05T22:00:00+08:00'),
      },
    });
    const list = beginReadthrough(r, T('2026-11-27T10:00:00+08:00'));
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      start: T('2026-11-01T09:00:00+08:00'),
      end: T('2026-11-05T22:00:00+08:00'),
    });
    expect(list[1]).toEqual({ start: T('2026-11-27T10:00:00+08:00') });
  });

  it('读完立刻又打开：开新一轮，不重复开', () => {
    const r = reading({
      readthroughs: [{ start: 100, end: 200 }],
    });
    beginReadthrough(r, 300);
    expect(r.readthroughs).toEqual([{ start: 100, end: 200 }, { start: 300 }]);
    beginReadthrough(r, 400);
    expect(r.readthroughs).toHaveLength(2);
  });
});

describe('finishReadthrough · 确认读完', () => {
  it('给最后一条盖结束时间', () => {
    const r = reading({ readthroughs: [{ start: 100 }] });
    finishReadthrough(r, 500);
    expect(r.readthroughs).toEqual([{ start: 100, end: 500 }]);
  });

  it('幂等：重复确认不改已写下的时间', () => {
    const r = reading({ readthroughs: [{ start: 100 }] });
    finishReadthrough(r, 500);
    finishReadthrough(r, 900);
    expect(r.readthroughs).toEqual([{ start: 100, end: 500 }]);
  });

  it('没有轮次表（没打开过就确认）：按第一次打开时间补一条', () => {
    const r = reading({
      stats: { totalReadTime: 0, lastReadTime: 0, startReadTime: 100 },
    });
    finishReadthrough(r, 500);
    expect(r.readthroughs).toEqual([{ start: 100, end: 500 }]);
  });
});

describe('cancelFinishReadthrough · 取消读完', () => {
  it('撤掉最后一轮的结束时间，退回在读', () => {
    const r = reading({ readthroughs: [{ start: 100, end: 500 }] });
    cancelFinishReadthrough(r);
    expect(r.readthroughs).toEqual([{ start: 100 }]);
  });

  it('只撤最后一轮，历史轮次不动', () => {
    const r = reading({
      readthroughs: [
        { start: 100, end: 200 },
        { start: 300, end: 400 },
      ],
    });
    cancelFinishReadthrough(r);
    expect(r.readthroughs).toEqual([
      { start: 100, end: 200 },
      { start: 300 },
    ]);
  });

  it('最后一轮本来就在读：什么都不变', () => {
    const r = reading({ readthroughs: [{ start: 100 }] });
    cancelFinishReadthrough(r);
    expect(r.readthroughs).toEqual([{ start: 100 }]);
  });
});

describe('readthroughRows · 展示用的轮次', () => {
  it('最新的在前，秒数按会话起点求和', () => {
    const r = reading({
      readthroughs: [
        { start: 1000, end: 2000 },
        { start: 5000 },
      ] as Readthrough[],
      sessions: [session(1200, 60), session(1500, 30), session(3000, 999), session(5100, 45)],
    });
    const rows = readthroughRows(r);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ start: 5000, seconds: 45 });
    expect(rows[1]).toEqual({ start: 1000, end: 2000, seconds: 90 });
  });

  it('老数据没有轮次表：按第一次打开 / 读完时间推一条', () => {
    const r = reading({
      stats: {
        totalReadTime: 0,
        lastReadTime: 0,
        startReadTime: 1000,
        completedTime: 5000,
      },
    });
    expect(readthroughRows(r)).toEqual([{ start: 1000, end: 5000, seconds: 0 }]);
  });

  it('连第一次打开时间都没有：返回空数组', () => {
    expect(readthroughRows(reading())).toEqual([]);
  });

  it('区间外的会话不算进来，跨边界只按起点归属', () => {
    const r = reading({
      readthroughs: [{ start: 1000, end: 2000 }],
      sessions: [session(900, 10), session(1000, 20), session(1999, 5), session(2001, 7)],
    });
    expect(readthroughRows(r)[0].seconds).toBe(25);
  });
});

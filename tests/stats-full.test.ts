/**
 * 统计页强化版的计算层（tests/stats-full.test.ts）
 *
 * 造一组形状固定的会话，把「有效时长 / 挂钟 / 打卡」三套口径、
 * 范围切换、周月对比、质量体检、重算清单全部锁死。
 * 数字都是从会话现场算出来的，测试里不写死任何展示值以外的常量。
 */
import { describe, expect, it } from 'vitest';
import type { ReaderBook } from '../src/data/schema';
import {
  analyzeFull,
  statsQuality,
  statsRecalcRows,
  statsReportText,
  statsSeries,
  type FullStatsInput,
} from '../src/data/stats-full';

const D = (day: number, hour = 9, min = 0): number => new Date(2026, 10, day, hour, min).getTime();
const NOW = D(8, 19, 5);
const DAY = 86_400_000;

/** 计算层不加载 i18n，体检单位由调用方给；这里模拟中文包 */
const zhTr = (k: string): string => ({
  'stats.f.unit.day': '天',
  'stats.f.unit.pair': '对',
  'stats.f.unit.book': '本',
}[k] ?? k);

interface SessionSeed {
  start: number;
  end: number;
  durationSeconds: number;
  percent: number;
}

function book(
  id: string,
  sessions: SessionSeed[],
  opts: { percent?: number; total?: number; last?: number; completed?: number } = {},
): ReaderBook {
  return {
    id,
    meta: { title: id, author: '作者', chapterCount: 10, wordCount: 1000 },
    reading: {
      sessions,
      position: { percent: opts.percent ?? 0 },
      stats: {
        totalReadTime: opts.total ?? sessions.reduce((n, s) => n + s.durationSeconds, 0),
        lastReadTime: opts.last ?? (sessions.length ? sessions[sessions.length - 1].end : 0),
        completedTime: opts.completed,
      },
    },
  } as unknown as ReaderBook;
}

function fixture(range: 'all' | 'today' = 'all'): FullStatsInput {
  return {
    range,
    now: NOW,
    goal: 18,
    dailyGoalMinutes: 20,
    checkins: { '2026-11-05': 2658, '2026-11-07': 18 },
    books: [
      book('甲', [
        { start: D(5, 9), end: D(5, 9) + 129_000, durationSeconds: 129, percent: 0.01 },
        { start: D(8, 19), end: D(8, 19) + 600_000, durationSeconds: 60, percent: 0.02 },
      ], { percent: 0.02 }),
      book('乙', [
        { start: D(6, 14), end: D(6, 14) + 395_000, durationSeconds: 395, percent: 0.04 },
        { start: D(8, 18), end: D(8, 18) + 150_000, durationSeconds: 150, percent: 0.03 },
      ], { percent: 0.03 }),
      book('丙', [], { percent: 0.0085, total: 0, last: 0 }),
    ],
  };
}

describe('统计 · 三套口径', () => {
  it('有效 / 挂钟 / 打卡各自汇总，互不串账', () => {
    const a = analyzeFull(fixture());
    expect(a.fullEffTotal).toBe(734);
    expect(a.fullWallTotal).toBe(1274);
    expect(a.ckTotal).toBe(2676);
    expect(a.fullEff).toEqual({ '2026-11-05': 129, '2026-11-06': 395, '2026-11-08': 210 });
    expect(a.total).toBe(734);
    expect(a.today).toBe(210);
  });

  it('挂钟长于有效、进度回退、累计对不上都数得出来', () => {
    const a = analyzeFull(fixture());
    expect(a.wallGreater).toBe(1);
    expect(a.regress).toBe(1);
    expect(a.clockDrift).toBe(0);
    expect(a.allCount).toBe(4);
  });

  it('有打卡没会话的日子、只有进度没会话的书都单独列出来', () => {
    const a = analyzeFull(fixture());
    expect(a.orphanDays).toEqual(['2026-11-07']);
    expect(a.posOnly).toEqual(['丙']);
    expect(a.done).toBe(0);
  });
});

describe('统计 · 范围切换', () => {
  it('切到今天只重算时长类指标，连续 / 读完 / 峰值仍看全量', () => {
    const all = analyzeFull(fixture('all'));
    const today = analyzeFull(fixture('today'));
    expect(today.total).toBe(210);
    expect(today.activeDays).toBe(1);
    expect(today.sessionCount).toBe(2);
    expect(today.streak).toBe(all.streak);
    expect(today.done).toBe(all.done);
    expect(today.peakKey).toBe(all.peakKey);
    expect(today.fullEffTotal).toBe(all.fullEffTotal);
  });

  it('今天口径下时段分布只算今天的会话', () => {
    const a = analyzeFull(fixture('today'));
    expect(a.hour).toEqual([0, 0, 0, 210]);
    expect(a.bestHour).toBe(3);
    expect(a.bestHourSec).toBe(210);
  });
});

describe('统计 · 对比与洞察', () => {
  it('本周 / 上月同期按会话起始时间归集', () => {
    const a = analyzeFull(fixture());
    expect(a.weekCur).toBe(734);
    expect(a.weekPrev).toBe(0);
    expect(a.monthCur).toBe(734);
    expect(a.monthPrev).toBe(0);
  });

  it('峰值日、最久时段、搁置数都来自数据', () => {
    const a = analyzeFull(fixture());
    expect(a.peakKey).toBe('2026-11-06');
    expect(a.peakSec).toBe(395);
    expect(a.bestHour).toBe(2);
    expect(a.bestHourSec).toBe(395);
    expect(a.idleCount).toBe(0);
  });

  it('时间序列短则按天、长则合并成不超过 14 根', () => {
    expect(statsSeries(analyzeFull(fixture('today'))).unit).toBe('day');
    const long = fixture();
    long.books = [
      book('长', Array.from({ length: 60 }, (_, i) => ({
        start: NOW - (59 - i) * DAY,
        end: NOW - (59 - i) * DAY + 60_000,
        durationSeconds: 60,
        percent: (i + 1) / 60,
      }))),
    ];
    const ser = statsSeries(analyzeFull(long));
    expect(ser.unit).toBe('week');
    expect(ser.items.length).toBeLessThanOrEqual(14);
  });
});

describe('统计 · 书籍维度', () => {
  it('状态按完成 / 沉寂 / 会话 / 仅位置分档', () => {
    const a = analyzeFull(fixture());
    expect(a.books.map((b) => b.status)).toEqual(['reading', 'reading', 'posOnly']);
    expect(a.books[0].perPct).toBeCloseTo(94.5, 5);
    expect(a.books[2].perPct).toBeNull();
    expect(a.books.every((b) => b.finishDays === null)).toBe(true);
  });

  it('超过 3 天没读标搁置，读完的书给读完耗时', () => {
    const input = fixture();
    input.books = [
      book('搁置', [{ start: NOW - 4 * DAY, end: NOW - 4 * DAY + 60_000, durationSeconds: 60, percent: 0.1 }], {
        percent: 0.1,
        last: NOW - 4 * DAY,
      }),
      book('读完', [{ start: NOW - 10 * DAY, end: NOW - 10 * DAY + 60_000, durationSeconds: 60, percent: 1 }], {
        percent: 1,
        completed: NOW - 5 * DAY,
      }),
    ];
    const a = analyzeFull(input);
    expect(a.books[0].status).toBe('idle');
    expect(a.books[1].status).toBe('done');
    expect(a.books[1].finishDays).toBeCloseTo(5, 5);
    expect(a.done).toBe(1);
    expect(a.idleCount).toBe(1);
  });
});

describe('统计 · 体检、重算、报告', () => {
  it('六格体检跟着口径差走', () => {
    const q = statsQuality(analyzeFull(fixture()), zhTr);
    expect(q).toHaveLength(6);
    expect(q[0].v).toBe('1/4');
    expect(q[1].v).toBe('32:22');
    expect(q[2].v).toBe('1 天');
    expect(q[3].v).toBe('1 对');
    expect(q[4].v).toBe('3/3');
    expect(q[5].v).toBe('0 本');
    expect(q[1].ok).toBe(false);
  });

  it('重算清单逐日给原值 / 重算后 / 差额，不写回数据源', () => {
    const input = fixture();
    const rows = statsRecalcRows(analyzeFull(input));
    expect(rows.map((r) => r.day)).toEqual([
      '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
    ]);
    expect(rows.map((r) => r.old)).toEqual([2658, 0, 18, 0]);
    expect(rows.map((r) => r.next)).toEqual([129, 395, 0, 210]);
    expect(input.checkins['2026-11-05']).toBe(2658);
  });

  it('文字报告带全部关键数字，不出现 NaN / undefined', () => {
    const a = analyzeFull(fixture());
    const text = statsReportText(a, (k, p) => k + (p ? JSON.stringify(p) : ''));
    expect(text).toContain('12:14');
    expect(text).toContain('03:30');
    expect(text).toContain('11-06');
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('空库不产生 NaN，所有数值指标都是有限数', () => {
    const a = analyzeFull({ ...fixture(), books: [], checkins: {} });
    for (const x of [a.total, a.today, a.streak, a.activeDays, a.weekCur, a.ckTotal, a.peakSec]) {
      expect(Number.isFinite(x)).toBe(true);
    }
    expect(statsSeries(a).items.length).toBeGreaterThan(0);
    expect(statsReportText(a, (k) => k)).not.toMatch(/NaN|undefined/);
  });

  /* 2026-11-09 发版复核：「每 1% 投入」是「累计花了多少秒 / 已读百分比」，
     分子必须取全量有效时长。以前分子跟着范围一起收窄，切到「今天」后
     这一列整体塌到接近零——用户看到的是「数据坏了」。 */
  it('切到「今天」后每 1% 投入不缩水：分子分母都取全量', () => {
    const all = analyzeFull(fixture('all'));
    const today = analyzeFull(fixture('today'));
    expect(today.books.length).toBe(all.books.length);
    for (const b of all.books) {
      const t = today.books.find((x) => x.id === b.id);
      expect(t?.perPct, b.id).toBe(b.perPct);
    }
    /* 范围口径本身照旧收窄：今天的有效时长只算今天的会话 */
    expect(today.total).toBeLessThan(all.total);
  });
});

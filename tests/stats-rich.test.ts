/**
 * 统计页强化版 · 新增聚合（tests/stats-rich.test.ts）
 *
 * 这份测试锁三件事：
 *  1. 字数是**估算**，口径 = 会话百分比增量 × 全书字数（重读不计）；
 *  2. 分类 / 格式 / 进度分档 / 预计读完 / 搁置 / 笔记 / 评分都按书上现成字段算；
 *  3. 新范围（近 7 天 / 近 30 天 / 近一年）只收窄时长类指标，全量指标不动。
 */
import { describe, expect, it } from 'vitest';
import { analyzeRich, type RichInput } from '../src/data/stats-rich';

const NOW = new Date(2026, 10, 15, 21, 0).getTime();
/** 从 NOW 往前退 n 天的某个整点 */
const D = (daysAgo: number, hour = 20): number => new Date(2026, 10, 15 - daysAgo, hour, 0, 0, 0).getTime();

function book(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'x',
    meta: {},
    fileRef: { vaultPath: 'a.epub', format: 'epub' },
    reading: { position: { percent: 0 }, stats: {}, sessions: [] },
    notes: { highlights: [], excerpts: [], bookmarks: [] },
    addedAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

const A = book({
  id: 'a',
  meta: { title: '甲', author: '作者甲', wordCount: 10_000 },
  shelf: '小说',
  reading: {
    position: { percent: 0.2 },
    stats: { totalReadTime: 900, lastReadTime: D(0), startReadTime: D(12), rating: 4 },
    sessions: [
      { start: D(12), end: D(12) + 600_000, durationSeconds: 600, percent: 0.1, interruptions: 0 },
      { start: D(0), end: D(0) + 300_000, durationSeconds: 300, percent: 0.2, interruptions: 1 },
    ],
  },
  notes: {
    highlights: [
      { id: 'h1', text: 'a', createdAt: D(12) },
      { id: 'h2', text: 'b', comment: '想法', createdAt: D(1) },
    ],
    excerpts: [],
    bookmarks: [{ id: 'b1', percent: 0.1, createdAt: D(2) }],
  },
});

const B = book({
  id: 'b',
  meta: { title: '乙', author: '作者乙', wordCount: 20_000 },
  fileRef: { vaultPath: 'b.pdf', format: 'pdf' },
  shelf: '非虚构',
  reading: {
    position: { percent: 0.5 },
    stats: { totalReadTime: 1200, lastReadTime: D(9), startReadTime: D(30), completedTime: D(9) },
    sessions: [{ start: D(9), end: D(9) + 1_200_000, durationSeconds: 1200, percent: 0.5 }],
  },
});

/** 只翻过位置、一次都没打开过的书 */
const C = book({
  id: 'c',
  meta: { title: '丙', wordCount: 5_000 },
  shelf: '小说',
  reading: { position: { percent: 0.3 }, stats: { totalReadTime: 0, lastReadTime: 0 }, sessions: [] },
});

function input(patch: Partial<RichInput> = {}): RichInput {
  return {
    books: [A, B, C] as unknown as RichInput['books'],
    checkins: {},
    goal: 10,
    dailyGoalMinutes: 10,
    now: NOW,
    range: 'all',
    ...patch,
  };
}

describe('统计页强化版 · 字数与速度', () => {
  it('读字数按会话百分比增量估算，重读不重复计', () => {
    const s = analyzeRich(input());
    /* 甲：0.1×1e4 + 0.1×1e4 = 2000；乙：0.5×2e4 = 10000 */
    expect(s.readWords).toBe(12_000);
    expect(s.totalWords).toBe(12_000);
  });

  it('速度 = 读字数 / 有效分钟，只算有字数的书', () => {
    const s = analyzeRich(input());
    /* 35 分钟读 12000 字 */
    expect(s.speed).toBe(Math.round(12_000 / 35));
    expect(s.wordBooks).toBe(3);
    expect(s.libraryWords).toBe(35_000);
    expect(s.remainingWords).toBe(35_000 - 12_000);
  });

  it('今天 / 本周 / 本月 / 今年各有一份字数额', () => {
    const s = analyzeRich(input());
    expect(s.todayWords).toBe(1_000); // 只有甲今天读了 0.1
    expect(s.weekWords).toBe(1_000);
    expect(s.monthWords).toBe(12_000);
    expect(s.yearWords).toBe(12_000);
  });

  it('速度趋势按天排，没读的那天是 0 而不是缺项', () => {
    const s = analyzeRich(input());
    expect(s.speedTrend.length).toBe(14);
    expect(s.speedTrend[s.speedTrend.length - 1].wpm).toBeGreaterThan(0);
    expect(s.speedTrend.every((x) => Number.isFinite(x.wpm))).toBe(true);
  });
});

describe('统计页强化版 · 时间维度', () => {
  it('24 小时与星期都铺满，没读的格子是 0', () => {
    const s = analyzeRich(input());
    expect(s.hours24.length).toBe(24);
    expect(s.weekday.length).toBe(7);
    expect(s.hours24[20]).toBeGreaterThan(0); // 三场都在 20 点
    expect(s.hours24.reduce((x, y) => x + y, 0)).toBe(2100);
    expect(s.weekday.reduce((x, y) => x + y, 0)).toBe(2100);
  });

  it('月度 12 格按今年排，跨年数据进去年那一列', () => {
    const s = analyzeRich(input());
    expect(s.monthly.length).toBe(12);
    expect(s.monthly[10].sec).toBe(2100); // 11 月
    expect(s.monthlyPrev.length).toBe(12);
  });

  it('工作日 / 周末分开算', () => {
    const s = analyzeRich(input());
    expect(s.weekdaySec + s.weekendSec).toBe(2100);
  });

  it('按天展开能拿到当天读了哪几本', () => {
    const s = analyzeRich(input());
    const rows = s.dayBooks[s.todayK];
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('甲');
    expect(rows[0].sec).toBe(300);
  });
});

describe('统计页强化版 · 坚持与达标', () => {
  it('最长连续、最长断更、达标率都对', () => {
    const s = analyzeRich(input());
    expect(s.streak).toBe(1); // 今天读了，昨天没读 → 连续 1 天
    expect(s.streakMax).toBe(1);
    /* 有记录的三天是 11-03 / 11-06 / 11-15，最长空档是 11-06 到 11-15 之间的 8 天 */
    expect(s.gapMax).toBe(8);
    /* 甲首场 600 秒、乙 1200 秒都到 10 分钟；甲今天 300 秒不算 */
    expect(s.goalDays).toBe(2);
    expect(s.goalRate).toBeCloseTo(2 / 3, 5);
    expect(s.spanDays).toBe(13);
    expect(s.avgActive).toBe(700);
  });
});

describe('统计页强化版 · 书与进度', () => {
  it('分类 / 格式分组带本数、时长、读完数', () => {
    const s = analyzeRich(input());
    const novel = s.shelves.find((x) => x.name === '小说');
    expect(novel?.books).toBe(2);
    expect(novel?.sec).toBe(900);
    const pdf = s.formats.find((x) => x.name === 'pdf');
    expect(pdf?.books).toBe(1);
    expect(pdf?.sec).toBe(1200);
  });

  it('进度分五档，读完的书单列', () => {
    const s = analyzeRich(input());
    expect(s.buckets.length).toBe(5);
    expect(s.buckets.reduce((x, y) => x + y, 0)).toBe(3);
    expect(s.buckets[0]).toBe(1); // 甲 20%
    expect(s.buckets[1]).toBe(1); // 丙 30%
    expect(s.done).toBe(1); // 乙 completedTime
    expect(s.doneWords).toBe(20_000);
  });

  it('预计读完：按本书速度算剩余秒数与日期', () => {
    const s = analyzeRich(input());
    const b = s.eta.find((x) => x.title === '乙');
    expect(b?.sec).toBe(1200); // 1200 秒读到 50% → 剩 50% 也是 1200 秒
    expect(b?.date).toBe(D(9) + 1200_000);
    const a = s.eta.find((x) => x.title === '甲');
    expect(a?.sec).toBe(3600); // 900 秒读到 20% → 每 1% 45 秒，剩 80% = 3600 秒
  });

  it('搁置榜按最久没打开排，从没打开过的不算', () => {
    const s = analyzeRich(input());
    expect(s.stale.length).toBe(2);
    expect(s.stale[0].title).toBe('乙');
    expect(s.parallel).toBe(2);
  });
});

describe('统计页强化版 · 笔记与评分', () => {
  it('划线 / 想法 / 书签分开数，密度按每万字', () => {
    const s = analyzeRich(input());
    expect(s.hl).toBe(2);
    expect(s.th).toBe(1);
    expect(s.bm).toBe(1);
    expect(s.kb).toBe(0);
    /* 3 条标注（2 划线 + 1 书签）/ 1.2 万字 × 1e4；想法是划线的附属，不重复计 */
    expect(Math.round(s.noteDensity * 10) / 10).toBe(2.5);
  });

  it('笔记按月归档，最后一个月就是今天', () => {
    const s = analyzeRich(input());
    expect(s.noteMonths.length).toBe(12);
    /* 2 条划线 + 1 个书签都落在 11 月 */
    expect(s.noteMonths[11].n).toBe(3);
  });

  it('评分分布与平均分', () => {
    const s = analyzeRich(input());
    expect(s.rated).toBe(1);
    expect(s.ratingAvg).toBe(4);
    expect(s.ratingDist[3]).toBe(1);
  });
});

describe('统计页强化版 · 成就', () => {
  it('徽章有解锁状态与进度，值不会超过 1', () => {
    const s = analyzeRich(input());
    expect(s.achv.length).toBeGreaterThanOrEqual(10);
    for (const a of s.achv) {
      expect(a.progress).toBeGreaterThanOrEqual(0);
      expect(a.progress).toBeLessThanOrEqual(1);
      expect(Number.isFinite(a.value)).toBe(true);
    }
    const done1 = s.achv.find((x) => x.id === 'done1');
    expect(done1?.got).toBe(true);
    const hours10 = s.achv.find((x) => x.id === 'hours10');
    expect(hours10?.got).toBe(false);
  });
});

describe('统计页强化版 · 范围收窄', () => {
  it('近 7 天只收窄时长与字数，全量连续与读完不动', () => {
    const all = analyzeRich(input());
    const week = analyzeRich(input({ range: 'week' }));
    expect(week.total).toBe(300); // 只算今天那场
    expect(week.readWords).toBe(1_000);
    expect(week.streak).toBe(all.streak);
    expect(week.done).toBe(all.done);
    expect(week.activeDays).toBe(1);
  });

  it('近 30 天把本月都算进来', () => {
    const m = analyzeRich(input({ range: 'month' }));
    expect(m.total).toBe(2100);
    expect(m.readWords).toBe(12_000);
  });

  it('今天范围只留今天', () => {
    const t = analyzeRich(input({ range: 'today' }));
    expect(t.total).toBe(300);
    expect(t.today).toBe(300);
  });

  it('老数据没写 lastReadTime：用最后一节会话兜底，搁置榜不空', () => {
    const legacy = book({
      id: 'z',
      meta: { title: '旧数据', wordCount: 1000 },
      reading: {
        position: { percent: 0.5 },
        /* 存量数据常见：只有会话，没有统计汇总 */
        stats: { totalReadTime: 0, lastReadTime: 0 },
        sessions: [{ start: D(5), end: D(5) + 600_000, durationSeconds: 600, percent: 0.5 }],
      },
    });
    const s = analyzeRich(input({ books: [legacy] as unknown as RichInput['books'] }));
    expect(s.stale.length).toBe(1);
    expect(s.stale[0].days).toBeCloseTo(5, 0);
    expect(s.books[0].idleDays).not.toBeNull();
    expect(s.eta[0].date).toBe(D(5) + 600_000 + 600_000);
  });

  it('空库不产生 NaN / Infinity', () => {
    const s = analyzeRich(input({ books: [], checkins: {} }));
    const flat = JSON.stringify(s);
    expect(flat).not.toMatch(/NaN|Infinity/);
    expect(s.speed).toBe(0);
    expect(s.achv.every((x) => x.progress === 0)).toBe(true);
  });
});

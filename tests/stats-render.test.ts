/**
 * 统计页的回归断言（tests/stats-render.test.ts）
 *
 * 整页强化之后，原来的「每日打卡卡」被原型的一比一版式替换：
 * 目标档位、达标文案并入趋势图的目标线与口径对照表。
 * 这里保留锁态的骨架断言，并补一条「数字只认会话、不认手写汇总值」。
 */
import { describe, expect, it } from 'vitest';
import { viewStats, viewStatsLocked, type StatsView } from '../src/shell/render/stats';

const NOW = new Date(2026, 10, 4, 12).getTime();

function view(patch: Partial<StatsView> = {}): StatsView {
  return {
    stats: { totalSeconds: 0, todaySeconds: 0, streakDays: 0, activeDays: 0, days: {}, books: [] },
    books: [],
    goal: 20,
    checkins: {},
    dailyGoalMinutes: 30,
    now: NOW,
    ...patch,
  };
}

describe('统计页 · 目标与口径', () => {
  it('每日目标画成趋势图上的目标线，不再是一排可点档位', () => {
    const h = viewStats(view());
    expect(h).toContain('目标 30 分');
    expect(h).not.toContain('data-act="setdailygoal"');
  });

  it('打卡与会话的差额进口径对照表，不再写「已达标」', () => {
    const h = viewStats(view({ checkins: { '2026-11-04': 30 * 60 }, dailyGoalMinutes: 30 }));
    expect(h).toContain('口径对照');
    expect(h).toContain('30:00');
    expect(h).not.toContain('已达标');
  });

  it('没有 checkins 时三套账仍然齐全，不显示空白', () => {
    const h = viewStats(view({ checkins: undefined, stats: { ...view().stats, days: { '2026-11-04': 31 * 60 } } }));
    expect(h).toContain('会话有效');
    expect(h).toContain('挂钟');
    expect(h).toContain('合计');
  });
});

/** 造最小书籍：锁态只数会话条数与是否读过，不需要完整 schema */
function lockedView(patch: Partial<StatsView> = {}): StatsView {
  const sessions = [
    { start: NOW - 3 * 86_400_000, end: NOW - 3 * 86_400_000 + 129_000, durationSeconds: 129 },
    { start: NOW - 2 * 86_400_000, end: NOW - 2 * 86_400_000 + 395_000, durationSeconds: 395 },
    { start: NOW, end: NOW + 60_000, durationSeconds: 60 },
  ];
  return view({
    stats: {
      totalSeconds: 2234,
      todaySeconds: 1191,
      streakDays: 1,
      activeDays: 3,
      days: {},
      books: [{ id: 'a', title: '甲', percent: 0.3, seconds: 2234, lastRead: NOW }],
    },
    books: [
      { reading: { sessions, position: { percent: 0.3 }, stats: { completedTime: 0 } }, meta: { title: '甲' } },
      { reading: { sessions: [], position: { percent: 0 }, stats: { completedTime: 0 } }, meta: { title: '乙' } },
    ] as unknown as StatsView['books'],
    ...patch,
  });
}

describe('统计页 · 基础版锁态', () => {
  it('头部给出 6 个真实统计，且都在遮罩之外', () => {
    const h = viewStatsLocked(lockedView());
    const head = h.slice(0, h.indexOf('bzs-lockstat'));
    expect((head.match(/class="kpi"/g) ?? []).length).toBe(6);
    expect(head).toContain('09:44');
    expect(head).toContain('01:00');
    expect(head).toContain('3 天');
    expect(head).toContain('1 天');
    expect(head).toContain('3 段');
    expect(head).toContain('1/2');
  });

  it('下面的完整图表被强调色遮罩盖住，只隐约可见', () => {
    const h = viewStatsLocked(lockedView());
    expect(h).toContain('bzs-lockstat-mask');
    expect(h).toContain('bzs-lockstat-body');
    expect(h.indexOf('bzs-lockstat-body')).toBeLessThan(h.indexOf('bzs-lockstat-mask'));
    expect(h).toContain('class="chart"');
  });

  it('高级版按钮与整块遮罩都打开 stats 模式的解锁层', () => {
    const h = viewStatsLocked(lockedView());
    expect(h).toContain('data-act="unlock" data-mode="stats"');
    expect(h).toContain('>高级版</button>');
    expect((h.match(/data-act="unlock"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('数字只认会话明细，手写汇总值不会顶替真实数据', () => {
    const h = viewStatsLocked(lockedView({
      stats: { totalSeconds: 60, todaySeconds: 60, streakDays: 5, activeDays: 9, days: {}, books: [] },
    }));
    expect(h).toContain('09:44');
    expect(h).not.toContain('37:14');
  });

  it('不写解释性长句', () => {
    const h = viewStatsLocked(lockedView());
    expect(h).not.toContain('解锁后');
    expect(h).not.toContain('属于高级版');
  });
});

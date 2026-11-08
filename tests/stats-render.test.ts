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

describe('统计页 · 每日打卡', () => {
  it('显示连续 / 今天 / 本月的打卡状态', () => {
    const h = viewStats(view());
    expect(h).toContain('每日打卡');
    expect(h).toContain('连续');
    expect(h).toContain('今天');
  });

  it('每日目标可点选，当前值高亮', () => {
    const h = viewStats(view());
    expect(h).toContain('data-act="setdailygoal"');
    expect(h).toMatch(/class="[^"]*on[^"]*"[^>]*data-v="30"|data-v="30"[^>]*class="[^"]*on/);
  });

  it('今天读够时写「已达标」，没够时写还差多少', () => {
    const done = viewStats(view({ checkins: { '2026-11-04': 30 * 60 }, dailyGoalMinutes: 30 }));
    expect(done).toContain('已达标');
    const not = viewStats(view({ checkins: { '2026-11-04': 10 * 60 }, dailyGoalMinutes: 30 }));
    expect(not).toContain('还差 20 分');
  });

  it('没有 checkins 时退回统计热力图那份数据，不显示空白', () => {
    const h = viewStats(view({ checkins: undefined, stats: { ...view().stats, days: { '2026-11-04': 31 * 60 } } }));
    expect(h).toContain('已达标');
  });
});

/** 造最小书籍：锁态只数会话条数与是否读过，不需要完整 schema */
function lockedView(patch: Partial<StatsView> = {}): StatsView {
  const sessions = [
    { start: NOW - 3 * 86_400_000, durationSeconds: 129 },
    { start: NOW - 2 * 86_400_000, durationSeconds: 395 },
    { start: NOW, durationSeconds: 60 },
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
    expect((head.match(/class="k"/g) ?? []).length).toBe(6);
    expect(head).toContain('37:14');
    expect(head).toContain('19:51');
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
    expect(h).toContain('bzs-heat');
  });

  it('高级版按钮与整块遮罩都打开 stats 模式的解锁层', () => {
    const h = viewStatsLocked(lockedView());
    expect(h).toContain('data-act="unlock" data-mode="stats"');
    expect(h).toContain('>高级版</button>');
    expect((h.match(/data-act="unlock"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('数字跟着传入的数据走，不是写死的样例', () => {
    const h = viewStatsLocked(lockedView({
      stats: { totalSeconds: 60, todaySeconds: 60, streakDays: 5, activeDays: 9, days: {}, books: [] },
    }));
    expect(h).toContain('01:00');
    expect(h).toContain('9 天');
    expect(h).not.toContain('37:14');
  });

  it('不写解释性长句', () => {
    const h = viewStatsLocked(lockedView());
    expect(h).not.toContain('解锁后');
    expect(h).not.toContain('属于高级版');
  });
});

import { describe, expect, it } from 'vitest';
import { viewStats, type StatsView } from '../src/shell/render/stats';

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

import { describe, expect, it } from 'vitest';
import { addCheckin, checkinStats, clampDailyGoal, dayKey } from '../src/shell/checkin';

/** 本地时区的某天中午：避开夏令时与「今天」边界 */
function noon(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

describe('打卡（阅读目标真正可打卡）', () => {
  it('今天读够了就达标，差几分钟也报出来', () => {
    const now = noon(2026, 11, 4);
    const map = { [dayKey(new Date(now))]: 20 * 60 };
    const s = checkinStats(map, 20, now);
    expect(s.todayDone).toBe(true);
    expect(s.todayMinutes).toBe(20);
    expect(s.leftMinutes).toBe(0);

    const s2 = checkinStats({ [dayKey(new Date(now))]: 12 * 60 }, 20, now);
    expect(s2.todayDone).toBe(false);
    expect(s2.leftMinutes).toBe(8);
  });

  it('连续打卡从今天往前数；今天没达标时从昨天算，不算断', () => {
    const now = noon(2026, 11, 4);
    const map = {
      [dayKey(new Date(2026, 10, 1))]: 30 * 60,
      [dayKey(new Date(2026, 10, 2))]: 30 * 60,
      [dayKey(new Date(2026, 10, 3))]: 30 * 60,
      // 今天（11-04）还没读
    };
    expect(checkinStats(map, 20, now).streak).toBe(3);

    map[dayKey(new Date(now))] = 25 * 60;
    expect(checkinStats(map, 20, now).streak).toBe(4);
  });

  it('中间断一天就停', () => {
    const now = noon(2026, 11, 4);
    const map = {
      [dayKey(new Date(2026, 10, 1))]: 30 * 60,
      // 11-02 断了
      [dayKey(new Date(2026, 10, 3))]: 30 * 60,
      [dayKey(new Date(now))]: 30 * 60,
    };
    expect(checkinStats(map, 20, now).streak).toBe(2);
  });

  it('本月格子：达标 1、没达标 0、未来的 -2', () => {
    const now = noon(2026, 11, 4);
    const map = {
      [dayKey(new Date(2026, 10, 1))]: 30 * 60,
      [dayKey(new Date(2026, 10, 3))]: 30 * 60,
    };
    const s = checkinStats(map, 20, now);
    expect(s.month).toHaveLength(30); // 11 月 30 天
    expect(s.month[0]).toBe(1);
    expect(s.month[1]).toBe(0);
    expect(s.month[2]).toBe(1);
    expect(s.month[4]).toBe(-2); // 11-05 还没到
    expect(s.monthDays).toBe(2);
  });

  it('目标分钟数被夹住：0 或负数不会让「0 秒也算达标」', () => {
    const now = noon(2026, 11, 4);
    expect(checkinStats({}, 0, now).todayDone).toBe(false);
    expect(checkinStats({}, -5, now).todayDone).toBe(false);
    expect(checkinStats({}, 99999, now).leftMinutes).toBeGreaterThan(0);
  });

  it('没有记录时全零，不抛', () => {
    const s = checkinStats(undefined, 20, noon(2026, 11, 4));
    expect(s.streak).toBe(0);
    expect(s.monthDays).toBe(0);
    expect(s.todayMinutes).toBe(0);
  });
});

describe('每日目标（clampDailyGoal）', () => {
  it('合法值原样保留（取整）', () => {
    expect(clampDailyGoal(30)).toBe(30);
    expect(clampDailyGoal(22.4)).toBe(22);
  });

  it('夹在 1..600 分钟：0 会让「0 秒也算达标」，600 以上没有意义', () => {
    expect(clampDailyGoal(0)).toBe(1);
    expect(clampDailyGoal(-5)).toBe(1);
    expect(clampDailyGoal(99999)).toBe(600);
  });

  it('非数字退回默认 20（手改 JSON / 旧版本留下的脏值）', () => {
    expect(clampDailyGoal(undefined)).toBe(20);
    expect(clampDailyGoal(Number.NaN)).toBe(20);
    expect(clampDailyGoal('abc')).toBe(20);
  });

  it('数字字符串能用（设置页输入框给过来的就是字符串）', () => {
    expect(clampDailyGoal('25')).toBe(25);
  });
});

describe('addCheckin', () => {
  it('同一天多次会话累加', () => {
    const now = noon(2026, 11, 4);
    const data: { checkins?: Record<string, number> } = {};
    addCheckin(data, 60, now);
    addCheckin(data, 90, now);
    expect(data.checkins?.[dayKey(new Date(now))]).toBe(150);
  });

  it('非法秒数直接忽略，不写脏数据', () => {
    const data: { checkins?: Record<string, number> } = {};
    addCheckin(data, 0, noon(2026, 11, 4));
    addCheckin(data, -30, noon(2026, 11, 4));
    addCheckin(data, Number.NaN, noon(2026, 11, 4));
    // 一次都没写进去，连 checkins 这个字段都不该凭空造出来
    expect(data.checkins).toBeUndefined();
  });

  it('只留最近 400 天', () => {
    const data: { checkins?: Record<string, number> } = { checkins: {} };
    for (let i = 0; i < 450; i += 1) {
      const d = new Date(2025, 0, 1 + i);
      data.checkins![dayKey(d)] = 60;
    }
    addCheckin(data, 60, noon(2026, 11, 4));
    expect(Object.keys(data.checkins!).length).toBeLessThanOrEqual(401);
  });
});

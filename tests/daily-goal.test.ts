import { describe, expect, it } from 'vitest';
import { DEFAULT_DAILY_GOAL, clampDailyGoal } from '../src/data/goal';
import { analyzeFull } from '../src/data/stats-full';
import { checkinStats } from '../src/shell/checkin';

/**
 * 每日目标（2026-11-09 发版复核）。
 *
 * 以前这把尺子在三个地方各写一遍：设置页把 0 当成 20 分钟、统计页当成
 * 1 分钟、打卡判定又当成 1 分钟。用户手改坏一次 JSON，设置页高亮 20、
 * 统计页按 1 判定——同一份数据两套结论。
 *
 * 现在数值常量与归一函数只留 data/goal.ts，下面这些边界既是它的行为，
 * 也是三处调用点必须一致的那部分。
 */

describe('每日目标归一', () => {
  it('非数字回默认值', () => {
    expect(clampDailyGoal(NaN)).toBe(DEFAULT_DAILY_GOAL);
    expect(clampDailyGoal('不是数')).toBe(DEFAULT_DAILY_GOAL);
    expect(clampDailyGoal(undefined)).toBe(DEFAULT_DAILY_GOAL);
  });

  it('0 与负数夹到 1 分钟：0 秒也算达标，等于把目标变成摆设', () => {
    expect(clampDailyGoal(0)).toBe(1);
    expect(clampDailyGoal(-30)).toBe(1);
  });

  it('超过十小时夹到 600 分钟', () => {
    expect(clampDailyGoal(9999)).toBe(600);
  });

  it('小数取整、数字字符串照收', () => {
    expect(clampDailyGoal(12.6)).toBe(13);
    expect(clampDailyGoal('30')).toBe(30);
  });
});

describe('三处调用点用同一把尺子', () => {
  const full = (dailyGoalMinutes: unknown) =>
    analyzeFull({
      books: [],
      checkins: {},
      goal: 0,
      dailyGoalMinutes: dailyGoalMinutes as number,
      now: Date.UTC(2026, 10, 9, 4, 0, 0),
      range: 'all',
    });

  it('统计页的目标与归一函数一致（含坏值）', () => {
    for (const raw of [0, -5, NaN, 9999, 12.6, '30', undefined]) {
      expect(full(raw).dailyGoal, `raw=${String(raw)}`).toBe(clampDailyGoal(raw));
    }
  });

  it('设置页与打卡判定：0 分钟按 1 分钟算，不再按 20 算', () => {
    expect(checkinStats({}, 0, Date.UTC(2026, 10, 9, 4, 0, 0))).toEqual(
      checkinStats({}, 1, Date.UTC(2026, 10, 9, 4, 0, 0)),
    );
    /* 设置页那个弹层复用同一个函数：0 也会落在 1 分钟这一档 */
    expect(clampDailyGoal(0)).toBe(1);
  });
});

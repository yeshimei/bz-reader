/* ============================================================
 * bz-reader · 每日阅读目标（data/goal.ts）
 *
 * 一把尺子三个地方用：设置页那个档位（写盘前）、统计页判定「今天达标
 * 没有」、以及旧数据手改坏之后的兜底。以前这三处各写一遍 `Math.min(600,
 * Math.max(1, Math.round(...)))`，还各自把「0」当成了不同的东西——
 * 设置页高亮 20 分钟，统计页却按 1 分钟判定。
 *
 * 所以数值常量与归一函数只留这一份，纯函数、不依赖 Obsidian。
 * ============================================================ */

/** 每日默认目标：20 分钟。统计页、设置页与旧数据缺值时都用它 */
export const DEFAULT_DAILY_GOAL = 20;

/** 下限 1 分钟：0 会让「今天达标」永远成立（0 秒也算够） */
export const DAILY_GOAL_MIN = 1;

/** 上限 600 分钟（十小时）：再大只是把目标变成永不可能 */
export const DAILY_GOAL_MAX = 600;

/**
 * 每日目标分钟数归一。
 *
 * 设置页输入框给的是字符串，手改 JSON 可能是 0 / 负数 / 字符串垃圾。
 * 非数字一律回默认值；数字则夹在 1..600 并取整。
 */
export function clampDailyGoal(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_DAILY_GOAL;
  return Math.min(DAILY_GOAL_MAX, Math.max(DAILY_GOAL_MIN, Math.round(n)));
}

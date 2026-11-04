/* ============================================================
 * bz-reader · 每日打卡（shell/checkin.ts）
 *
 * 新功能「阅读目标真正可打卡」的纯逻辑。
 *
 * 以前 `goal` 只是统计页那圈铜线的一个数字：不记录、不提醒、不结算。
 * 用户设了「今年 30 本」，年底看到的只是「已读 8 本」——没有任何一天
 * 给过他「今天已经够了」的反馈。
 *
 * 这里只做三件事，全是纯函数：
 *   1. 当天读了多少分钟（由阅读会话累加，见 reader-view.settle）
 *   2. 连续打卡几天（今天没达标时从昨天算，不算断）
 *   3. 这个月哪些天打了卡（日历格子）
 *
 * 为什么「今天没达标从昨天算」：早上九点打开统计页，今天当然还没读够——
 * 那时候把连续天数清零，等于每天早上都在惩罚用户。
 * ============================================================ */

/** 本地时区的 YYYY-MM-DD（与 entitlement.todayKey 同口径，别用 UTC） */
export function dayKey(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 每日默认目标：20 分钟。统计页与旧数据缺值时都用它 */
export const DEFAULT_DAILY_GOAL = 20;

/**
 * 每日目标分钟数归一。
 *
 * 设置页输入框给的是字符串，手改 JSON 可能是 0 / 负数 / 字符串垃圾。
 * 0 会让「今天达标」永远成立（0 秒也算够），负数同理；上限 600 是
 * 「一天认真读十小时」的天花板，再大只是把目标变成永不可能。
 */
export function clampDailyGoal(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_DAILY_GOAL;
  return Math.min(600, Math.max(1, Math.round(n)));
}

export interface CheckinStats {
  /** 连续打卡天数（今天没达标时从昨天往前数） */
  streak: number;
  /** 这个月已经打卡的天数 */
  monthDays: number;
  /** 今天读了多少分钟（向下取整） */
  todayMinutes: number;
  /** 今天达标了没有 */
  todayDone: boolean;
  /** 这个月的打卡格：`1` 达标 / `0` 没达标或还没读 / `-2` 未来 */
  month: number[];
  /** 今天还差多少分钟达标（已达标为 0） */
  leftMinutes: number;
}

/**
 * 算打卡状态。
 *
 * `goalMinutes` 夹在 1..600：手改坏的 JSON 或旧版本留下的 0 会让
 * 「今天达标」永远成立（0 秒也算够），那一圈铜线就成了摆设。
 */
export function checkinStats(
  checkins: Record<string, number> | undefined,
  goalMinutes: number,
  now = Date.now(),
): CheckinStats {
  const goal = clampDailyGoal(goalMinutes);
  const goalSec = goal * 60;
  const map = checkins && typeof checkins === 'object' ? checkins : {};

  const today = new Date(now);
  const todayKey = dayKey(today);
  const todaySec = Math.max(0, Number(map[todayKey]) || 0);
  const todayDone = todaySec >= goalSec;

  /* 连续天数：从今天（没达标就从昨天）往前数，遇到第一个没达标的日子停。
     上限 3650 天：手改出一个「连续 999999 天」没有意义，还会让循环卡住。 */
  let streak = 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!todayDone) cursor.setDate(cursor.getDate() - 1);
  for (let i = 0; i < 3650; i += 1) {
    const key = dayKey(cursor);
    if ((Number(map[key]) || 0) < goalSec) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  /* 本月格子：1 号到月末，达标 1、没达标 0、今天之后 -2、今天之前没记录 0 */
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthArr: number[] = [];
  let monthDays = 0;
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = dayKey(new Date(year, month, d));
    if ((Number(map[key]) || 0) >= goalSec) {
      monthArr.push(1);
      monthDays += 1;
    } else {
      monthArr.push(d > today.getDate() ? -2 : 0);
    }
  }

  return {
    streak,
    monthDays,
    todayMinutes: Math.floor(todaySec / 60),
    todayDone,
    month: monthArr,
    leftMinutes: todayDone ? 0 : Math.max(1, Math.ceil((goalSec - todaySec) / 60)),
  };
}

/** 把一次会话的秒数记进当天（就地改 `data.checkins`），返回当天累计秒数 */
export function addCheckin(
  data: { checkins?: Record<string, number> },
  seconds: number,
  now = Date.now(),
): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const map: Record<string, number> =
    data.checkins && typeof data.checkins === 'object' ? data.checkins : (data.checkins = {});
  const key = dayKey(new Date(now));
  const next = Math.max(0, (Number(map[key]) || 0) + Math.round(seconds));
  map[key] = next;
  /* 只留最近 400 天：打卡记录不是账本，无限长只会让 JSON 越来越大 */
  const keys = Object.keys(map).sort();
  if (keys.length > 400) {
    for (const k of keys.slice(0, keys.length - 400)) delete map[k];
  }
  return next;
}

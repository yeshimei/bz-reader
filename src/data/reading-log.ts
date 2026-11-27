/* ============================================================
 * bz-reader · 重读记录（data/reading-log.ts）
 *
 * 「读完了」是一本书里的一个时间点，不是一次性的布尔值。同一个人会把同一本
 * 书读第二遍、第三遍：每读完一轮，都要能查到这一轮从哪天开始、哪天读完。
 *
 * 以前的 `stats.startReadTime` / `stats.completedTime` 只有一对单值——重读
 * 一开始就把上一次覆盖掉，用户说「想看全部时间记录」时无从查起。
 *
 * 这里用一份轮次表 `reading.readthroughs` 记：
 *   · 打开书时开新一轮（上一轮已读完才开，没读完继续算同一轮）
 *   · 确认读完后给这一轮盖上结束时间
 *
 * 老书没有这张表：第一次打开时按 `startReadTime` / `completedTime` 补一条，
 * 历史只剩这一条——从这一版之后才开始逐轮累积（用户已知悉并接受）。
 * ============================================================ */
import type { ReadingBlock, ReadingSession } from './schema';

/** 一轮阅读：`end` 为空表示这一轮还在读 */
export interface Readthrough {
  start: number;
  end?: number;
}

/** 一轮阅读的展示行 */
export interface ReadthroughRow {
  start: number;
  end?: number;
  /** 这一轮累计有效阅读秒数（按会话起点落在区间内求和） */
  seconds: number;
}

function validTime(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 打开书时调：保证有一轮「正在进行」。
 *
 * - 老数据（没有轮次表）：按已有的第一次打开 / 读完时间补一条；
 * - 上一轮已读完：开新一轮（这就是重读的起点）；
 * - 上一轮没读完：沿用（关掉再开不算新的一轮，否则每开一次书就多一条）。
 */
export function beginReadthrough(reading: ReadingBlock, now = Date.now()): Readthrough[] {
  const list = (reading.readthroughs ??= []);
  if (!list.length) {
    const start = validTime(reading.stats.startReadTime) || now;
    const end = validTime(reading.stats.completedTime);
    list.push(end && end >= start ? { start, end } : { start });
  }
  const last = list[list.length - 1];
  if (last?.end) list.push({ start: now });
  return list;
}

/**
 * 确认读完时调：给正在进行的那一轮盖结束时间。
 *
 * 幂等——重复确认不会改掉已经写下的时间（读完后反复点「保存」是常见操作）。
 */
export function finishReadthrough(reading: ReadingBlock, now = Date.now()): void {
  const list = (reading.readthroughs ??= []);
  if (!list.length) {
    const start = validTime(reading.stats.startReadTime) || now;
    list.push({ start, end: now });
    return;
  }
  const last = list[list.length - 1];
  if (!last.end) last.end = now;
}

/**
 * 「取消读完」时调：把最后一轮的结束时间撤掉，退回「在读」。
 *
 * 只撤最后一条、且只在它是「刚读完的那一轮」时撤。历史轮次不动——
 * 读到第三遍中途点了取消，前两遍的记录不该跟着消失。
 */
export function cancelFinishReadthrough(reading: ReadingBlock): void {
  const list = reading.readthroughs ?? [];
  const last = list[list.length - 1];
  if (last?.end) delete last.end;
}

/** 这一轮算出来的阅读秒数：只数会话起点落在区间里的那些 */function secondsIn(list: readonly ReadingSession[], start: number, end?: number): number {
  let sum = 0;
  for (const s of list) {
    const at = validTime(s.start);
    if (!at || at < start) continue;
    if (end && at > end) continue;
    const d = Number(s.durationSeconds);
    if (Number.isFinite(d) && d > 0) sum += d;
  }
  return Math.round(sum);
}

/**
 * 展示用的轮次列表，最新的一轮在前。
 *
 * 秒数按会话起点归属：一轮里关开十次就是十条会话求和；跨轮边界的会话
 * （读到一半关了、第二天接着读）只算进起点所属的那一轮，不做拆分。
 *
 * 老书（还没有轮次表）在这里按 `startReadTime` / `completedTime` 推一条出来，
 * 不写回数据——用户点开详情就该看到「什么时候开始读、什么时候读完」，
 * 不该要求他先打开一次书才长出来。
 */
export function readthroughRows(reading: ReadingBlock): ReadthroughRow[] {
  let list = reading.readthroughs ?? [];
  if (!list.length) {
    const start = validTime(reading.stats.startReadTime);
    const end = validTime(reading.stats.completedTime);
    if (!start && !end) return [];
    list = [end ? { start: start || end, end } : { start }];
  }
  return list
    .map((r) => ({
      start: r.start,
      ...(r.end ? { end: r.end } : {}),
      seconds: secondsIn(reading.sessions ?? [], r.start, r.end),
    }))
    .sort((a, b) => b.start - a.start);
}

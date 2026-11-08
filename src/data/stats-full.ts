/* ============================================================
 * bz-reader · 统计页强化版计算层（data/stats-full.ts）
 *
 * 与 prototype/stats/index.html 的 analyze() 同口径，唯一差别是数据源：
 * 原型吃 `CONFIG/BZ READER/bz-reader.json`，这里直接吃仓库里的
 * `ReaderBook[]` + `checkins`。字段名一一对应（meta / reading.position /
 * reading.sessions / reading.stats），所以算法可以逐行搬过来。
 *
 * 三套账分开算，谁也不替谁圆场：
 *   · 有效时长 = sessions[].durationSeconds（剔除闲置后的值，主口径）
 *   · 挂钟     = end - start
 *   · 打卡     = checkins[YYYY-MM-DD]
 * 进度只作「翻到哪儿」，不折算字数、不算字每分钟。
 * ============================================================ */
import type { ReaderBook } from './schema';
import { dayKey } from './stats';

const DAY = 86_400_000;

export type StatsRange = 'all' | 'today';
export type BookStatus = 'done' | 'longIdle' | 'idle' | 'reading' | 'posOnly' | 'unstarted';

export interface FullStatsInput {
  books: ReaderBook[];
  /** `YYYY-MM-DD` → 秒。可由页面预演覆盖，但绝不写回 store */
  checkins: Record<string, number>;
  goal: number;
  dailyGoalMinutes: number;
  now: number;
  range: StatsRange;
}

export interface FullBookRow {
  id: string;
  title: string;
  author: string;
  percent: number;
  /** 范围内有效时长 */
  eff: number;
  /** 范围内挂钟 */
  wall: number;
  /** 范围内会话数 */
  n: number;
  /** 全量会话数 */
  nAll: number;
  first: number;
  last: number;
  idleDays: number | null;
  /** 每 1% 进度投入的秒数 */
  perPct: number | null;
  finishDays: number | null;
  status: BookStatus;
}

export interface FullStats {
  range: StatsRange;
  now: number;
  todayK: string;
  first: number;
  /** 全量：按天的有效 / 挂钟秒数 */
  fullEff: Record<string, number>;
  fullWall: Record<string, number>;
  /** 范围内：按天的有效 / 挂钟秒数 */
  days: Record<string, number>;
  wallDays: Record<string, number>;
  /** 四个时段（凌晨 / 上午 / 下午 / 夜间）的有效秒数 */
  hour: number[];
  /** 单次会话长度四档的条数 */
  len: number[];
  books: FullBookRow[];
  total: number;
  fullEffTotal: number;
  fullWallTotal: number;
  sessionCount: number;
  allCount: number;
  today: number;
  activeDays: number;
  streak: number;
  weekCur: number;
  weekPrev: number;
  monthCur: number;
  monthPrev: number;
  ckKeysAll: string[];
  ckTotal: number;
  orphanDays: string[];
  posOnly: string[];
  done: number;
  goal: number;
  dailyGoal: number;
  wallGreater: number;
  regress: number;
  clockDrift: number;
  peakKey: string;
  peakSec: number;
  bestHour: number;
  bestHourSec: number;
  idleCount: number;
  checkins: Record<string, number>;
  source: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** 秒 → mm:ss。跨小时也不折算成 h:mm，和原型保持同一把尺子 */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** `MM-DD HH:mm`，与原型 ts2 一致 */
export function shortTime(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dayLabel(key: string): string {
  return key ? key.slice(5) : '—';
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayStartOfKey(k: string): number {
  return new Date(`${k}T00:00:00`).getTime();
}

function weekStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** 环比：没有上期就是破折号，不编 0% */
export function delta(cur: number, prev: number): string {
  if (!prev) return '—';
  const d = ((cur - prev) / prev) * 100;
  return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}%`;
}

export function statsHeatLevel(sec: number): number {
  if (!sec) return 0;
  if (sec >= 2700) return 4;
  if (sec >= 1500) return 3;
  if (sec >= 600) return 2;
  return 1;
}

/**
 * 把整份数据折叠成页面要的模型。
 *
 * `range='today'` 只收窄时长类指标（total / today / activeDays / 时段 /
 * 会话分布）；连续、读完、峰值、周月对比仍看全量——切到今天不该显示
 * 「今天读完 0 本」这种假结论。
 */
export function analyzeFull(input: FullStatsInput): FullStats {
  const { books: rawBooks, now, range } = input;
  const from = range === 'today' ? startOfDay(now) : -Infinity;
  const checkins = input.checkins || {};
  const fullEff: Record<string, number> = {};
  const fullWall: Record<string, number> = {};
  const days: Record<string, number> = {};
  const wallDays: Record<string, number> = {};
  const hour = [0, 0, 0, 0];
  const len = [0, 0, 0, 0];
  let allCount = 0;
  let wallGreater = 0;
  let regress = 0;
  let clockDrift = 0;
  let weekCur = 0;
  let weekPrev = 0;
  let monthCur = 0;
  let monthPrev = 0;

  const wk = weekStart(now);
  const prevWk = wk - 7 * DAY;
  const mStart = new Date(now);
  mStart.setDate(1);
  mStart.setHours(0, 0, 0, 0);
  const pmEnd = new Date(now);
  pmEnd.setMonth(pmEnd.getMonth() - 1);
  const lastDayPrevMonth = new Date(pmEnd.getFullYear(), pmEnd.getMonth() + 1, 0).getDate();
  pmEnd.setDate(Math.min(new Date(now).getDate(), lastDayPrevMonth));
  pmEnd.setHours(23, 59, 59, 999);
  const pmStart = new Date(pmEnd);
  pmStart.setDate(1);
  pmStart.setHours(0, 0, 0, 0);

  const books: FullBookRow[] = rawBooks.map((b) => {
    const meta = b.meta ?? ({} as ReaderBook['meta']);
    const reading = b.reading ?? ({} as ReaderBook['reading']);
    const bstats = reading.stats ?? {};
    const sessions = reading.sessions ?? [];
    const position = reading.position ?? { percent: 0 };
    const percent = Number(position.percent) || 0;
    const last = Number(bstats.lastReadTime) || 0;
    let eff = 0;
    let wall = 0;
    let n = 0;
    let nAll = 0;
    let first = 0;

    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i];
      if (!s.start || s.start <= 0) continue;
      allCount += 1;
      nAll += 1;
      first = first ? Math.min(first, s.start) : s.start;
      const e = Math.max(0, Math.round(s.durationSeconds || 0));
      const w = Math.max(0, Math.round(((s.end || s.start) - s.start) / 1000));
      if (w - e > 1) wallGreater += 1;
      const prev = sessions[i - 1];
      if (prev && typeof s.percent === 'number' && typeof prev.percent === 'number' && s.percent < prev.percent - 1e-9) {
        regress += 1;
      }
      const k = dayKey(s.start);
      fullEff[k] = (fullEff[k] || 0) + e;
      fullWall[k] = (fullWall[k] || 0) + w;
      if (s.start >= wk && s.start <= now) weekCur += e;
      else if (s.start >= prevWk && s.start < wk) weekPrev += e;
      if (s.start >= mStart.getTime() && s.start <= now) monthCur += e;
      if (s.start >= pmStart.getTime() && s.start <= pmEnd.getTime()) monthPrev += e;
      if (s.start >= from) {
        days[k] = (days[k] || 0) + e;
        wallDays[k] = (wallDays[k] || 0) + w;
        eff += e;
        wall += w;
        n += 1;
        hour[Math.min(3, Math.floor(new Date(s.start).getHours() / 6))] += e;
        len[e < 60 ? 0 : e < 180 ? 1 : e < 360 ? 2 : 3] += 1;
      }
    }

    const sessionSum = sessions.reduce((x, s) => x + (s.durationSeconds || 0), 0);
    if (Math.abs((Number(bstats.totalReadTime) || 0) - sessionSum) > 0) clockDrift += 1;
    const idleDays = last ? (now - last) / DAY : null;
    const perPct = nAll > 0 && percent > 0 ? eff / (percent * 100) : null;
    const completed = Number(bstats.completedTime) || 0;
    const finishDays = completed && first ? (completed - first) / DAY : null;
    const status: BookStatus =
      completed || percent >= 0.99 ? 'done'
        : nAll > 0 && idleDays !== null && idleDays >= 7 ? 'longIdle'
          : nAll > 0 && idleDays !== null && idleDays >= 3 ? 'idle'
            : nAll > 0 ? 'reading'
              : percent > 0 ? 'posOnly' : 'unstarted';

    return {
      id: b.id || '',
      title: meta.title || '',
      author: meta.author || '',
      percent,
      eff,
      wall,
      n,
      nAll,
      first,
      last,
      idleDays,
      perPct,
      finishDays,
      status,
    };
  });

  const total = Object.keys(days).reduce((x, k) => x + days[k], 0);
  const fullEffTotal = Object.values(fullEff).reduce((x, y) => x + y, 0);
  const fullWallTotal = Object.values(fullWall).reduce((x, y) => x + y, 0);
  const sessionCount = books.reduce((x, b) => x + b.n, 0);
  const todayK = dayKey(now);
  const activeDays = Object.values(days).filter((v) => v > 0).length;

  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  let cursor = noon.getTime();
  if (!(fullEff[dayKey(cursor)] > 0)) cursor -= DAY;
  let streak = 0;
  while (fullEff[dayKey(cursor)] > 0) {
    streak += 1;
    cursor -= DAY;
  }

  const ckKeysAll = Object.keys(checkins).sort();
  const ckTotal = ckKeysAll.reduce((x, k) => x + (Number(checkins[k]) || 0), 0);
  const done = books.filter((b) => b.status === 'done').length;
  const firstKey = Object.keys(fullEff).sort()[0];
  const first = firstKey ? dayStartOfKey(firstKey) : startOfDay(now);
  const orphanDays = ckKeysAll.filter((k) => !(fullEff[k] > 0));
  const posOnly = books.filter((b) => b.nAll === 0 && b.percent > 0).map((b) => b.title);
  const peakKey = Object.keys(fullEff).sort((x, y) => fullEff[y] - fullEff[x])[0] || '';
  const bestHour = hour.indexOf(Math.max(...hour));
  const idleCount = books.filter((b) => b.status === 'idle' || b.status === 'longIdle').length;
  const rawGoal = Number(input.dailyGoalMinutes);
  const dailyGoal = Number.isFinite(rawGoal) ? Math.min(600, Math.max(1, Math.round(rawGoal))) : 20;

  return {
    range,
    now,
    todayK,
    first,
    fullEff,
    fullWall,
    days,
    wallDays,
    hour,
    len,
    books,
    total,
    fullEffTotal,
    fullWallTotal,
    sessionCount,
    allCount,
    today: days[todayK] || 0,
    activeDays,
    streak,
    weekCur,
    weekPrev,
    monthCur,
    monthPrev,
    ckKeysAll,
    ckTotal,
    orphanDays,
    posOnly,
    done,
    goal: Number(input.goal) || 0,
    dailyGoal,
    wallGreater,
    regress,
    clockDrift,
    peakKey,
    peakSec: peakKey ? fullEff[peakKey] : 0,
    bestHour,
    bestHourSec: hour[bestHour],
    idleCount,
    checkins,
    source: '',
  };
}

export interface SeriesItem { label: string; sec: number }
export interface Series { unit: 'day' | 'week'; items: SeriesItem[] }

/** 趋势序列：≤14 天按天，再多合并成不超过 14 组 */
export function statsSeries(a: FullStats): Series {
  const keys: string[] = [];
  const start = a.range === 'all' ? a.first : startOfDay(a.now);
  const end = startOfDay(a.now);
  for (let t = start; t <= end && keys.length < 400; t += DAY) keys.push(dayKey(t));
  if (!keys.length) keys.push(a.todayK);
  if (keys.length <= 14) {
    return { unit: 'day', items: keys.map((k) => ({ label: dayLabel(k), sec: a.days[k] || 0 })) };
  }
  const per = Math.ceil(keys.length / 14);
  const out: SeriesItem[] = [];
  for (let i = 0; i < keys.length; i += per) {
    const chunk = keys.slice(i, i + per);
    out.push({
      label: dayLabel(chunk[0]),
      sec: chunk.reduce((x, k) => x + (a.days[k] || 0), 0),
    });
  }
  return { unit: 'week', items: out };
}

/** 口径对照表的行：日期集合取「会话日 ∪ 打卡日」 */
export function statsAuditDays(a: FullStats): string[] {
  return Array.from(new Set(Object.keys(a.fullEff).concat(Object.keys(a.checkins)))).sort();
}

export interface QualityCell { k: string; v: string; ok: boolean }

type Tr = (key: string, params?: Record<string, string | number>) => string;

/** 六格数据体检。k 是 i18n key，单位由调用方（页面传 t()）给，计算层不写文案 */
export function statsQuality(a: FullStats, tr: Tr): QualityCell[] {
  const diff = a.ckTotal - a.fullEffTotal;
  return [
    { k: 'stats.f.q.wall', v: `${a.wallGreater}/${a.allCount}`, ok: a.wallGreater === 0 },
    { k: 'stats.f.q.ckDiff', v: `${diff < 0 ? '−' : ''}${clock(Math.abs(diff))}`, ok: Math.abs(diff) < 1 },
    { k: 'stats.f.q.orphan', v: `${a.orphanDays.length} ${tr('stats.f.unit.day')}`, ok: a.orphanDays.length === 0 },
    { k: 'stats.f.q.regress', v: `${a.regress} ${tr('stats.f.unit.pair')}`, ok: a.regress === 0 },
    { k: 'stats.f.q.drift', v: `${a.books.length - a.clockDrift}/${a.books.length}`, ok: a.clockDrift === 0 },
    { k: 'stats.f.q.done', v: `${a.done} ${tr('stats.f.unit.book')}`, ok: a.done > 0 },
  ];
}

export interface RecalcRow { day: string; old: number; next: number }

/** 按会话重算打卡的逐日清单。只生成，不写回 */
export function statsRecalcRows(a: FullStats): RecalcRow[] {
  return statsAuditDays(a).map((k) => ({
    day: k,
    old: Number(a.checkins[k]) || 0,
    next: a.fullEff[k] || 0,
  }));
}

/** 可复制的文字报告，九行，与原型 reportText 逐行对应 */
export function statsReportText(a: FullStats, tr: Tr): string {
  const ser = statsSeries(a);
  const best = [...ser.items].sort((x, y) => y.sec - x.sec)[0];
  const top = [...a.books].sort((x, y) => y.eff - x.eff)[0];
  const fastest = [...a.books].sort((x, y) => y.percent - x.percent)[0];
  const byEff = a.books.filter((b) => b.eff > 0).sort((x, y) => y.eff - x.eff);
  const hourName = (i: number): string => tr(`stats.f.hour${i}`);
  return [
    tr('stats.f.report.title', { date: a.todayK }),
    `${dayKey(a.first)} ~ ${a.todayK}`,
    tr('stats.f.report.line1', {
      total: clock(a.total), today: clock(a.today), active: a.activeDays,
      streak: a.streak, sessions: a.sessionCount,
    }),
    tr('stats.f.report.line2', {
      week: clock(a.weekCur), lastWeek: a.weekPrev ? clock(a.weekPrev) : '—',
      month: clock(a.monthCur), lastMonth: a.monthPrev ? clock(a.monthPrev) : '—',
    }),
    tr('stats.f.report.line3', {
      day: dayLabel(a.peakKey), peak: clock(a.peakSec),
      hour: hourName(a.bestHour), hourSec: clock(a.bestHourSec), idle: a.idleCount,
    }),
    tr('stats.f.report.line4', {
      books: a.books.length, read: byEff.length, done: a.done, goal: a.goal,
    }),
    tr('stats.f.report.line5', {
      top: top ? top.title : '—', topSec: top ? clock(top.eff) : '—',
      fastest: fastest ? fastest.title : '—', fastestPct: fastest ? pct(fastest.percent) : '—',
    }),
    tr('stats.f.report.line6', { label: best ? best.label : '—', sec: best ? clock(best.sec) : '—' }),
    `${tr('stats.f.report.byBook')} ${byEff.map((b) => `${b.title} ${clock(b.eff)}`).join(' · ')}`,
  ].join('\n');
}

/* ============================================================
 * bz-reader · 统计页强化层（data/stats-rich.ts）
 *
 * 在 stats-full 的「时长三套账」之上再叠一层**书里本来就有、以前没人算**的
 * 数据：字数与速度、24 小时与星期、月度与去年、分类 / 格式 / 进度分档、
 * 预计读完、搁置榜、笔记产出、评分、成就。
 *
 * 三条口径先说清楚，页面上的每个新数字都从这里来：
 *   1. **字数一律是估算**：会话百分比增量 × meta.wordCount。EPUB 的字数本身
 *      是按章节文本估的，跨章百分比也不等于字数比例，所以只叫「估算」，
 *      没字数的书（PDF / 部分剪藏本）不进速度的分母。
 *   2. **重读不重复计**：进度回退那次不算字，`prevPct` 只认历史最大值。
 *   3. **范围只切按天可切的指标**：时长、字数、时段、日明细跟着 range 走；
 *      连续、最长连续、读完、成就、搁置这类「历史结论」永远看全量——切到
 *      「今天」不该显示「连续 0 天」「读完 0 本」。
 *
 * 这一层不 import i18n：文案键由渲染层给，和 stats-full 的 statsQuality 同规矩。
 * ============================================================ */
import type { ReaderBook } from './schema';
import { dayKey } from './stats';
import {
  analyzeFull,
  rangeStart,
  startOfDay,
  type FullStats,
  type StatsRange,
} from './stats-full';
import { clampDailyGoal } from './goal';

const DAY = 86_400_000;
const pad = (n: number): string => String(n).padStart(2, '0');

/** 成就徽章 id：渲染层按 id 取文案键，数据层只认 id */
export type AchievementId =
  | 'streak7'
  | 'streak30'
  | 'streak100'
  | 'hours10'
  | 'hours100'
  | 'hours1000'
  | 'done1'
  | 'done10'
  | 'done50'
  | 'day60'
  | 'day180'
  | 'notes50'
  | 'notes200'
  | 'active30'
  | 'active365'
  | 'night'
  | 'dawn'
  | 'session2h';

export interface Achievement {
  id: AchievementId;
  /** 已解锁 */
  got: boolean;
  /** 0..1，给进度条 */
  progress: number;
  /** 当前值（天数 / 小时 / 本 / 条……） */
  value: number;
  target: number;
}

export interface RichBookExtra {
  /** 全量估算读字数 */
  words: number;
  /** 全量有效秒数（每本书自己的速度分母） */
  secAll: number;
  /** 范围内容量（翻页 / 滚动次数；老会话没有这个字段） */
  turns: number;
  /** 范围内中断次数 */
  interruptions: number;
  /** 范围内听书秒数 */
  tts: number;
  /** 标注总数（划线 + 书签） */
  notes: number;
  /** 预计读完剩余秒数（0 = 算不出） */
  etaSec: number;
  /** 预计读完日期（毫秒戳，0 = 算不出） */
  etaDate: number;
}

export interface DayBookRow {
  id: string;
  title: string;
  sec: number;
  n: number;
}

export interface RichStats extends FullStats {
  /* ── 字数与速度（范围 / 全量各一套） ── */
  readWords: number;
  totalWords: number;
  /** 有字数的书的本数 / 总本数 */
  wordBooks: number;
  /** 在库总字数（只有带 wordCount 的书） */
  libraryWords: number;
  /** 在库未读字数 = 总字数 − 全量读字数 */
  remainingWords: number;
  todayWords: number;
  weekWords: number;
  monthWords: number;
  yearWords: number;
  /** 范围内速度（字 / 分钟），0 = 没有可算的样本 */
  speed: number;
  /** 全量速度 */
  speedAll: number;
  /** 速度最快的一本（至少 60 秒样本） */
  speedBest: { title: string; wpm: number } | null;
  /** 近 14 天速度趋势（没读的那天 0） */
  speedTrend: { label: string; wpm: number; sec: number }[];

  /* ── 时间维度（范围） ── */
  hours24: number[];
  weekday: number[];
  weekdaySec: number;
  weekendSec: number;
  bestHour24: number;
  bestWeekday: number;
  /** 今年 12 个月（全量） */
  monthly: { key: string; sec: number }[];
  /** 去年 12 个月（全量） */
  monthlyPrev: number[];

  /* ── 坚持与达标（全量） ── */
  streakMax: number;
  gapMax: number;
  goalDays: number;
  goalRate: number;
  goalStreak: number;
  avgActive: number;
  avgCalendar: number;
  spanDays: number;
  checkedDays: number;

  /* ── 书与进度（范围时长 + 全量状态） ── */
  shelves: { name: string; books: number; sec: number; done: number }[];
  formats: { name: string; books: number; sec: number }[];
  buckets: number[];
  eta: { id: string; title: string; percent: number; sec: number; date: number; done: boolean }[];
  stale: { id: string; title: string; days: number; percent: number }[];
  parallel: number;
  doneWords: number;
  longestSession: number;
  /** 范围内会话容量合计（翻页 / 滚动） */
  turnsTotal: number;
  /** 范围内中断合计 */
  interruptionsTotal: number;
  /** 范围内听书秒数 */
  ttsTotal: number;
  modes: { name: string; sec: number }[];
  devices: { name: string; sec: number }[];

  /* ── 笔记与评分（全量） ── */
  hl: number;
  th: number;
  bm: number;
  kb: number;
  noteMonths: { key: string; n: number }[];
  noteTop: { id: string; title: string; n: number }[];
  noteDensity: number;
  ratingAvg: number;
  ratingDist: number[];
  rated: number;

  /* ── 成就与明细 ── */
  achv: Achievement[];
  dayBooks: Record<string, DayBookRow[]>;
  bookExtra: Record<string, RichBookExtra>;

  /* ── 小结素材 ── */
  topBook: { title: string; sec: number } | null;
  topShelf: { name: string; sec: number } | null;
}

export interface RichInput {
  books: ReaderBook[];
  /** `YYYY-MM-DD` → 秒 */
  checkins: Record<string, number>;
  goal: number;
  dailyGoalMinutes: number;
  now: number;
  range: StatsRange;
}

/** 安全取数：手改坏的 JSON 会让字段变成字符串 / null */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bucketOf(percent: number, done: boolean): number {
  if (done || percent >= 1) return 4;
  if (percent < 0.25) return 0;
  if (percent < 0.5) return 1;
  if (percent < 0.75) return 2;
  return 3;
}

/** 月份键：`YYYY-MM` */
function monthKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** 从「按天字数表」里把某个起点之后的字数加起来 */
function sumWordsFrom(wordsByDay: Record<string, number>, from: number): number {
  let n = 0;
  for (const [k, v] of Object.entries(wordsByDay)) {
    if (new Date(`${k}T00:00:00`).getTime() >= from) n += v;
  }
  return n;
}

export function analyzeRich(input: RichInput): RichStats {
  const now = input.now;
  const from = rangeStart(now, input.range);
  const base = analyzeFull({
    books: input.books,
    checkins: input.checkins,
    goal: input.goal,
    dailyGoalMinutes: input.dailyGoalMinutes,
    now,
    range: input.range,
  });
  const dailyGoal = clampDailyGoal(input.dailyGoalMinutes);
  const goalSec = dailyGoal * 60;
  const todayK = dayKey(now);
  const today0 = startOfDay(now);

  /* 按天的字数额：全量算一遍，范围只是从里面切 */
  const wordsByDay: Record<string, number> = {};
  const secByDay: Record<string, number> = {};
  const dayBookMap: Record<string, Map<string, DayBookRow>> = {};

  const hours24 = new Array<number>(24).fill(0);
  /* 赏夜间 / 早起徽章用全量时段，不跟 range 走 */
  const hoursAll = new Array<number>(24).fill(0);
  const weekday = new Array<number>(7).fill(0);
  let weekdaySec = 0;
  let weekendSec = 0;
  let rangeWords = 0;
  let totalWords = 0;
  let rangeSec = 0;
  let turnsTotal = 0;
  let interruptionsTotal = 0;
  let ttsTotal = 0;
  let longestSession = 0;
  const modes = new Map<string, number>();
  const devices = new Map<string, number>();

  let libraryWords = 0;
  let wordBooks = 0;
  let doneWords = 0;
  let hl = 0;
  let th = 0;
  let bm = 0;
  let kb = 0;
  let ratingSum = 0;
  let rated = 0;
  const ratingDist = [0, 0, 0, 0, 0];
  const noteByDay: Record<string, number> = {};
  const noteByBook = new Map<string, { id: string; title: string; n: number }>();
  const bookExtra: Record<string, RichBookExtra> = {};
  const statusById = new Map(base.books.map((b) => [b.id, b.status]));

  const shelves = new Map<string, { name: string; books: number; sec: number; done: number }>();
  const formats = new Map<string, { name: string; books: number; sec: number }>();
  const buckets = [0, 0, 0, 0, 0];
  const eta: RichStats['eta'] = [];
  const stale: RichStats['stale'] = [];

  for (const b of input.books) {
    const meta = b.meta ?? ({} as ReaderBook['meta']);
    const reading = b.reading ?? ({} as ReaderBook['reading']);
    const bstats = reading.stats ?? ({} as ReaderBook['reading']['stats']);
    const notes = b.notes ?? ({} as ReaderBook['notes']);
    const id = String(b.id || '');
    const title = String(meta.title || '');
    const wordCount = Math.max(0, Math.round(num(meta.wordCount)));
    const percent = Math.min(1, Math.max(0, num(reading.position?.percent)));
    const last = num(bstats.lastReadTime);

    if (wordCount > 0) {
      wordBooks += 1;
      libraryWords += wordCount;
    }

    /* 分类归属：`shelf` 是主分类，`shelves[0]` 是同一份的新写法 */
    const shelfName = String(b.shelf || b.shelves?.[0] || '');
    const fmt = String(b.fileRef?.format || '');
    const done = statusById.get(id) === 'done';
    if (done && wordCount > 0) doneWords += wordCount;

    const sh = shelves.get(shelfName) ?? { name: shelfName, books: 0, sec: 0, done: 0 };
    sh.books += 1;
    if (done) sh.done += 1;
    shelves.set(shelfName, sh);

    const fm = formats.get(fmt) ?? { name: fmt, books: 0, sec: 0 };
    fm.books += 1;
    formats.set(fmt, fm);

    buckets[bucketOf(percent, done)] += 1;

    /* 标注：笔画线、想法（带 comment 的划线）、书签、知识盒链接分开数 */
    const bHl = Array.isArray(notes.highlights) ? notes.highlights : [];
    const bBm = Array.isArray(notes.bookmarks) ? notes.bookmarks : [];
    for (const h of bHl) {
      if (String(h.comment || '').trim()) th += 1;
      if (Array.isArray(h.kb)) kb += h.kb.length;
      const t = num(h.createdAt);
      if (t > 0) noteByDay[dayKey(t)] = (noteByDay[dayKey(t)] || 0) + 1;
    }
    for (const x of bBm) {
      const t = num(x.createdAt);
      if (t > 0) noteByDay[dayKey(t)] = (noteByDay[dayKey(t)] || 0) + 1;
    }
    hl += bHl.length;
    bm += bBm.length;
    const bNotes = bHl.length + bBm.length;
    if (bNotes > 0) noteByBook.set(id, { id, title, n: bNotes });

    const rating = Math.round(num(bstats.rating));
    if (rating >= 1 && rating <= 5) {
      rated += 1;
      ratingSum += rating;
      ratingDist[rating - 1] += 1;
    }

    /* 会话：一次遍历同时喂字数 / 时段 / 星期 / 日明细 / 速度趋势 */
    const sessions = Array.isArray(reading.sessions) ? reading.sessions.slice() : [];
    sessions.sort((x, y) => num(x.start) - num(y.start));
    let prevPct = 0;
    let bWords = 0;
    let bSecAll = 0;
    let bRangeSec = 0;
    let bTurns = 0;
    let bInterruptions = 0;
    let bTts = 0;
    let lastEnd = 0;
    for (const s of sessions) {
      const start = num(s.start);
      if (!(start > 0)) continue;
      lastEnd = Math.max(lastEnd, num(s.end) || start);
      const sec = Math.max(0, Math.round(num(s.durationSeconds)));
      const pct = typeof s.percent === 'number' ? Math.min(1, Math.max(0, s.percent)) : null;
      const delta = pct === null ? 0 : Math.max(0, pct - prevPct);
      if (pct !== null) prevPct = Math.max(prevPct, pct);
      const words = wordCount > 0 ? Math.round(delta * wordCount) : 0;

      bSecAll += sec;
      bWords += words;
      totalWords += words;
      longestSession = Math.max(longestSession, sec);
      const hour = Math.min(23, Math.max(0, new Date(start).getHours()));
      hoursAll[hour] += sec;

      const k = dayKey(start);
      wordsByDay[k] = (wordsByDay[k] || 0) + words;
      secByDay[k] = (secByDay[k] || 0) + sec;
      if (sec > 0 || words > 0) {
        const bucket = dayBookMap[k] ?? new Map<string, DayBookRow>();
        const row = bucket.get(id) ?? { id, title, sec: 0, n: 0 };
        row.sec += sec;
        row.n += 1;
        bucket.set(id, row);
        dayBookMap[k] = bucket;
      }

      if (start >= from) {
        bRangeSec += sec;
        rangeSec += sec;
        rangeWords += words;
        hours24[hour] += sec;
        const wd = (new Date(start).getDay() + 6) % 7;
        weekday[wd] += sec;
        if (wd >= 5) weekendSec += sec;
        else weekdaySec += sec;
        const turns = Math.max(0, Math.round(num(s.turns)));
        const inter = Math.max(0, Math.round(num(s.interruptions)));
        const tts = Math.max(0, Math.round(num(s.ttsSeconds)));
        bTurns += turns;
        bInterruptions += inter;
        bTts += tts;
        turnsTotal += turns;
        interruptionsTotal += inter;
        ttsTotal += tts;
        const mode = String(s.mode || '');
        if (mode) modes.set(mode, (modes.get(mode) || 0) + sec);
        const dev = String(s.device || '');
        if (dev) devices.set(dev, (devices.get(dev) || 0) + sec);
      }
    }

    sh.sec += bRangeSec;
    fm.sec += bRangeSec;

    /* 老数据可能没写 lastReadTime：用最后一节会话兜底，别让搁置榜整列空着 */
    const lastAt = last > 0 ? last : lastEnd;

    /* 预计读完：按这本书自己的「每 1% 花多久」外推，样本 < 60 秒不猜 */
    const perPct = bSecAll > 0 && percent > 0 ? bSecAll / (percent * 100) : 0;
    const etaSec = perPct > 0 && bSecAll >= 60 ? Math.max(0, Math.round((1 - percent) * 100 * perPct)) : 0;
    if (etaSec > 0) {
      eta.push({
        id,
        title,
        percent,
        sec: etaSec,
        date: (lastAt > 0 ? lastAt : now) + etaSec * 1000,
        done,
      });
    }

    /* 搁置榜：只认真的打开读过、且有「最后一次」时间的书 */
    if (sessions.length > 0 && lastAt > 0) {
      stale.push({ id, title, days: Math.max(0, (now - lastAt) / DAY), percent });
    }

    bookExtra[id] = {
      words: bWords,
      secAll: bSecAll,
      turns: bTurns,
      interruptions: bInterruptions,
      tts: bTts,
      notes: bNotes,
      etaSec,
      etaDate: etaSec > 0 && lastAt > 0 ? lastAt + etaSec * 1000 : 0,
    };
  }

  /* ── 连续 / 断更 / 达标（全量，吃 base.fullEff） ── */
  const activeKeys = Object.keys(base.fullEff)
    .filter((k) => base.fullEff[k] > 0)
    .sort();
  let streakMax = 0;
  let run = 0;
  let prevDay = 0;
  let gapMax = 0;
  for (const k of activeKeys) {
    const t = new Date(`${k}T00:00:00`).getTime();
    if (!prevDay) run = 1;
    else {
      const gap = Math.round((t - prevDay) / DAY);
      run = gap === 1 ? run + 1 : 1;
      if (gap > 1) gapMax = Math.max(gapMax, gap - 1);
    }
    streakMax = Math.max(streakMax, run);
    prevDay = t;
  }

  let goalDays = 0;
  for (const k of activeKeys) if (base.fullEff[k] >= goalSec) goalDays += 1;

  /* 当前连续达标：从今天（今天没达标就从昨天）往前数 */
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  let cursor = noon.getTime();
  if (!(base.fullEff[dayKey(cursor)] >= goalSec)) cursor -= DAY;
  let goalStreak = 0;
  while (base.fullEff[dayKey(cursor)] >= goalSec) {
    goalStreak += 1;
    cursor -= DAY;
  }

  const firstKey = activeKeys[0];
  const first0 = firstKey ? new Date(`${firstKey}T00:00:00`).getTime() : today0;
  const spanDays = Math.max(1, Math.round((today0 - first0) / DAY) + 1);
  const activeDays = activeKeys.length;
  const checkedDays = Object.keys(base.checkins).filter((k) => num(base.checkins[k]) > 0).length;

  /* ── 月度：今年 12 格 + 去年 12 格（全量） ── */
  const year = new Date(now).getFullYear();
  const monthSum = (y: number, m: number): number => {
    const prefix = `${y}-${pad(m)}`;
    let n = 0;
    for (const [k, v] of Object.entries(base.fullEff)) if (k.startsWith(prefix)) n += v;
    return n;
  };
  const monthly = Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${pad(i + 1)}`, sec: monthSum(year, i + 1) }));
  const monthlyPrev = Array.from({ length: 12 }, (_, i) => monthSum(year - 1, i + 1));

  /* ── 最近 14 天速度趋势（固定窗口，不跟 range 走） ── */
  const speedTrend: RichStats['speedTrend'] = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(today0 - i * DAY);
    const sec = secByDay[k] || 0;
    const words = wordsByDay[k] || 0;
    speedTrend.push({
      label: k.slice(5),
      sec,
      wpm: sec >= 60 && words > 0 ? Math.round(words / (sec / 60)) : 0,
    });
  }

  /* ── 笔记按月（最近 12 个月）+ 每万字密度 ── */
  const noteMonths: RichStats['noteMonths'] = [];
  const cur = new Date(now);
  cur.setDate(1);
  cur.setHours(0, 0, 0, 0);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(cur.getFullYear(), cur.getMonth() - i, 1);
    const key = monthKeyOf(d.getTime());
    let n = 0;
    for (const [day, v] of Object.entries(noteByDay)) if (day.startsWith(key)) n += v;
    noteMonths.push({ key, n });
  }

  const noteTotal = hl + bm;

  /* ── 成就 ── */
  const totalHours = base.fullEffTotal / 3600;
  const peakMin = base.peakSec / 60;
  const mk = (id: AchievementId, value: number, target: number): Achievement => ({
    id,
    got: value >= target,
    progress: target > 0 ? Math.min(1, Math.max(0, value / target)) : 0,
    value: Math.round(value * 10) / 10,
    target,
  });
  const nightSec = hoursAll.slice(0, 5).reduce((x, y) => x + y, 0);
  const dawnSec = hoursAll.slice(5, 8).reduce((x, y) => x + y, 0);
  const achv: Achievement[] = [
    mk('streak7', streakMax, 7),
    mk('streak30', streakMax, 30),
    mk('streak100', streakMax, 100),
    mk('hours10', totalHours, 10),
    mk('hours100', totalHours, 100),
    mk('hours1000', totalHours, 1000),
    mk('done1', base.done, 1),
    mk('done10', base.done, 10),
    mk('done50', base.done, 50),
    mk('day60', peakMin, 60),
    mk('day180', peakMin, 180),
    mk('notes50', noteTotal, 50),
    mk('notes200', noteTotal, 200),
    mk('active30', activeDays, 30),
    mk('active365', activeDays, 365),
    mk('session2h', longestSession / 60, 120),
    mk('night', nightSec, 1),
    mk('dawn', dawnSec, 1),
  ];

  /* ── 日明细：按天、按时长倒序；范围外的不留 ── */
  const dayFrom = input.range === 'all' ? '' : dayKey(from);
  const dayBooks: Record<string, DayBookRow[]> = {};
  for (const [k, m] of Object.entries(dayBookMap)) {
    if (dayFrom && k < dayFrom) continue;
    dayBooks[k] = Array.from(m.values()).sort((x, y) => y.sec - x.sec);
  }

  const speed = rangeSec > 0 ? Math.round(rangeWords / (rangeSec / 60)) : 0;
  const speedAll = base.fullEffTotal > 0 ? Math.round(totalWords / (base.fullEffTotal / 60)) : 0;
  const speedBest = Object.entries(bookExtra)
    .map(([id, extra]) => ({
      title: base.books.find((b) => b.id === id)?.title ?? '',
      wpm: extra.secAll >= 60 && extra.words > 0 ? Math.round(extra.words / (extra.secAll / 60)) : 0,
    }))
    .filter((x) => x.wpm > 0)
    .sort((x, y) => y.wpm - x.wpm)[0] ?? null;

  const shelfRows = Array.from(shelves.values()).sort((x, y) => y.sec - x.sec || y.books - x.books);
  const formatRows = Array.from(formats.values()).sort((x, y) => y.sec - x.sec || y.books - x.books);
  const etaRows = eta.sort((x, y) => x.sec - y.sec);
  const staleRows = stale.sort((x, y) => y.days - x.days).slice(0, 5);
  const parallel = base.books.filter((b) => b.nAll > 0 && b.idleDays !== null && b.idleDays <= 30).length;
  const noteTop = Array.from(noteByBook.values()).sort((x, y) => y.n - x.n).slice(0, 5);
  const topRow = [...base.books].sort((x, y) => y.eff - x.eff)[0];

  return {
    ...base,
    readWords: rangeWords,
    totalWords,
    wordBooks,
    libraryWords,
    remainingWords: Math.max(0, libraryWords - totalWords),
    todayWords: wordsByDay[todayK] || 0,
    weekWords: sumWordsFrom(wordsByDay, today0 - 6 * DAY),
    monthWords: sumWordsFrom(wordsByDay, today0 - 29 * DAY),
    yearWords: sumWordsFrom(wordsByDay, today0 - 364 * DAY),
    speed,
    speedAll,
    speedBest,
    speedTrend,
    hours24,
    weekday,
    weekdaySec,
    weekendSec,
    bestHour24: hours24.indexOf(Math.max(...hours24)),
    bestWeekday: weekday.indexOf(Math.max(...weekday)),
    monthly,
    monthlyPrev,
    streakMax,
    gapMax,
    goalDays,
    goalRate: activeDays > 0 ? goalDays / activeDays : 0,
    goalStreak,
    avgActive: activeDays > 0 ? base.fullEffTotal / activeDays : 0,
    avgCalendar: base.fullEffTotal / spanDays,
    spanDays,
    checkedDays,
    shelves: shelfRows,
    formats: formatRows,
    buckets,
    eta: etaRows,
    stale: staleRows,
    parallel,
    doneWords,
    longestSession,
    turnsTotal,
    interruptionsTotal,
    ttsTotal,
    modes: Array.from(modes.entries()).map(([name, sec]) => ({ name, sec })).sort((x, y) => y.sec - x.sec),
    devices: Array.from(devices.entries()).map(([name, sec]) => ({ name, sec })).sort((x, y) => y.sec - x.sec),
    hl,
    th,
    bm,
    kb,
    noteMonths,
    noteTop,
    noteDensity: totalWords > 0 ? (noteTotal + kb) / totalWords * 10_000 : 0,
    ratingAvg: rated > 0 ? ratingSum / rated : 0,
    ratingDist,
    rated,
    achv,
    dayBooks,
    bookExtra,
    topBook: topRow && topRow.eff > 0 ? { title: topRow.title, sec: topRow.eff } : null,
    topShelf: shelfRows[0]?.sec > 0 ? { name: shelfRows[0].name, sec: shelfRows[0].sec } : null,
  };
}

/* ============================================================
 * bz-reader · 统计页（shell/render/stats.ts）
 *
 * 一比一复刻 prototype/stats/index.html 的骨架，2026-11-19 起在其上加了
 * 六个子页签（概览 / 时间 / 书 / 笔记 / 成就 / 数据）与一批新卡片。
 *
 * 三条出口同源：页面、复制文字报告、导出图片海报，全部走 `model()` 这一份
 * RichStats。以前页面与报告各算一次，用户截图一对就发现对不上。
 *
 * 计算在 data/stats-rich.ts，交互状态在 shell/stats-ui.ts。
 * 这里只做「模型 → HTML」，不重算任何数字，也不写业务数据。
 * ============================================================ */
import { t, type MsgKey, type MsgParams } from '../../i18n';
import type { ReaderBook } from '../../data/schema';
import type { StatsSummary } from '../../data/stats';
import { dayKey } from '../../data/stats';
import {
  clock,
  delta,
  dayLabel,
  HOUR_KEYS,
  LEN_KEYS,
  pct,
  rangeStart,
  shortTime,
  startOfDay,
  statsAuditDays,
  statsHeatLevel,
  statsQuality,
  statsRecalcRows,
  statsReportText,
  statsSeries,
  type BookStatus,
} from '../../data/stats-full';
import {
  analyzeRich,
  type AchievementId,
  type RichStats,
} from '../../data/stats-rich';
import { esc } from './html';
import { fmtWan } from '../stats-format';
import { segHtml } from './seg';
import {
  defaultStatsUi,
  STATS_RANGES,
  STATS_TABS,
  type StatsRange,
  type StatsTab,
  type StatsUiState,
} from '../stats-ui';

const MS_DAY = 86_400_000;
const HEAT_DAYS = 140;
const DASH = '—';

/**
 * 计算层不依赖 i18n，报告/体检要翻译时从这里递一个 tr 进去。
 *
 * 参数类型就是 `MsgKey`：以前写成 `key: string` 再 `as MsgKey`，新键打错
 * 一个字照样编译通过，界面上直接显示成键名原文（2026-11-09 发版复核）。
 */
const T = (key: MsgKey, params?: MsgParams): string => t(key, params);

export interface StatsView {
  /** 兼容旧调用：页面现在直接从 books 重算，这个汇总只作 checkins 兜底 */
  stats: StatsSummary;
  books: ReaderBook[];
  goal: number;
  /** 每日打卡记录（`YYYY-MM-DD` → 秒） */
  checkins?: Record<string, number>;
  dailyGoalMinutes?: number;
  now?: number;
}

interface SegOpt { v: string; k: string }

/* 统计页的「几选一」与设置页同一个结构（shell/render/seg.ts），
   只是外层沿用原型那套 `.seg`（行内 span）——样式各用各的，生成逻辑只有一份。 */
function seg(act: string, cur: string, opts: SegOpt[]): string {
  return segHtml(
    opts.map((o) => ({ v: esc(o.v), k: esc(o.k) })),
    cur,
    { act, cls: 'seg', tag: 'span' },
  );
}

interface BarRow { k: string; v: number; s: string }

function hbars(rows: BarRow[]): string {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return '<div class="hbars">' + rows.map((r) =>
    '<div class="hb"><span class="lab">' + esc(r.k) + '</span>' +
    '<span class="track"><i class="fill" style="width:' + Math.round((r.v / max) * 100) + '%"></i></span>' +
    '<span class="val">' + esc(r.s) + '</span></div>',
  ).join('') + '</div>';
}

function section(titleKey: MsgKey, note = ''): string {
  return `<div class="sect"><h3>${esc(T(titleKey))}</h3><span class="ln"></span>` +
    (note ? `<span class="note">${esc(note)}</span>` : '') + '</div>';
}

function signedClock(diff: number): string {
  return (diff > 0 ? '+' : diff < 0 ? '−' : '') + clock(Math.abs(diff));
}

/** 全量算一次；应用预演时用内存里的打卡覆盖再算一次，store 不动 */
function model(v: StatsView, ui: StatsUiState): RichStats {
  const input = {
    books: v.books,
    checkins: v.checkins ?? v.stats?.days ?? {},
    goal: v.goal,
    dailyGoalMinutes: v.dailyGoalMinutes ?? 20,
    now: v.now ?? Date.now(),
    range: ui.range,
  };
  let a = analyzeRich(input);
  if (ui.recalced) {
    const override: Record<string, number> = {};
    for (const r of statsRecalcRows(a)) if (r.next) override[r.day] = r.next;
    a = analyzeRich({ ...input, checkins: override });
  }
  return a;
}

/* ── 数字格式：页面 / 报告 / 海报共用 stats-format 那一份 ── */
const wan = fmtWan;

function dateOf(ms: number): string {
  if (!ms) return DASH;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── 范围：清单同样在 stats-ui，这里只配文案键 ── */
const RANGE_KEYS: Record<StatsRange, MsgKey> = {
  all: 'stats.f.range.all',
  today: 'stats.f.range.today',
  week: 'stats.f.range.week',
  month: 'stats.f.range.month',
  year: 'stats.f.range.year',
};

/* ── 页签：清单在 stats-ui（唯一来源），这里只配文案键 ── */
const TAB_KEYS: Record<StatsTab, MsgKey> = {
  overview: 'stats.f.tab.overview',
  time: 'stats.f.tab.time',
  books: 'stats.f.tab.books',
  notes: 'stats.f.tab.notes',
  achv: 'stats.f.tab.achv',
  data: 'stats.f.tab.data',
};
const TABS: { v: StatsTab; k: MsgKey }[] = STATS_TABS.map((v) => ({ v, k: TAB_KEYS[v] }));

function tabBar(ui: StatsUiState): string {
  return '<div class="tabnav">' + TABS.map((x) =>
    `<button class="${ui.tab === x.v ? 'on' : ''}" data-act="statstab" data-v="${x.v}">${esc(T(x.k))}</button>`,
  ).join('') + '</div>';
}

function pane(tab: StatsTab, ui: StatsUiState, body: string): string {
  return `<div class="tabpane${ui.tab === tab ? '' : ' off'}" data-pane="${tab}">${body}</div>`;
}

/* ── 概览 ── */
function insightsHtml(a: RichStats): string {
  const rows = [
    { k: T('stats.f.ins.peak'), v: T('stats.f.ins.peakValue', { day: dayLabel(a.peakKey), sec: clock(a.peakSec) }) },
    { k: T('stats.f.ins.hour'), v: T('stats.f.ins.hourValue', { hour: T(HOUR_KEYS[a.bestHour]), sec: clock(a.bestHourSec) }) },
    { k: T('stats.f.ins.idle'), v: T('stats.f.ins.idleValue', { n: a.idleCount }) },
    { k: T('stats.f.ins.streak'), v: T('stats.f.ins.streakValue', { n: a.streak }) },
  ];
  return '<div class="insights">' + rows.map((x) =>
    `<div class="ins"><span>${esc(x.k)}</span><b>${esc(x.v)}</b></div>`).join('') + '</div>';
}

function kpiHtml(a: RichStats): string {
  const read = a.books.filter((b) => b.eff > 0).length;
  const cells = [
    { v: clock(a.total), k: T('stats.f.kpi.total') },
    { v: clock(a.today), k: T('stats.f.kpi.today') },
    { v: T('stats.f.daysCount', { n: a.activeDays }), k: T('stats.f.kpi.active') },
    { v: T('stats.f.daysCount', { n: a.streak }), k: T('stats.f.kpi.streak') },
    { v: T('stats.f.segments', { n: a.sessionCount }), k: T('stats.f.kpi.sessions', { avg: clock(a.sessionCount ? a.total / a.sessionCount : 0) }) },
    { v: `${read}/${a.books.length}`, k: T('stats.f.kpi.read') },
  ];
  return '<div class="kpis">' + cells.map((x) =>
    `<div class="kpi"><b>${esc(x.v)}</b><span>${esc(x.k)}</span></div>`).join('') + '</div>';
}

/** 五格时间账本：今天 / 本周 / 本月 / 今年 / 累计 */
function ledgerHtml(a: RichStats): string {
  const yearSec = a.monthly.reduce((x, m) => x + m.sec, 0);
  const cells: Array<{ k: MsgKey; v: string }> = [
    { k: 'stats.f.ledger.today', v: clock(a.today) },
    { k: 'stats.f.ledger.week', v: clock(a.weekCur) },
    { k: 'stats.f.ledger.month', v: clock(a.monthCur) },
    { k: 'stats.f.ledger.year', v: clock(yearSec) },
    { k: 'stats.f.ledger.all', v: clock(a.fullEffTotal) },
  ];
  return '<div class="ledger">' + cells.map((x) =>
    `<div class="lg"><span>${esc(T(x.k))}</span><b>${esc(x.v)}</b></div>`).join('') + '</div>';
}

/** 阅读量卡：累计读字 / 在库未读 / 今日 / 在库总字数 */
function wordsHtml(a: RichStats): string {
  const cells = [
    { k: T('stats.f.words.read'), v: wan(a.totalWords) },
    { k: T('stats.f.words.left'), v: wan(a.remainingWords) },
    { k: T('stats.f.words.today'), v: wan(a.todayWords) },
    { k: T('stats.f.words.library'), v: wan(a.libraryWords) },
  ];
  return '<div class="mini4">' + cells.map((x) =>
    `<div class="m4"><b>${esc(x.v)}</b><span>${esc(x.k)}</span></div>`).join('') + '</div>' +
    `<div class="tip">${esc(T('stats.f.words.coverage', { n: a.wordBooks }))} · ${esc(T('stats.f.words.note'))}</div>`;
}

/** 近 14 天速度：一排细柱，没读的那天留空 */
function speedSparkHtml(a: RichStats): string {
  const max = Math.max(1, ...a.speedTrend.map((x) => x.wpm));
  const bars = a.speedTrend.map((x) =>
    `<i class="${x.wpm ? '' : 'off'}" style="height:${Math.round((x.wpm / max) * 100)}%">` +
    `<span class="bzs-sr-only">${esc(x.label)} ${esc(String(x.wpm))}</span></i>`).join('');
  return `<div class="spark">${bars}</div>` +
    `<div class="spark-k"><span>${esc(a.speedTrend[0]?.label ?? '')}</span><span>${esc(T('stats.f.speed.trend'))}</span>` +
    `<span>${esc(a.speedTrend[a.speedTrend.length - 1]?.label ?? '')}</span></div>`;
}

function speedHtml(a: RichStats): string {
  const rows = [
    { k: T('stats.f.speed.now'), v: a.speed ? String(a.speed) : DASH },
    { k: T('stats.f.speed.all'), v: a.speedAll ? String(a.speedAll) : DASH },
    { k: T('stats.f.speed.best'), v: a.speedBest ? `${a.speedBest.title} · ${a.speedBest.wpm}` : DASH },
  ];
  return '<div class="rows">' + rows.map((x) =>
    `<div class="r"><span>${esc(x.k)}</span><b>${esc(x.v)}</b></div>`).join('') + '</div>' +
    `<div class="tip">${esc(T('stats.f.speed.unit'))}</div>` + speedSparkHtml(a);
}

/** 坚持卡：最长连续、断更、达标率、连续达标、日均 */
function stickHtml(a: RichStats): string {
  const rows = [
    { k: T('stats.f.stick.streakMax'), v: T('stats.f.daysCount', { n: a.streakMax }) },
    { k: T('stats.f.stick.gapMax'), v: T('stats.f.daysCount', { n: a.gapMax }) },
    { k: T('stats.f.stick.goalDays'), v: `${a.goalDays} · ${Math.round(a.goalRate * 100)}%` },
    { k: T('stats.f.stick.goalStreak'), v: T('stats.f.daysCount', { n: a.goalStreak }) },
    { k: T('stats.f.stick.avgActive'), v: clock(a.avgActive) },
    { k: T('stats.f.stick.avgCalendar'), v: clock(a.avgCalendar) },
  ];
  return '<div class="rows">' + rows.map((x) =>
    `<div class="r"><span>${esc(x.k)}</span><b>${esc(x.v)}</b></div>`).join('') + '</div>' +
    `<div class="tip">${esc(T('stats.f.stick.span', { n: a.spanDays }))}</div>`;
}

/** 本周小结：一句人话，能直接粘进日记 */
function summaryHtml(a: RichStats): string {
  if (!a.weekCur) return `<div class="empty">${esc(T('stats.f.summary.empty'))}</div>`;
  const top = a.topBook;
  return `<div class="quote">${esc(T('stats.f.summary.line', {
    week: clock(a.weekCur),
    lastWeek: a.weekPrev ? clock(a.weekPrev) : DASH,
    book: top ? top.title : DASH,
    sec: top ? clock(top.sec) : DASH,
  }))}</div>` +
    `<div class="tip">${esc(T('stats.f.summary.speed', { speed: a.speed || 0, days: a.activeDays }))}</div>`;
}

/* ── 时间 ── */
function chartHtml(a: RichStats): string {
  const ser = statsSeries(a);
  /* 左轴日期：全量从首次阅读算，其余从范围起点算（以前一律写今天，左右两个同一天） */
  const leftKey = a.range === 'all' ? dayKey(a.first) : dayKey(rangeStart(a.now, a.range));
  const goalSec = a.dailyGoal * 60;
  const chartMax = Math.max(goalSec, ...ser.items.map((i) => i.sec), 1);
  const goalTop = 20 + Math.round((1 - goalSec / chartMax) * 140);
  const bars = ser.items.map((i) =>
    `<div class="col"><span class="bzs-sr-only">${esc(i.label)} · ${esc(clock(i.sec))}</span><span class="v">${i.sec ? clock(i.sec) : DASH}</span>` +
    `<span class="bar" style="height:${Math.round((i.sec / chartMax) * 100)}%"></span>` +
    `<span class="k">${esc(i.label)}</span></div>`,
  ).join('');
  return `<div class="chart"><div class="goal-line" style="top:${goalTop}px"><span>${esc(T('stats.f.chart.goal', { n: a.dailyGoal }))}</span></div>${bars}</div>` +
    `<div class="axis"><span>${leftKey}</span><span>${a.todayK}</span></div>`;
}

function rhythmHtml(a: RichStats): string {
  const ranges = ['00–06', '06–12', '12–18', '18–24'];
  const hourRows = ranges.map((r, i) => ({
    k: `${T(HOUR_KEYS[i])} ${r}`,
    v: a.hour[i],
    s: a.hour[i] ? clock(a.hour[i]) : DASH,
  }));
  const lenRows = [0, 1, 2, 3].map((i) => ({
    k: T(LEN_KEYS[i]),
    v: a.len[i],
    s: T('stats.f.lenValue', { n: a.len[i] }),
  }));
  return `<div class="sub-h">${esc(T('stats.f.rhythm.period'))}</div>${hbars(hourRows)}` +
    `<div class="sub-h">${esc(T('stats.f.rhythm.length'))}</div>${hbars(lenRows)}` +
    (a.turnsTotal ? `<div class="tip">${esc(T('stats.f.turns', { n: a.turnsTotal }))}` +
      (a.interruptionsTotal ? ` · ${esc(T('stats.f.interruptions', { n: a.interruptionsTotal }))}` : '') + '</div>' : '');
}

/** 24 小时：紧凑柱列，每 3 小时一个刻度 */
function hours24Html(a: RichStats): string {
  const max = Math.max(1, ...a.hours24);
  const cols = a.hours24.map((sec, h) =>
    `<div class="hc"><i style="height:${Math.round((sec / max) * 100)}%" class="${sec ? '' : 'off'}">` +
    `<span class="bzs-sr-only">${h}:00 ${esc(clock(sec))}</span></i>` +
    `<span class="hl">${h % 3 === 0 ? h : ''}</span></div>`).join('');
  const peak = a.hours24[a.bestHour24];
  return `<div class="h24">${cols}</div>` +
    `<div class="legend"><span style="margin-left:auto">${peak ? esc(T('stats.f.hour.best', { hour: a.bestHour24 })) : DASH}</span></div>`;
}

/** 星期文案键：顺序固定周一到周日（与 RichStats.weekday 的下标一致） */
const WD_KEYS: readonly MsgKey[] = [
  'stats.f.wd.0', 'stats.f.wd.1', 'stats.f.wd.2', 'stats.f.wd.3',
  'stats.f.wd.4', 'stats.f.wd.5', 'stats.f.wd.6',
];

function weekdayHtml(a: RichStats): string {
  const rows = a.weekday.map((sec, i) => ({
    k: T(WD_KEYS[i]),
    v: sec,
    s: sec ? clock(sec) : DASH,
  }));
  return hbars(rows) +
    `<div class="legend"><span style="margin-left:auto">${esc(T('stats.f.weekday.best', { day: T(WD_KEYS[a.bestWeekday]) }))}</span></div>` +
    `<div class="legend"><span>${esc(T('stats.f.split.weekday'))} ${esc(clock(a.weekdaySec))}</span>` +
    `<span style="margin-left:auto">${esc(T('stats.f.split.weekend'))} ${esc(clock(a.weekendSec))}</span></div>`;
}

function monthlyHtml(a: RichStats): string {
  const max = Math.max(1, ...a.monthly.map((m) => m.sec));
  const prevTotal = a.monthlyPrev.reduce((x, y) => x + y, 0);
  const bars = a.monthly.map((m, i) =>
    `<div class="col"><span class="bzs-sr-only">${m.key} ${esc(clock(m.sec))}</span>` +
    `<span class="v">${m.sec ? clock(m.sec) : ''}</span>` +
    `<span class="bar" style="height:${Math.round((m.sec / max) * 100)}%"></span>` +
    `<span class="k">${i + 1}</span></div>`).join('');
  return `<div class="chart months">${bars}</div>` +
    `<div class="legend"><span>${esc(T('stats.f.month.thisYear'))} ${esc(clock(a.monthly.reduce((x, m) => x + m.sec, 0)))}</span>` +
    `<span style="margin-left:auto">${esc(T('stats.f.month.lastYear'))} ${esc(prevTotal ? clock(prevTotal) : DASH)}</span></div>`;
}

function heatHtml(a: RichStats, ui: StatsUiState): string {
  const base = startOfDay(a.now);
  const cells: string[] = [];
  for (let i = HEAT_DAYS - 1; i >= 0; i--) {
    const k = dayKey(base - i * MS_DAY);
    const sec = a.fullEff[k] || 0;
    const on = ui.day === k ? ' on' : '';
    cells.push(`<i class="l${statsHeatLevel(sec)}${on}" data-act="statsday" data-v="${esc(k)}">` +
      `<span class="bzs-sr-only">${esc(k)} · ${esc(clock(sec))}</span></i>`);
  }
  const active = Object.values(a.fullEff).filter((v) => v > 0).length;
  const legend = ['var(--surface-2)', 'var(--copper-soft)',
    'color-mix(in srgb,var(--copper) 32%,transparent)',
    'color-mix(in srgb,var(--copper) 58%,transparent)', 'var(--copper)']
    .map((bg) => `<i style="background:${bg}"></i>`).join('');
  return `<div class="heat">${cells.join('')}</div>` +
    `<div class="legend"><span>${esc(T('stats.f.heat.less'))}</span>${legend}<span>${esc(T('stats.f.heat.more'))}</span>` +
    `<span style="margin-left:auto">${esc(T('stats.f.heat.active', { n: active }))}</span></div>` +
    dayDetailHtml(a, ui);
}

/** 点热力格展开：当天读了哪几本、各多久 */
function dayDetailHtml(a: RichStats, ui: StatsUiState): string {
  if (!ui.day) return '';
  const rows = a.dayBooks[ui.day] ?? [];
  const total = rows.reduce((x, r) => x + r.sec, 0);
  const head = `<div class="ph2"><b>${esc(ui.day)}</b><span class="note">${esc(T('stats.f.day.total'))} ${esc(clock(total))}</span>` +
    '<span class="spacer"></span>' +
    `<button class="btn" data-act="statsday" data-v="${esc(ui.day)}">${esc(T('stats.f.day.close'))}</button></div>`;
  if (!rows.length) return `<div class="daybox">${head}<div class="empty">${esc(T('stats.f.day.empty'))}</div></div>`;
  const body = rows.map((r) =>
    `<div class="hb"><span class="lab">${esc(r.title)}</span>` +
    `<span class="track"><i class="fill" style="width:${Math.round((r.sec / Math.max(1, total)) * 100)}%"></i></span>` +
    `<span class="val">${esc(clock(r.sec))}</span></div>`).join('');
  return `<div class="daybox">${head}<div class="hbars">${body}</div></div>`;
}

/* ── 书 ── */
function goalHtml(a: RichStats): string {
  const C = 2 * Math.PI * 52;
  const gp = Math.min(100, Math.round(a.done / Math.max(1, a.goal) * 100));
  const fastest = [...a.books].sort((x, y) => y.percent - x.percent)[0];
  return '<div class="goal-wrap"><svg width="126" height="126" viewBox="0 0 130 130">' +
    '<circle cx="65" cy="65" r="52" fill="none" stroke="var(--line)" stroke-width="8"/>' +
    `<circle cx="65" cy="65" r="52" fill="none" stroke="var(--copper)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - gp / 100)}" transform="rotate(-90 65 65)"/>` +
    `<text x="65" y="62" text-anchor="middle" fill="var(--copper)" font-family="Georgia,serif" font-size="24">${gp}%</text>` +
    `<text x="65" y="84" text-anchor="middle" fill="var(--t3)" font-size="10">${esc(T('stats.f.goal.caption'))}</text></svg>` +
    `<div class="goal-txt"><div class="row"><b>${a.done} / ${a.goal}</b><span>${esc(T('stats.f.unit.book'))}</span></div>` +
    `<div class="row"><b>${pct(fastest ? fastest.percent : 0)}</b><span>${esc(T('stats.f.goal.top'))}</span></div>` +
    `<span class="mini ell">${esc(fastest ? fastest.title : DASH)}</span>` +
    `<span class="mini">${esc(shortTime(a.now))}</span></div></div>`;
}

function rankHtml(a: RichStats): string {
  const ranked = a.books.filter((b) => b.eff > 0).sort((x, y) => y.eff - x.eff);
  if (!ranked.length) return `<div class="empty">${DASH}</div>`;
  return hbars(ranked.map((b) => ({
    k: b.title,
    v: b.eff,
    s: T('stats.f.invest.value', { sec: clock(b.eff), n: a.total ? Math.round(b.eff / a.total * 100) : 0 }),
  })));
}

function shelfHtml(a: RichStats): string {
  if (!a.shelves.length) return `<div class="empty">${DASH}</div>`;
  return hbars(a.shelves.map((s) => ({
    k: s.name || T('stats.f.shelf.uncat'),
    v: s.sec,
    /* 只有真有读完的才提「读完 x 本」，否则每行都挂个「读完 0 本」很吵 */
    s: `${clock(s.sec)} · ${s.done > 0
      ? T('stats.f.shelf.row', { books: s.books, done: s.done })
      : T('stats.f.booksCount', { n: s.books })}`,
  })));
}

function formatHtml(a: RichStats): string {
  if (!a.formats.length) return `<div class="empty">${DASH}</div>`;
  return hbars(a.formats.map((f) => ({
    k: (f.name || DASH).toUpperCase(),
    v: f.sec,
    s: `${clock(f.sec)} · ${T('stats.f.booksCount', { n: f.books })}`,
  })));
}

const BUCKET_KEYS: readonly MsgKey[] = [
  'stats.f.bucket.0', 'stats.f.bucket.1', 'stats.f.bucket.2', 'stats.f.bucket.3', 'stats.f.bucket.4',
];

function bucketHtml(a: RichStats): string {
  const rows = a.buckets.map((n, i) => ({
    k: T(BUCKET_KEYS[i]),
    v: n,
    s: T('stats.f.booksCount', { n }),
  }));
  return hbars(rows) +
    `<div class="legend"><span>${esc(T('stats.f.parallel', { n: a.parallel }))}</span>` +
    `<span style="margin-left:auto">${esc(T('stats.f.done.words', { n: Math.round(a.doneWords / 10_000) }))}</span></div>`;
}

function etaHtml(a: RichStats): string {
  const rows = a.eta.filter((x) => !x.done).slice(0, 6);
  if (!rows.length) return `<div class="empty">${esc(T('stats.f.eta.none'))}</div>`;
  /* 书名一行、预计一行：挤在同一行时书名会被「还需 · 约」压成两个字 */
  return '<div class="etalist">' + rows.map((x) =>
    `<div class="et"><span class="t">${esc(x.title)}</span>` +
    `<span class="m">${esc(T('stats.f.eta.row', { sec: clock(x.sec), date: dateOf(x.date) }))}</span></div>`).join('') + '</div>';
}

function staleHtml(a: RichStats): string {
  /* 三天以内还在「正常在读」，不该进「久未打开」——否则今天刚读的书也上榜 */
  const rows = a.stale.filter((x) => x.days >= 3).slice(0, 5);
  if (!rows.length) return `<div class="empty">${DASH}</div>`;
  return hbars(rows.map((x) => ({
    k: x.title,
    v: Math.max(1, x.days),
    s: T('stats.f.stale.days', { n: Math.round(x.days) }),
  })));
}

const STATUS_KEY: Record<BookStatus, MsgKey> = {
  done: 'stats.f.status.done',
  longIdle: 'stats.f.status.longIdle',
  idle: 'stats.f.status.idle',
  reading: 'stats.f.status.reading',
  posOnly: 'stats.f.status.posOnly',
  unstarted: 'stats.f.status.unstarted',
};

function tableHtml(a: RichStats): string {
  const rows = [...a.books].sort((x, y) => y.eff - x.eff || y.percent - x.percent).map((b) => {
    const cls = b.status === 'reading' || b.status === 'done' ? 'on'
      : b.status === 'idle' || b.status === 'longIdle' || b.status === 'posOnly' ? 'warn' : '';
    const extra = a.bookExtra[b.id];
    return '<tr><td class="name">' + esc(b.title) +
      `<small>${esc(b.author || DASH)} · ${esc(shortTime(b.last))}</small></td>` +
      `<td><span class="pbar"><i style="width:${Math.min(100, b.percent * 100).toFixed(1)}%"></i></span>${pct(b.percent)}</td>` +
      `<td class="num">${b.eff ? clock(b.eff) : DASH}</td>` +
      `<td class="num">${b.eff && a.total ? Math.round(b.eff / a.total * 100) + '%' : DASH}</td>` +
      `<td class="num">${b.perPct ? clock(b.perPct) : DASH}</td>` +
      `<td class="num">${b.nAll && b.idleDays !== null ? b.idleDays.toFixed(1) + ' ' + esc(T('stats.f.unit.day')) : DASH}</td>` +
      `<td class="num">${b.finishDays !== null ? b.finishDays.toFixed(1) + ' ' + esc(T('stats.f.unit.day')) : DASH}</td>` +
      `<td class="num">${extra && extra.words ? wan(extra.words) : DASH}</td>` +
      `<td class="num">${extra && extra.etaSec ? clock(extra.etaSec) : DASH}</td>` +
      `<td><span class="tag ${cls}">${esc(T(STATUS_KEY[b.status]))}</span></td></tr>`;
  }).join('');
  const th = (key: MsgKey, right = false) => `<th${right ? ' style="text-align:right"' : ''}>${esc(T(key))}</th>`;
  return '<div class="scroll"><table class="books"><thead><tr>' + th('stats.f.th.book') + th('stats.f.th.position') +
    th('stats.f.th.eff', true) + th('stats.f.th.share', true) + th('stats.f.th.perPct', true) +
    th('stats.f.th.idle', true) + th('stats.f.th.finish', true) + th('stats.f.th.words', true) +
    th('stats.f.th.eta', true) + th('stats.f.th.status') +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

/* ── 笔记 ── */
function noteCountHtml(a: RichStats): string {
  const cells = [
    { k: T('stats.f.note.hl'), v: String(a.hl) },
    { k: T('stats.f.note.th'), v: String(a.th) },
    { k: T('stats.f.note.bm'), v: String(a.bm) },
    { k: T('stats.f.note.kb'), v: String(a.kb) },
  ];
  return '<div class="mini4">' + cells.map((x) =>
    `<div class="m4"><b>${esc(x.v)}</b><span>${esc(x.k)}</span></div>`).join('') + '</div>' +
    `<div class="tip">${esc(T('stats.f.note.density', { n: (Math.round(a.noteDensity * 10) / 10).toFixed(1) }))}</div>`;
}

function noteMonthsHtml(a: RichStats): string {
  const max = Math.max(1, ...a.noteMonths.map((m) => m.n));
  const bars = a.noteMonths.map((m) =>
    `<div class="col"><span class="bzs-sr-only">${m.key} ${m.n}</span>` +
    `<span class="v">${m.n || ''}</span>` +
    `<span class="bar" style="height:${Math.round((m.n / max) * 100)}%"></span>` +
    `<span class="k">${m.key.slice(5)}</span></div>`).join('');
  return `<div class="chart months">${bars}</div>`;
}

function noteTopHtml(a: RichStats): string {
  if (!a.noteTop.length) return `<div class="empty">${esc(T('stats.f.note.none'))}</div>`;
  return hbars(a.noteTop.map((x) => ({
    k: x.title,
    v: x.n,
    s: T('stats.f.note.count', { n: x.n }),
  })));
}

function ratingHtml(a: RichStats): string {
  if (!a.rated) return `<div class="empty">${esc(T('stats.f.rating.none'))}</div>`;
  const rows = [5, 4, 3, 2, 1].map((star) => ({
    k: '★★★★★'.slice(0, star),
    v: a.ratingDist[star - 1],
    s: T('stats.f.booksCount', { n: a.ratingDist[star - 1] }),
  }));
  return hbars(rows) +
    `<div class="legend"><span>${esc(T('stats.f.rating.avg', { n: (Math.round(a.ratingAvg * 10) / 10).toFixed(1) }))}</span>` +
    `<span style="margin-left:auto">${esc(T('stats.f.rating.rated', { n: a.rated }))}</span></div>`;
}

/* ── 成就 ── */
/** 徽章 id → 文案键（逐个列出，打错字编译期就红） */
const ACHV_KEY: Record<AchievementId, MsgKey> = {
  streak7: 'stats.f.achv.streak7',
  streak30: 'stats.f.achv.streak30',
  streak100: 'stats.f.achv.streak100',
  hours10: 'stats.f.achv.hours10',
  hours100: 'stats.f.achv.hours100',
  hours1000: 'stats.f.achv.hours1000',
  done1: 'stats.f.achv.done1',
  done10: 'stats.f.achv.done10',
  done50: 'stats.f.achv.done50',
  day60: 'stats.f.achv.day60',
  day180: 'stats.f.achv.day180',
  notes50: 'stats.f.achv.notes50',
  notes200: 'stats.f.achv.notes200',
  active30: 'stats.f.achv.active30',
  active365: 'stats.f.achv.active365',
  session2h: 'stats.f.achv.session2h',
  night: 'stats.f.achv.night',
  dawn: 'stats.f.achv.dawn',
};

function achvHtml(a: RichStats): string {
  const got = a.achv.filter((x) => x.got).length;
  const cards = a.achv.map((x) => {
    const ratio = Math.round(x.progress * 100);
    return `<div class="bdg${x.got ? ' on' : ''}">` +
      `<i class="seal"></i><b>${esc(T(ACHV_KEY[x.id]))}</b>` +
      `<span class="pv">${esc(T('stats.f.achv.progress', { value: x.value, target: x.target }))}</span>` +
      `<span class="ptrack"><i style="width:${ratio}%"></i></span></div>`;
  }).join('');
  return `<div class="tip">${esc(T('stats.f.achv.got', { n: got, total: a.achv.length }))}</div>` +
    `<div class="badges">${cards}</div>`;
}

/* ── 数据 ── */
function auditHtml(a: RichStats, ui: StatsUiState): string {
  const days = statsAuditDays(a);
  const hi = ui.audit === 'checkin' ? 'ck' : 'wall';
  const rows = days.map((k) => {
    const e = a.fullEff[k] || 0;
    const w = a.fullWall[k] || 0;
    const c = Number(a.checkins[k]) || 0;
    const diff = hi === 'ck' ? c - e : w - e;
    return `<tr><td>${esc(k)}</td><td class="num">${clock(e)}</td>` +
      `<td class="num${hi === 'wall' ? ' hi' : ''}">${clock(w)}</td>` +
      `<td class="num${hi === 'ck' ? ' hi' : ''}">${c ? clock(c) : DASH}</td>` +
      `<td class="num">${signedClock(diff)}</td></tr>`;
  }).join('');
  const table = '<div class="scroll"><table class="audit"><thead><tr>' +
    `<th>${esc(T('stats.f.th.date'))}</th><th style="text-align:right">${esc(T('stats.f.th.sessionEff'))}</th>` +
    `<th style="text-align:right">${esc(T('stats.f.audit.wall'))}</th><th style="text-align:right">${esc(T('stats.f.audit.checkin'))}</th>` +
    `<th style="text-align:right">${esc(T('stats.f.th.diff'))}</th></tr></thead><tbody>${rows}</tbody>` +
    `<tfoot><tr><td>${esc(T('stats.f.total'))}</td><td class="num">${clock(a.fullEffTotal)}</td>` +
    `<td class="num">${clock(a.fullWallTotal)}</td><td class="num">${clock(a.ckTotal)}</td>` +
    `<td class="num">${clock(Math.abs(hi === 'ck' ? a.ckTotal - a.fullEffTotal : a.fullWallTotal - a.fullEffTotal))}</td>` +
    '</tr></tfoot></table></div>';

  const controls = seg('statsaudit', ui.audit, [
    { v: 'wall', k: T('stats.f.audit.wall') },
    { v: 'checkin', k: T('stats.f.audit.checkin') },
  ]);
  /* 互斥：预演中只给应用/取消，已重算只给还原，其余才给重算入口 */
  let action = '';
  if (ui.recalced) action = `<button class="btn" data-act="statsrestore">${esc(T('stats.f.restore'))}</button>`;
  else if (!ui.preview) action = `<button class="btn pri" data-act="statsrecalc">${esc(T('stats.f.recalc'))}</button>`;

  let preview = '';
  if (ui.preview) {
    const prows = statsRecalcRows(a).map((r) =>
      `<tr><td>${esc(r.day)}</td><td class="num">${r.old ? clock(r.old) : DASH}</td>` +
      `<td class="num">${r.next ? clock(r.next) : DASH}</td><td class="num">${signedClock(r.next - r.old)}</td></tr>`,
    ).join('');
    preview = `<div class="preview"><div class="ph2"><b>${esc(T('stats.f.preview.title'))}</b><span class="spacer"></span>` +
      `<button class="btn pri" data-act="statsapply">${esc(T('stats.f.apply'))}</button>` +
      `<button class="btn" data-act="statscancel">${esc(T('stats.f.cancel'))}</button></div>` +
      `<div class="scroll"><table><thead><tr><th>${esc(T('stats.f.th.date'))}</th>` +
      `<th style="text-align:right">${esc(T('stats.f.preview.old'))}</th>` +
      `<th style="text-align:right">${esc(T('stats.f.preview.next'))}</th>` +
      `<th style="text-align:right">${esc(T('stats.f.th.diff'))}</th></tr></thead><tbody>${prows}</tbody></table></div></div>`;
  }
  return `<div class="audit-top">${controls}<span class="spacer"></span>${action}</div>${table}${preview}`;
}

function qualityHtml(a: RichStats): string {
  return '<div class="quality">' + statsQuality(a, T).map((q) =>
    `<div class="q"><i class="dot${q.ok ? ' ok' : ''}"></i><span class="txt">` +
    `<span>${esc(T(q.k))}</span><b>${esc(q.v)}</b></span></div>`).join('') + '</div>';
}

/* ── 六个页签的组装 ── */
function compareHtml(a: RichStats): string {
  const cells: Array<{ k: MsgKey; v: string }> = [
    { k: 'stats.f.cmp.week', v: clock(a.weekCur) },
    { k: 'stats.f.cmp.lastWeek', v: a.weekPrev ? clock(a.weekPrev) : DASH },
    { k: 'stats.f.cmp.mom', v: delta(a.weekCur, a.weekPrev) },
    { k: 'stats.f.cmp.month', v: clock(a.monthCur) },
    { k: 'stats.f.cmp.lastMonth', v: a.monthPrev ? clock(a.monthPrev) : DASH },
    { k: 'stats.f.cmp.mom', v: delta(a.monthCur, a.monthPrev) },
  ];
  return '<div class="cmp">' + cells.map((x, i) =>
    `<div class="c"><span>${esc(T(x.k))}</span><b class="${i === 2 || i === 5 ? 'up' : ''}">${esc(x.v)}</b></div>`,
  ).join('') + '</div>';
}

function overviewHtml(a: RichStats): string {
  return insightsHtml(a) +
    section('stats.f.ledger.title') + ledgerHtml(a) +
    section('stats.f.sect.compare', T('stats.f.unit.minSec')) + compareHtml(a) +
    `<div class="grid2">` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.words.title'))}</b><span class="spacer"></span></div>${wordsHtml(a)}</div>` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.speed.title'))}</b></div>${speedHtml(a)}</div>` +
    `</div>` +
    `<div class="grid2">` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.stick.title'))}</b></div>${stickHtml(a)}</div>` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.summary.title'))}</b></div>${summaryHtml(a)}</div>` +
    `</div>` +
    section('stats.f.sect.trend') +
    `<div class="grid2"><div class="card"><div class="card-h"><b>${esc(T('stats.f.chart.title'))}</b><span class="spacer"></span>` +
    `<span class="note">${esc(T('stats.f.range.note'))} · ${esc(T('stats.f.unit.minSec'))}</span></div>${chartHtml(a)}</div>` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.invest.title'))}</b></div>${rankHtml(a)}</div></div>`;
}

function timeHtml(a: RichStats, ui: StatsUiState): string {
  return section('stats.f.time.clock', T('stats.f.unit.minSec')) +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.hour.title'))}</b><span class="spacer"></span>` +
    `<span class="note">${esc(T('stats.f.range.note'))}</span></div>${hours24Html(a)}</div>` +
    `<div class="grid2">` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.weekday.title'))}</b></div>${weekdayHtml(a)}</div>` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.rhythm.title'))}</b></div>${rhythmHtml(a)}</div>` +
    `</div>` +
    section('stats.f.month.title') +
    `<div class="card">${monthlyHtml(a)}</div>` +
    section('stats.f.sect.long', T('stats.f.long.days')) +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.heat.title'))}</b><span class="spacer"></span>` +
    `<span class="note">${esc(T('stats.f.day.hint'))}</span></div>${heatHtml(a, ui)}</div>`;
}

function booksHtml(a: RichStats): string {
  return section('stats.f.sect.goalBooks') +
    /* 年度目标卡整体可点：原型没有可调控件，但目标仍要能改。
       入口挂在卡片上，视觉与原型一致，档位收在 setgoal 弹层里。 */
    `<div class="grid2"><div class="card" data-act="setgoal" style="cursor:pointer"><div class="card-h"><b>${esc(T('stats.f.goal.title'))}</b><span class="spacer"></span>` +
    `<span class="note">${esc(T('stats.f.goal.goalLabel', { n: a.goal }))}</span></div>${goalHtml(a)}</div>` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.invest.title'))}</b></div>${rankHtml(a)}</div></div>` +
    `<div class="grid2" style="margin-top:14px">` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.shelf.title'))}</b></div>${shelfHtml(a)}</div>` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.format.title'))}</b></div>${formatHtml(a)}</div>` +
    `</div>` +
    `<div class="grid2" style="margin-top:14px">` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.bucket.title'))}</b></div>${bucketHtml(a)}</div>` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.eta.title'))}</b></div>${etaHtml(a)}</div>` +
    `</div>` +
    `<div class="card" style="margin-top:14px"><div class="card-h"><b>${esc(T('stats.f.stale.title'))}</b></div>${staleHtml(a)}</div>` +
    section('stats.f.sect.books', T('stats.f.books.idle', { n: a.idleCount })) +
    `<div class="card">${tableHtml(a)}</div>`;
}

function notesHtml(a: RichStats): string {
  return section('stats.f.note.title') +
    `<div class="card">${noteCountHtml(a)}</div>` +
    `<div class="grid2" style="margin-top:14px">` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.note.month'))}</b></div>${noteMonthsHtml(a)}</div>` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.note.top'))}</b></div>${noteTopHtml(a)}</div>` +
    `</div>` +
    section('stats.f.rating.title') +
    `<div class="card">${ratingHtml(a)}</div>`;
}

function achvPaneHtml(a: RichStats): string {
  return section('stats.f.achv.title', `${a.achv.filter((x) => x.got).length}/${a.achv.length}`) +
    `<div class="card">${achvHtml(a)}</div>`;
}

function dataHtml(a: RichStats, ui: StatsUiState): string {
  return `<div class="sect" id="audit"><h3>${esc(T('stats.f.sect.audit'))}</h3><span class="ln"></span></div>` +
    `<div class="card">${auditHtml(a, ui)}</div>` +
    section('stats.f.sect.quality') + qualityHtml(a) +
    `<div class="foot"><span>${esc(T('stats.f.source'))}</span><span>${esc(shortTime(a.now))}</span><span class="spacer"></span>` +
    `<button class="btn" data-act="statscopy">${esc(T('stats.f.copy'))}</button>` +
    `<button class="btn" data-act="statsposter">${esc(T('stats.f.poster'))}</button></div>`;
}

function headHtml(a: RichStats, ui: StatsUiState, locked: boolean): string {
  const ph = `<div class="ph"><h2>${esc(T('stats.f.title'))}</h2>` +
    `<span class="meta">${esc(T('stats.f.meta', { books: a.books.length, sessions: a.allCount, time: shortTime(a.now) }))}</span>` +
    '<span class="spacer"></span>' + seg('statsrange', ui.range, STATS_RANGES.map((v) => ({
      v,
      k: T(RANGE_KEYS[v]),
    }))) + '</div>';
  return ph + (locked ? '' : tabBar(ui)) + kpiHtml(a);
}

function bodyHtml(a: RichStats, ui: StatsUiState): string {
  return pane('overview', ui, overviewHtml(a)) +
    pane('time', ui, timeHtml(a, ui)) +
    pane('books', ui, booksHtml(a)) +
    pane('notes', ui, notesHtml(a)) +
    pane('achv', ui, achvPaneHtml(a)) +
    pane('data', ui, dataHtml(a, ui));
}

/** 完整版：六个子页签，所有页签都在 DOM 里（切页签不重算） */
export function viewStats(v: StatsView, ui: StatsUiState = defaultStatsUi()): string {
  const a = model(v, ui);
  return `<div class="bzs-statspage">${headHtml(a, ui, false)}${bodyHtml(a, ui)}</div>`;
}

/**
 * 基础版锁态：头部六个真实数字照给，下面整截真实图表压进模糊层、
 * 盖上强调色遮罩。点按钮 / 卡片 / 遮罩任意处都走 unlock/mode=stats，
 * 打开的就是插件自己的高级版弹层，没有第二套锁态。
 */
export function viewStatsLocked(v: StatsView, ui: StatsUiState = defaultStatsUi()): string {
  const a = model(v, ui);
  const act = 'data-act="unlock" data-mode="stats"';
  const body = insightsHtml(a) + bodyHtml(a, ui);
  return `<div class="bzs-statspage">${headHtml(a, ui, true)}` +
    `<div class="bzs-lockstat"><div class="bzs-lockstat-body" aria-hidden="true">${body}</div>` +
    `<div class="bzs-lockstat-mask" ${act}><div class="bzs-lockstat-card" ${act}>` +
    `<i class="bzs-lockstat-seal"></i><b>${esc(T('stats.lock.title'))}</b>` +
    `<span class="bzs-lockstat-tags">${esc(T('stats.lock.tags'))}</span>` +
    `<button class="bzs-btn pri" ${act}>${esc(T('stats.lock.title'))}</button>` +
    `</div></div></div></div>`;
}

/** 给复制报告用的文本：动作分发里调，和页面同出一份模型 */
export function statsReportOf(v: StatsView, ui: StatsUiState = defaultStatsUi()): string {
  const a = model(v, ui);
  const extra = [
    T('stats.f.report.line7', {
      words: wan(a.totalWords),
      speed: a.speed || 0,
      shelf: a.topShelf ? a.topShelf.name || T('stats.f.shelf.uncat') : DASH,
    }),
    T('stats.f.report.line8', {
      hl: a.hl, th: a.th, bm: a.bm,
      rating: a.rated ? `${(Math.round(a.ratingAvg * 10) / 10).toFixed(1)}★` : DASH,
    }),
  ];
  return `${statsReportText(a, T)}\n${extra.join('\n')}`;
}

/** 给图片海报用的模型：canvas 绘制在 shell/stats-poster.ts */
export function statsModelOf(v: StatsView, ui: StatsUiState = defaultStatsUi()): RichStats {
  return model(v, ui);
}



/* ============================================================
 * bz-reader · 统计页（shell/render/stats.ts）
 *
 * 一比一复刻 prototype/stats/index.html：整页结构、六联 KPI、洞察、
 * 对比、趋势、节律、热力、目标与书、书籍明细、口径对照、数据质量、
 * 文字报告 / 图片周报出口，以及基础版锁态，全部同出一份 FullStats。
 *
 * 计算在 data/stats-full.ts，交互状态在 shell/stats-ui.ts。
 * 这里只做「模型 → HTML」，不重算任何数字，也不写业务数据。
 * ============================================================ */
import { t, type MsgKey, type MsgParams } from '../../i18n';
import type { ReaderBook } from '../../data/schema';
import type { StatsSummary } from '../../data/stats';
import { dayKey } from '../../data/stats';
import {
  analyzeFull,
  clock,
  delta,
  dayLabel,
  HOUR_KEYS,
  LEN_KEYS,
  pct,
  shortTime,
  startOfDay,
  statsAuditDays,
  statsHeatLevel,
  statsQuality,
  statsRecalcRows,
  statsReportText,
  statsSeries,
  type BookStatus,
  type FullStats,
} from '../../data/stats-full';
import { esc } from './html';
import { segHtml } from './seg';
import { defaultStatsUi, type StatsUiState } from '../stats-ui';

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
function model(v: StatsView, ui: StatsUiState): FullStats {
  const input = {
    books: v.books,
    checkins: v.checkins ?? v.stats?.days ?? {},
    goal: v.goal,
    dailyGoalMinutes: v.dailyGoalMinutes ?? 20,
    now: v.now ?? Date.now(),
    range: ui.range,
  };
  let a = analyzeFull(input);
  if (ui.recalced) {
    const override: Record<string, number> = {};
    for (const r of statsRecalcRows(a)) if (r.next) override[r.day] = r.next;
    a = analyzeFull({ ...input, checkins: override });
  }
  return a;
}

function insightsHtml(a: FullStats): string {
  const rows = [
    { k: T('stats.f.ins.peak'), v: T('stats.f.ins.peakValue', { day: dayLabel(a.peakKey), sec: clock(a.peakSec) }) },
    { k: T('stats.f.ins.hour'), v: T('stats.f.ins.hourValue', { hour: T(HOUR_KEYS[a.bestHour]), sec: clock(a.bestHourSec) }) },
    { k: T('stats.f.ins.idle'), v: T('stats.f.ins.idleValue', { n: a.idleCount }) },
    { k: T('stats.f.ins.streak'), v: T('stats.f.ins.streakValue', { n: a.streak }) },
  ];
  return '<div class="insights">' + rows.map((x) =>
    `<div class="ins"><span>${esc(x.k)}</span><b>${esc(x.v)}</b></div>`).join('') + '</div>';
}

function kpiHtml(a: FullStats): string {
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

function compareHtml(a: FullStats): string {
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

function chartHtml(a: FullStats): string {
  const ser = statsSeries(a);
  const goalSec = a.dailyGoal * 60;
  const chartMax = Math.max(goalSec, ...ser.items.map((i) => i.sec), 1);
  const goalTop = 20 + Math.round((1 - goalSec / chartMax) * 140);
  const bars = ser.items.map((i) =>
    `<div class="col" title="${esc(i.label)} · ${esc(clock(i.sec))}"><span class="v">${i.sec ? clock(i.sec) : DASH}</span>` +
    `<span class="bar" style="height:${Math.round((i.sec / chartMax) * 100)}%"></span>` +
    `<span class="k">${esc(i.label)}</span></div>`,
  ).join('');
  return `<div class="chart"><div class="goal-line" style="top:${goalTop}px"><span>${esc(T('stats.f.chart.goal', { n: a.dailyGoal }))}</span></div>${bars}</div>` +
    `<div class="axis"><span>${a.range === 'all' ? dayKey(a.first) : a.todayK}</span><span>${a.todayK}</span></div>`;
}

function rhythmHtml(a: FullStats): string {
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
    `<div class="sub-h">${esc(T('stats.f.rhythm.length'))}</div>${hbars(lenRows)}`;
}

function heatHtml(a: FullStats): string {
  const base = startOfDay(a.now);
  const cells: string[] = [];
  for (let i = HEAT_DAYS - 1; i >= 0; i--) {
    const k = dayKey(base - i * MS_DAY);
    const sec = a.fullEff[k] || 0;
    cells.push(`<i class="l${statsHeatLevel(sec)}" title="${esc(k)} · ${esc(clock(sec))}"></i>`);
  }
  const active = Object.values(a.fullEff).filter((v) => v > 0).length;
  const legend = ['var(--surface-2)', 'var(--copper-soft)',
    'color-mix(in srgb,var(--copper) 32%,transparent)',
    'color-mix(in srgb,var(--copper) 58%,transparent)', 'var(--copper)']
    .map((bg) => `<i style="background:${bg}"></i>`).join('');
  return `<div class="heat">${cells.join('')}</div>` +
    `<div class="legend"><span>${esc(T('stats.f.heat.less'))}</span>${legend}<span>${esc(T('stats.f.heat.more'))}</span>` +
    `<span style="margin-left:auto">${esc(T('stats.f.heat.active', { n: active }))}</span></div>`;
}

function goalHtml(a: FullStats): string {
  const C = 2 * Math.PI * 52;
  const gp = Math.min(100, Math.round(a.done / Math.max(1, a.goal) * 100));
  const fastest = [...a.books].sort((x, y) => y.percent - x.percent)[0];
  return '<div class="goal-wrap"><svg width="126" height="126" viewBox="0 0 130 130">' +
    '<circle cx="65" cy="65" r="52" fill="none" stroke="var(--line)" stroke-width="8"/>' +
    `<circle cx="65" cy="65" r="52" fill="none" stroke="var(--copper)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - gp / 100)}" transform="rotate(-90 65 65)"/>` +
    `<text x="65" y="62" text-anchor="middle" fill="var(--copper)" font-family="Georgia,serif" font-size="24">${gp}%</text>` +
    `<text x="65" y="84" text-anchor="middle" fill="var(--t3)" font-size="10">${esc(T('stats.f.goal.caption'))}</text></svg>` +
    `<div class="goal-txt"><div class="row"><b>${a.done} / ${a.goal}</b><span>${esc(T('stats.f.unit.book'))}</span></div>` +
    `<div class="row"><b>${pct(fastest ? fastest.percent : 0)}</b><span>${esc(fastest ? fastest.title : DASH)}</span></div>` +
    `<span class="mini">${esc(shortTime(a.now))}</span></div></div>`;
}

function rankHtml(a: FullStats): string {
  const ranked = a.books.filter((b) => b.eff > 0).sort((x, y) => y.eff - x.eff);
  if (!ranked.length) return `<div class="empty">${DASH}</div>`;
  return hbars(ranked.map((b) => ({
    k: b.title,
    v: b.eff,
    s: T('stats.f.invest.value', { sec: clock(b.eff), n: a.total ? Math.round(b.eff / a.total * 100) : 0 }),
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

function tableHtml(a: FullStats): string {
  const rows = [...a.books].sort((x, y) => y.eff - x.eff || y.percent - x.percent).map((b) => {
    const cls = b.status === 'reading' || b.status === 'done' ? 'on'
      : b.status === 'idle' || b.status === 'longIdle' || b.status === 'posOnly' ? 'warn' : '';
    return '<tr><td class="name">' + esc(b.title) +
      `<small>${esc(b.author || DASH)} · ${esc(shortTime(b.last))}</small></td>` +
      `<td><span class="pbar"><i style="width:${Math.min(100, b.percent * 100).toFixed(1)}%"></i></span>${pct(b.percent)}</td>` +
      `<td class="num">${b.eff ? clock(b.eff) : DASH}</td>` +
      `<td class="num">${b.eff && a.total ? Math.round(b.eff / a.total * 100) + '%' : DASH}</td>` +
      `<td class="num">${b.perPct ? clock(b.perPct) : DASH}</td>` +
      `<td class="num">${b.nAll && b.idleDays !== null ? b.idleDays.toFixed(1) + ' ' + esc(T('stats.f.unit.day')) : DASH}</td>` +
      `<td class="num">${b.finishDays !== null ? b.finishDays.toFixed(1) + ' ' + esc(T('stats.f.unit.day')) : DASH}</td>` +
      `<td><span class="tag ${cls}">${esc(T(STATUS_KEY[b.status]))}</span></td></tr>`;
  }).join('');
  const th = (key: MsgKey, right = false) => `<th${right ? ' style="text-align:right"' : ''}>${esc(T(key))}</th>`;
  return '<div class="scroll"><table><thead><tr>' + th('stats.f.th.book') + th('stats.f.th.position') +
    th('stats.f.th.eff', true) + th('stats.f.th.share', true) + th('stats.f.th.perPct', true) +
    th('stats.f.th.idle', true) + th('stats.f.th.finish', true) + th('stats.f.th.status') +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function auditHtml(a: FullStats, ui: StatsUiState): string {
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

function qualityHtml(a: FullStats): string {
  return '<div class="quality">' + statsQuality(a, T).map((q) =>
    `<div class="q"><i class="dot${q.ok ? ' ok' : ''}"></i><span class="txt">` +
    `<span>${esc(T(q.k))}</span><b>${esc(q.v)}</b></span></div>`).join('') + '</div>';
}

function restHtml(a: FullStats, ui: StatsUiState): string {
  const ser = statsSeries(a);
  const heatActive = Object.values(a.fullEff).filter((v) => v > 0).length;
  return section('stats.f.sect.compare', T('stats.f.unit.minSec')) + compareHtml(a) +
    section('stats.f.sect.trend') +
    `<div class="grid2"><div class="card"><div class="card-h"><b>${esc(T('stats.f.chart.title'))}</b><span class="spacer"></span>` +
    `<span class="note">${esc(T(ser.unit === 'week' ? 'stats.f.chart.byWeek' : 'stats.f.chart.byDay'))} · ${esc(T('stats.f.unit.minSec'))}</span></div>${chartHtml(a)}</div>` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.rhythm.title'))}</b></div>${rhythmHtml(a)}</div></div>` +
    section('stats.f.sect.long', T('stats.f.long.days')) +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.heat.title'))}</b><span class="spacer"></span>` +
    `<span class="note">${esc(T('stats.f.heat.active', { n: heatActive }))}</span></div>${heatHtml(a)}</div>` +
    section('stats.f.sect.goalBooks') +
    /* 年度目标卡整体可点：原型没有可调控件，但目标仍要能改。
       入口挂在卡片上，视觉与原型一致，档位收在 setgoal 弹层里。 */
    `<div class="grid2"><div class="card" data-act="setgoal" style="cursor:pointer"><div class="card-h"><b>${esc(T('stats.f.goal.title'))}</b><span class="spacer"></span>` +
    `<span class="note">${esc(T('stats.f.goal.goalLabel', { n: a.goal }))}</span></div>${goalHtml(a)}</div>` +
    `<div class="card"><div class="card-h"><b>${esc(T('stats.f.invest.title'))}</b></div>${rankHtml(a)}</div></div>` +
    section('stats.f.sect.books', T('stats.f.books.idle', { n: a.idleCount })) +
    `<div class="card">${tableHtml(a)}</div>` +
    `<div class="sect" id="audit"><h3>${esc(T('stats.f.sect.audit'))}</h3><span class="ln"></span></div>` +
    `<div class="card">${auditHtml(a, ui)}</div>` +
    section('stats.f.sect.quality') + qualityHtml(a) +
    `<div class="foot"><span>${esc(T('stats.f.source'))}</span><span>${esc(shortTime(a.now))}</span><span class="spacer"></span>` +
    `<button class="btn" data-act="statscopy">${esc(T('stats.f.copy'))}</button>` +
    `<button class="btn" data-act="statsposter">${esc(T('stats.f.poster'))}</button></div>`;
}

function headHtml(a: FullStats, ui: StatsUiState, locked: boolean): string {
  const ph = `<div class="ph"><h2>${esc(T('stats.f.title'))}</h2>` +
    `<span class="meta">${esc(T('stats.f.meta', { books: a.books.length, sessions: a.allCount, time: shortTime(a.now) }))}</span>` +
    '<span class="spacer"></span>' + seg('statsrange', ui.range, [
      { v: 'all', k: T('stats.f.range.all') },
      { v: 'today', k: T('stats.f.range.today') },
    ]) + '</div>';
  return ph + (locked ? '' : insightsHtml(a)) + kpiHtml(a);
}

/** 完整版：洞察 + 六联 KPI + 整页图表 */
export function viewStats(v: StatsView, ui: StatsUiState = defaultStatsUi()): string {
  const a = model(v, ui);
  return `<div class="bzs-statspage">${headHtml(a, ui, false)}${restHtml(a, ui)}</div>`;
}

/**
 * 基础版锁态：头部六个真实数字照给，下面整截真实图表压进模糊层、
 * 盖上强调色遮罩。点按钮 / 卡片 / 遮罩任意处都走 unlock/mode=stats，
 * 打开的就是插件自己的高级版弹层，没有第二套锁态。
 */
export function viewStatsLocked(v: StatsView, ui: StatsUiState = defaultStatsUi()): string {
  const a = model(v, ui);
  const act = 'data-act="unlock" data-mode="stats"';
  const body = insightsHtml(a) + restHtml(a, ui);
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
  return statsReportText(model(v, ui), T);
}

/** 给图片周报用的模型：canvas 绘制在 shell/stats-poster.ts */
export function statsModelOf(v: StatsView, ui: StatsUiState = defaultStatsUi()): FullStats {
  return model(v, ui);
}

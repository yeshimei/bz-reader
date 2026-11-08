/* ============================================================
 * bz-reader · 统计页（shell/render/stats.ts）
 *
 * 全部数字来自 data/stats.ts 的 collectStats，不在这里重算——
 * 两处各算一遍是热力图与总数对不上的经典原因。
 *
 * 与原型的两处口径差异（有意为之）：
 *   · 原型有「今日页数」，真实阅读器没有稳定的页概念（字号一变页数就变），
 *     这里换成「今日时长」，同一个位置、同一层信息，但不会说谎。
 *   · 原型有「平均翻页速度」，同理换成「有记录的天数」。
 * ============================================================ */
import { localeTag, t } from '../../i18n';
import type { ReaderBook } from '../../data/schema';
import type { StatsSummary } from '../../data/stats';
import { dayKey } from '../../data/stats';
import { fmtMinutes } from '../domain';
import { esc } from './html';
import { checkinStats, clampDailyGoal } from '../checkin';

const MS_DAY = 86_400_000;
const HEAT_DAYS = 140;

/** 秒 → mm:ss。锁态头部的「总有效时长 / 今日」与原型同口径，不折算小时 */
function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

interface KpiCell { v: string; k: string }

/** 基础版头部那一行数字：格子数与完整版不同，走同一个样式族 */
function kpiRow(cells: KpiCell[], six = false): string {
  return `<div class="bzs-kpis${six ? ' is-six' : ''}">` +
    cells.map((c) => `<div class="k"><b>${esc(c.v)}</b><span>${esc(c.k)}</span></div>`).join('') +
    '</div>';
}

/** 每日目标的预设档位（分钟）。不开放任意数字，省得用户把目标设成 1 分钟 */
const DAILY_GOAL_CHOICES = [10, 15, 20, 30, 45, 60] as const;

export interface StatsView {
  stats: StatsSummary;
  books: ReaderBook[];
  goal: number;
  /** 每日打卡记录（`YYYY-MM-DD` → 秒）。没有就用 `stats.days` 兜底 */
  checkins?: Record<string, number>;
  /** 每日目标分钟数，打卡判据 */
  dailyGoalMinutes?: number;
  now?: number;
}

/** 当天秒数 → 亮度档（0..4）。分档按「读够多久」而不是等分，短读也能看见 */
function heatLevel(sec: number): number {
  if (!sec) return 0;
  if (sec >= 2700) return 4; // ≥45 分钟
  if (sec >= 1500) return 3; // ≥25 分钟
  if (sec >= 600) return 2; // ≥10 分钟
  return 1;
}

function heatHtml(stats: StatsSummary, now: number): string {
  const cells: string[] = [];
  const start = now - (HEAT_DAYS - 1) * MS_DAY;
  for (let i = 0; i < HEAT_DAYS; i++) {
    const ts = start + i * MS_DAY;
    const sec = stats.days[dayKey(ts)] || 0;
    const lv = heatLevel(sec);
    const d = new Date(ts);
    const tip = `${d.toLocaleDateString(localeTag())} · ${sec ? fmtMinutes(sec) : t('stats.noRecord')}`;
    cells.push(`<i class="l${lv}" title="${esc(tip)}"></i>`);
  }
  return cells.join('');
}

/** 最近 8 周的时长（本周为最后一根柱子） */
function weeklyBars(stats: StatsSummary, now: number): { bars: string; max: number } {
  const weeks: number[] = [];
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  for (let w = 7; w >= 0; w--) {
    let sec = 0;
    for (let d = 0; d < 7; d++) {
      const ts = noon.getTime() - (w * 7 + d) * MS_DAY;
      sec += stats.days[dayKey(ts)] || 0;
    }
    weeks.push(sec);
  }
  const max = Math.max(...weeks, 1);
  const bars = weeks
    .map((sec, i) => {
      const h = Math.round((sec / max) * 100);
      const label = i === weeks.length - 1 ? t('stats.thisWeek') : t('stats.weeksAgo', { n: weeks.length - 1 - i });
      return `<div class="b"><i style="height:${h}%" title="${esc(fmtMinutes(sec))}"></i><span>${label}</span></div>`;
    })
    .join('');
  return { bars, max };
}

/** 拆成两截：完整版两截都给，基础版只给头部 6 个数字、下面整截压进模糊层 */
function buildStats(v: StatsView): { kpis: string; body: string } {
  const now = v.now ?? Date.now();
  const st = v.stats;
  const done = v.books.filter((b) => b.reading.stats.completedTime || b.reading.position.percent >= 0.99).length;
  const goalPct = Math.min(100, Math.round((done / Math.max(1, v.goal)) * 100));
  const C = 2 * Math.PI * 52;
  const { bars } = weeklyBars(st, now);
  /* 打卡（新功能）：优先用 checkins 记录，没有就退回热力图那本账。
     目标值走 clampDailyGoal：脏数据里的 0 / 99999 不能直接显示，
     否则 chip 高亮和真正判据会对不上。 */
  const dailyGoal = clampDailyGoal(v.dailyGoalMinutes);
  const ck = checkinStats(v.checkins ?? st.days, dailyGoal, now);

  const rank = [...st.books]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)
    .map((b) => {
      const top = Math.max(...st.books.map((x) => x.seconds), 1);
      return `<div class="r"><span class="nm">${esc(b.title)}</span><div class="bar"><i style="width:${Math.round(
        (b.seconds / top) * 100,
      )}%"></i></div><em>${t('stats.minutes', { n: Math.round(b.seconds / 60) })}</em></div>`;
    })
    .join('');

  const empty = !st.books.length;

  const kpis = `<div class="bzs-kpis">
      <div class="k"><b>${st.streakDays}</b><span>${t('stats.kpi.streak')}</span></div>
      <div class="k"><b>${done}</b><span>${t('stats.kpi.done')}</span></div>
      <div class="k"><b>${Math.round(st.totalSeconds / 3600)}</b><span>${t('stats.kpi.total')}</span></div>
      <div class="k"><b>${Math.round(st.todaySeconds / 60)}</b><span>${t('stats.kpi.today')}</span></div>
    </div>`;
  const body = `<div class="bzs-stats-grid">
      <div class="bzs-card bzs-goal">
        <svg width="130" height="130" viewBox="0 0 130 130">
          <circle cx="65" cy="65" r="52" fill="none" stroke="var(--line)" stroke-width="8"/>
          <circle cx="65" cy="65" r="52" fill="none" stroke="var(--copper)" stroke-width="8" stroke-linecap="round"
            stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - goalPct / 100)}" transform="rotate(-90 65 65)"/>
          <text x="65" y="62" text-anchor="middle" fill="var(--copper)" font-family="Georgia,serif" font-size="24">${goalPct}%</text>
          <text x="65" y="84" text-anchor="middle" fill="var(--t3)" font-size="10">${t('stats.goal.caption')}</text>
        </svg>
        <div class="gi">
          <b>${t('stats.goal.progress', { done, goal: v.goal })}</b>
          <span>${
            done >= v.goal ? t('stats.goal.reached') : t('stats.goal.remaining', { n: v.goal - done })
          }</span>
          <div style="margin-top:14px">
            <button class="bzs-btn sm" data-act="setgoal">${t('stats.goal.adjust')}</button>
            <button class="bzs-btn sm" data-act="poster">${t('stats.goal.poster')}</button>
          </div>
        </div>
      </div>
      <div class="bzs-card">
        <div class="bzs-sect-h" style="margin:0 0 4px"><b>${t('stats.checkin')}</b><span class="ln"></span></div>
        <div class="bzs-kv"><b>${t('stats.checkin.streak')}</b><span>${t('stats.days', { n: ck.streak })}</span></div>
        <div class="bzs-kv"><b>${t('stats.checkin.today')}</b><span>${
          ck.todayDone
            ? t('stats.checkin.reached', { n: ck.todayMinutes })
            : t('stats.checkin.remaining', { n: ck.todayMinutes, left: ck.leftMinutes })
        }</span></div>
        <div class="bzs-kv"><b>${t('stats.checkin.month')}</b><span>${t('stats.days', { n: ck.monthDays })}</span></div>
        <div class="bzs-kv"><b>${t('stats.checkin.goal')}</b><span class="bzs-goalchips">${DAILY_GOAL_CHOICES.map(
          (n) =>
            `<button class="bzs-chip${n === dailyGoal ? ' on' : ''}" data-act="setdailygoal" data-v="${n}">${t('stats.minutes', { n })}</button>`,
        ).join('')}</span></div>
        <div class="bzs-checkin" title="${t('stats.checkin.monthTitle')}">${ck.month
          .map(
            (v, i) =>
              `<i class="${v === 1 ? 'on' : v === -2 ? 'future' : ''}" title="${new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                i + 1,
              ).toLocaleDateString(localeTag())}"></i>`,
          )
          .join('')}</div>
        <div class="bzs-mini" style="margin-top:10px;line-height:1.9">${t('stats.checkin.hint', { n: dailyGoal })}${
          ck.todayDone ? t('stats.checkin.doneToday') : t('stats.checkin.almost')
        }</div>
      </div>
      <div class="bzs-card">
        <div class="bzs-sect-h" style="margin:0 0 4px"><b>${t('stats.heat')}</b><span class="ln"></span></div>
        <div class="bzs-heat">${heatHtml(st, now)}</div>
        <div class="bzs-heat-axis"><span>${t('stats.heat.oldest')}</span><span>${t('stats.heat.today')}</span></div>
        <div class="bzs-mini" style="margin-top:14px;line-height:1.9">${t('stats.heat.hint')}${
          st.streakDays ? t('stats.heat.streak', { n: st.streakDays }) : t('stats.heat.noStreak')
        }</div>
      </div>
      <div class="bzs-card">
        <div class="bzs-sect-h" style="margin:0 0 4px"><b>${t('stats.weekly')}</b><span class="ln"></span></div>
        <div class="bzs-bars">${bars}</div>
        <div class="bzs-kv" style="margin-top:14px"><b>${t('stats.weekly.today')}</b><span>${fmtMinutes(st.todaySeconds)}</span></div>
        <div class="bzs-kv"><b>${t('stats.weekly.activeDays')}</b><span>${t('stats.days', { n: st.activeDays })}</span></div>
      </div>
      <div class="bzs-card">
        <div class="bzs-sect-h" style="margin:0 0 4px"><b>${t('stats.byBook')}</b><span class="ln"></span></div>
        <div class="bzs-rank">${rank || `<div class="bzs-empty">${t('stats.byBook.empty')}</div>`}</div>
      </div>
    </div>
    ${empty ? `<div class="bzs-empty" style="margin-top:20px">${t('stats.empty')}</div>` : ''}`;
  return { kpis, body };
}

/** 完整版：4 个 KPI + 全部图表 */
export function viewStats(v: StatsView): string {
  const { kpis, body } = buildStats(v);
  return kpis + body;
}

/**
 * 基础版锁态：头部 6 个真实数字照给，下面的完整图表压进模糊层、盖上强调色遮罩。
 * 六个数与完整内容同出一份 buildStats，不会两处各算一遍对不上。
 * 点按钮或遮罩任意处都走 unlock/mode=stats，打开的就是高级版弹层。
 */
export function viewStatsLocked(v: StatsView): string {
  const st = v.stats;
  let sessionCount = 0;
  for (const b of v.books) {
    for (const s of b.reading.sessions) {
      if (!s.start || s.start <= 0) continue;
      if (Math.max(0, Math.round(s.durationSeconds || 0)) > 0) sessionCount += 1;
    }
  }
  const read = st.books.filter((b) => b.seconds > 0).length;
  const avg = sessionCount ? st.totalSeconds / sessionCount : 0;

  const kpis = kpiRow([
    { v: clock(st.totalSeconds), k: t('stats.lock.kpi.total') },
    { v: clock(st.todaySeconds), k: t('stats.lock.kpi.today') },
    { v: t('stats.days', { n: st.activeDays }), k: t('stats.lock.kpi.active') },
    { v: t('stats.days', { n: st.streakDays }), k: t('stats.lock.kpi.streak') },
    { v: t('stats.lock.segments', { n: sessionCount }), k: t('stats.lock.kpi.sessions', { avg: clock(avg) }) },
    { v: `${read}/${v.books.length}`, k: t('stats.lock.kpi.read') },
  ], true);

  const { body } = buildStats(v);
  const act = 'data-act="unlock" data-mode="stats"';
  return kpis +
    `<div class="bzs-lockstat"><div class="bzs-lockstat-body" aria-hidden="true">${body}</div>` +
    `<div class="bzs-lockstat-mask" ${act}>` +
    `<div class="bzs-lockstat-card" ${act}>` +
    `<i class="bzs-lockstat-seal"></i><b>${esc(t('stats.lock.title'))}</b>` +
    `<span class="bzs-lockstat-tags">${esc(t('stats.lock.tags'))}</span>` +
    `<button class="bzs-btn pri" ${act}>${esc(t('stats.lock.title'))}</button>` +
    `</div></div></div>`;
}

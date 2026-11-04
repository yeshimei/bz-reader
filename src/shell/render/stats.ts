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
import type { ReaderBook } from '../../data/schema';
import type { StatsSummary } from '../../data/stats';
import { dayKey } from '../../data/stats';
import { fmtMinutes } from '../domain';
import { esc } from './html';
import { checkinStats, clampDailyGoal } from '../checkin';

const MS_DAY = 86_400_000;
const HEAT_DAYS = 140;

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
    const tip = `${d.getMonth() + 1}月${d.getDate()}日 · ${sec ? fmtMinutes(sec) : '没有记录'}`;
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
      const label = i === weeks.length - 1 ? '本周' : `${weeks.length - 1 - i}周前`;
      return `<div class="b"><i style="height:${h}%" title="${esc(fmtMinutes(sec))}"></i><span>${label}</span></div>`;
    })
    .join('');
  return { bars, max };
}

export function viewStats(v: StatsView): string {
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
      )}%"></i></div><em>${Math.round(b.seconds / 60)} 分</em></div>`;
    })
    .join('');

  const empty = !st.books.length;

  return `<div class="bzs-kpis">
      <div class="k"><b>${st.streakDays}</b><span>连续阅读 · 天</span></div>
      <div class="k"><b>${done}</b><span>已读完 · 本</span></div>
      <div class="k"><b>${Math.round(st.totalSeconds / 3600)}</b><span>累计时长 · 小时</span></div>
      <div class="k"><b>${Math.round(st.todaySeconds / 60)}</b><span>今日 · 分钟</span></div>
    </div>
    <div class="bzs-stats-grid">
      <div class="bzs-card bzs-goal">
        <svg width="130" height="130" viewBox="0 0 130 130">
          <circle cx="65" cy="65" r="52" fill="none" stroke="var(--line)" stroke-width="8"/>
          <circle cx="65" cy="65" r="52" fill="none" stroke="var(--copper)" stroke-width="8" stroke-linecap="round"
            stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - goalPct / 100)}" transform="rotate(-90 65 65)"/>
          <text x="65" y="62" text-anchor="middle" fill="var(--copper)" font-family="Georgia,serif" font-size="24">${goalPct}%</text>
          <text x="65" y="84" text-anchor="middle" fill="var(--t3)" font-size="10">年度目标</text>
        </svg>
        <div class="gi">
          <b>${done} / ${v.goal} 本</b>
          <span>${
            done >= v.goal
              ? '目标已经达成。把数字调高一点，或者换一本难啃的。'
              : `今年还差 ${v.goal - done} 本。目标只影响这圈铜线，不影响别处的统计。`
          }</span>
          <div style="margin-top:14px">
            <button class="bzs-btn sm" data-act="setgoal">调整目标</button>
            <button class="bzs-btn sm" data-act="poster">年度海报</button>
          </div>
        </div>
      </div>
      <div class="bzs-card">
        <div class="bzs-sect-h" style="margin:0 0 4px"><b>每日打卡</b><span class="ln"></span></div>
        <div class="bzs-kv"><b>连续</b><span>${ck.streak} 天</span></div>
        <div class="bzs-kv"><b>今天</b><span>${ck.todayDone ? `已达标 · ${ck.todayMinutes} 分` : `${ck.todayMinutes} 分，还差 ${ck.leftMinutes} 分`}</span></div>
        <div class="bzs-kv"><b>本月</b><span>${ck.monthDays} 天</span></div>
        <div class="bzs-kv"><b>每日目标</b><span class="bzs-goalchips">${DAILY_GOAL_CHOICES.map(
          (n) =>
            `<button class="bzs-chip${n === dailyGoal ? ' on' : ''}" data-act="setdailygoal" data-v="${n}">${n} 分</button>`,
        ).join('')}</span></div>
        <div class="bzs-checkin" title="这个月每天的打卡">${ck.month
          .map((v, i) => `<i class="${v === 1 ? 'on' : v === -2 ? 'future' : ''}" title="${i + 1} 日"></i>`)
          .join('')}</div>
        <div class="bzs-mini" style="margin-top:10px;line-height:1.9">每天读满 ${dailyGoal} 分钟就算打卡。${
          ck.todayDone ? '今天已经打上了。' : '还差一点，睡前十分钟就够。'
        }</div>
      </div>
      <div class="bzs-card">
        <div class="bzs-sect-h" style="margin:0 0 4px"><b>近 20 周</b><span class="ln"></span></div>
        <div class="bzs-heat">${heatHtml(st, now)}</div>
        <div class="bzs-heat-axis"><span>20 周前</span><span>今天</span></div>
        <div class="bzs-mini" style="margin-top:14px;line-height:1.9">格子越亮，那天读得越久。${
          st.streakDays ? `连续 ${st.streakDays} 天没有断过。` : '还没有连续的记录。'
        }</div>
      </div>
      <div class="bzs-card">
        <div class="bzs-sect-h" style="margin:0 0 4px"><b>每周时长</b><span class="ln"></span></div>
        <div class="bzs-bars">${bars}</div>
        <div class="bzs-kv" style="margin-top:14px"><b>今日时长</b><span>${fmtMinutes(st.todaySeconds)}</span></div>
        <div class="bzs-kv"><b>有记录的天数</b><span>${st.activeDays} 天</span></div>
      </div>
      <div class="bzs-card">
        <div class="bzs-sect-h" style="margin:0 0 4px"><b>按书时长</b><span class="ln"></span></div>
        <div class="bzs-rank">${rank || '<div class="bzs-empty">还没有阅读记录。</div>'}</div>
      </div>
    </div>
    ${empty ? '<div class="bzs-empty" style="margin-top:20px">统计只统计真实的阅读会话。打开一本书读几分钟，这里就会亮起来。</div>' : ''}`;
}

/**
 * 统计页的锁态。
 *
 * 不做成一整页灰按钮：先给一张模糊的热力图（让他看见「这里本来有东西」），
 * 再一句人话说明解锁能拿到什么，最后一个按钮。数据是他的，别藏死。
 */
export function viewStatsLocked(): string {
  const cells = Array.from({ length: HEAT_DAYS }, () => '<i></i>').join('');
  return `<div class="bzs-lockstat">
      <div class="bzs-lockstat-blur" aria-hidden="true"><div class="bzs-heat">${cells}</div></div>
      <div class="bzs-empty">阅读统计属于高级版。<br>累计时长、热力图、每本书的进度与读完记录，解锁后都在这里。</div>
      <div class="bzs-lockstat-act"><button class="bzs-btn pri" data-act="unlock" data-mode="stats">查看高级版功能</button></div>
    </div>`;
}

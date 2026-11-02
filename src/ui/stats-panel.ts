/* ============================================================
 * bz-reader · 阅读统计页（ui/stats-panel.ts）
 *
 * 高级版能力。书架弹窗的二级弹窗：统计是一次「看一眼」的动作，
 * 看完就关，不值得占一个 tab——和书架自身的定位一致。
 *
 * 热力图是 DOM 格子不是 canvas：26 周 × 7 天 ≈ 180 个 10px 的方块，
 * DOM 完全扛得住，还能白拿 title 提示与暗色主题变量。
 * 每格档位用 --bzr-brand 打 opacity（.25/.45/.7/1），两套明暗主题
 * 自动都对，不用手调两组色值。
 * ============================================================ */
import { Platform } from 'obsidian';
import type { ReaderStore } from '../data/store';
import { collectStats, dayKey, type StatsSummary } from '../data/stats';
import { durationLabel, el, percentLabel } from './dom';
import { uiModal } from '../core/ui/modal';

/** 半年 26 周（移动端 22 周，收窄到能单手看完）；每周 7 行，列 = 周 */
const WEEKS_DESKTOP = 26;
const WEEKS_MOBILE = 22;
const MS_DAY = 86_400_000;

/** 秒数 → 热力档位 0..4（0 没读 / 15 分钟 / 30 分钟 / 1 小时 四条线） */
function level(seconds: number): number {
  if (!seconds) return 0;
  if (seconds < 15 * 60) return 1;
  if (seconds < 30 * 60) return 2;
  if (seconds < 60 * 60) return 3;
  return 4;
}

interface HeatCell {
  key: string;
  ts: number;
  seconds: number;
  future: boolean;
}

/** 以「本周的周一」为最后一列，往回铺满周数；起点对齐到周一 */
function heatCells(days: Record<string, number>, now: number, weeks: number): HeatCell[] {
  const noon = new Date(now);
  noon.setHours(12, 0, 0, 0);
  const dow = (noon.getDay() + 6) % 7; // 0 = 周一
  const weekStart = noon.getTime() - dow * MS_DAY;
  const start = weekStart - (weeks - 1) * 7 * MS_DAY;
  const cells: HeatCell[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const ts = start + i * MS_DAY;
    const k = dayKey(ts);
    cells.push({ key: k, ts, seconds: days[k] || 0, future: ts > noon.getTime() });
  }
  return cells;
}

function summaryCard(big: string, label: string): HTMLElement {
  const card = el('div', 'bzr-stat-card');
  card.append(el('b', '', big), el('span', '', label));
  return card;
}

function heatSection(summary: StatsSummary, now: number, weeks: number): HTMLElement {
  const box = el('div', 'bzr-heat');
  const cells = heatCells(summary.days, now, weeks);

  // 月份标签行：该月 1 号落在哪一列，就在哪一列标月份
  const months = el('div', 'bzr-heat-months');
  let lastMonth = -1;
  for (let col = 0; col < weeks; col++) {
    const d = new Date(cells[col * 7].ts);
    const m = d.getMonth();
    if (m !== lastMonth && d.getDate() <= 7 && col > 0) {
      months.appendChild(el('span', '', `${m + 1} 月`));
      lastMonth = m;
    } else {
      months.appendChild(el('span'));
    }
  }

  const grid = el('div', 'bzr-heat-grid');
  for (const cell of cells) {
    const g = el('i');
    if (!cell.future) {
      const lv = level(cell.seconds);
      if (lv) g.classList.add(`lv${lv}`);
      g.title = `${Number(cell.key.slice(5, 7))} 月 ${Number(cell.key.slice(8))} 日 · ${durationLabel(cell.seconds)}`;
    }
    grid.appendChild(g);
  }

  const foot = el('div', 'bzr-heat-foot');
  const legend = el('div', 'bzr-heat-legend', '少');
  for (const lv of [1, 2, 3, 4]) legend.appendChild(el('i', `lv${lv}`));
  legend.appendChild(document.createTextNode('多'));
  foot.append(legend, el('span', '', `${summary.activeDays} 天有阅读`));

  box.append(months, grid, foot);
  return box;
}

function booksSection(summary: StatsSummary): HTMLElement {
  const box = el('div', 'bzr-stats-books');
  box.appendChild(el('div', 'bzr-stats-sec', '每本书'));
  for (const row of summary.books) {
    const item = el('div', 'bzr-stats-book');
    const t = el('div', 't');
    t.append(el('span', 'name', row.title), el('span', 'sec', durationLabel(row.seconds)));
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${Math.min(100, Math.round(row.percent * 100))}%`;
    bar.appendChild(fill);
    const meta = el('div', 'meta');
    const bits: string[] = [percentLabel(row.percent)];
    if (row.author) bits.push(row.author);
    meta.textContent = bits.join(' · ');
    item.append(t, bar, meta);
    box.appendChild(item);
  }
  return box;
}

export function openStats(store: ReaderStore): void {
  const mobile = Platform.isMobile;
  const now = Date.now();
  const summary = collectStats(store.get().books, now);

  const root = el('div', 'bzr-stats' + (mobile ? ' is-mobile' : ''));

  const cards = el('div', 'bzr-stats-cards');
  cards.append(
    summaryCard(durationLabel(summary.totalSeconds), '总时长'),
    summaryCard(durationLabel(summary.todaySeconds), '今天'),
    summaryCard(summary.streakDays ? `${summary.streakDays} 天` : '—', '连续'),
    summaryCard(summary.activeDays ? `${summary.activeDays} 天` : '—', '累计'),
  );
  root.appendChild(cards);

  if (summary.totalSeconds > 0) {
    root.appendChild(heatSection(summary, now, mobile ? WEEKS_MOBILE : WEEKS_DESKTOP));
    if (summary.books.length) root.appendChild(booksSection(summary));
  } else {
    const empty = el('div', 'bzr-stats-empty');
    empty.append(
      el('div', 'bzr-stats-empty-t', '还没有阅读记录'),
      el('div', 'bzr-stats-empty-d', '打开一本书读一会儿，这里就会长出热力图。'),
    );
    root.appendChild(empty);
  }

  uiModal({
    content: root,
    className: 'bzr-stats-popup',
    title: '阅读统计',
    head: true,
    maxWidth: 560,
    autofocus: false,
    onClose: () => void store.flush(),
  });
}

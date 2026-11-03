/* ============================================================
 * bz-reader · 阅读统计页（ui/stats-panel.ts）
 *
 * 高级版能力。书架弹窗的二级弹窗：统计是一次「看一眼」的动作，
 * 看完就关，不值得占一个 tab——和书架自身的定位一致。
 *
 * 原型 reader-v2 的两栏版式：
 *   左栏 = 衬线大数字（累计）+ 三行小账 + 连续天数火漆条；
 *   右栏 = 半年热力图（铜金四档）+ 书脊进度（色块封面 + 细进度线）。
 *
 * 热力图是 DOM 格子不是 canvas：26 周 × 7 天 ≈ 180 个 10px 的方块，
 * DOM 完全扛得住，还能白拿 title 提示。档位沿用品牌色 opacity 四档。
 * ============================================================ */
import { Platform, setIcon } from 'obsidian';
import type { ReaderStore } from '../data/store';
import { collectStats, dayKey, type StatsSummary } from '../data/stats';
import { coverColors, durationLabel, el, percentLabel } from './dom';
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

/** 书脊进度：色块小封面 + 书名 + 细进度线 + 百分比（衬线） */
function booksSection(summary: StatsSummary): HTMLElement {
  const box = el('div', 'bzr-stats-books');
  box.appendChild(el('div', 'bzr-stats-sec', '书架进度'));
  for (const row of summary.books) {
    const item = el('div', 'bzr-stats-book');
    const { c1, c2 } = coverColors(row.title);
    const cv = el('span', 'cv');
    cv.style.setProperty('--c1', c1);
    cv.style.setProperty('--c2', c2);
    const bi = el('div', 'bi');
    const t = el('div', 't');
    const name = el('span', 'name', row.title);
    const pct = el('span', 'pct', percentLabel(row.percent));
    t.append(name, pct);
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${Math.min(100, Math.round(row.percent * 100))}%`;
    bar.appendChild(fill);
    bi.append(t, bar);
    item.append(cv, bi);
    box.appendChild(item);
  }
  return box;
}

/** 左栏：大数字 + 三行小账 + 火漆条 */
function sideSection(summary: StatsSummary): HTMLElement {
  const side = el('div', 'bzr-stats-side');
  const big = el('div', 'bzr-stats-big', durationLabel(summary.totalSeconds));
  side.append(big, el('div', 'bzr-stats-cap', '累 计 阅 读'));

  const row = (value: string, label: string): HTMLElement => {
    const r = el('div', 'bzr-stats-row');
    r.append(el('b', '', value), el('span', '', label));
    return r;
  };
  side.append(
    row(durationLabel(summary.todaySeconds), '今 天'),
    row(summary.streakDays ? `${summary.streakDays} 天` : '—', '连 续'),
    row(summary.activeDays ? `${summary.activeDays} 天` : '—', '有 阅 读'),
  );

  if (summary.streakDays > 0) {
    const streak = el('div', 'bzr-stats-streak');
    /* 火焰原来是 emoji 字符：粗细和基线全由字体决定，换台机器就对不齐。
       换成 lucide 的 16px SVG。 */
    const fl = el('span', 'fl');
    setIcon(fl, 'flame');
    streak.append(fl, el('b', '', `连续 ${summary.streakDays} 天`));
    side.appendChild(streak);
  }
  return side;
}

export function openStats(store: ReaderStore): void {
  const mobile = Platform.isMobile;
  const now = Date.now();
  const summary = collectStats(store.get().books, now);

  const root = el('div', 'bzr-stats' + (mobile ? ' is-mobile' : ''));

  if (summary.totalSeconds > 0) {
    const main = el('div', 'bzr-stats-main');
    main.append(sideSection(summary));
    const right = el('div', 'bzr-stats-right');
    right.appendChild(heatSection(summary, now, mobile ? WEEKS_MOBILE : WEEKS_DESKTOP));
    if (summary.books.length) right.appendChild(booksSection(summary));
    main.appendChild(right);
    root.appendChild(main);
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
    maxWidth: 720,
    autofocus: false,
    onClose: () => void store.flush(),
  });
}

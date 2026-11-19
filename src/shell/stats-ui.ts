/* ============================================================
 * bz-reader · 统计页的局部交互状态（shell/stats-ui.ts）
 *
 * 范围、口径、页签、展开的那一天、预演这几个开关只影响统计页自己，不值得
 * 塞进全局 ShellState（那边会落 localStorage，重载后还记着上次点过的口径，
 * 反而让人以为数据变了）。这里放一份模块内的瞬时状态，动作分发改完调
 * repaint() 即可。
 *
 * 「按会话重算打卡」只在页面内存里预演：checkins 永远从 store 读，
 * 这里不存覆盖值，页面自己按重算清单临时算一份，绝不写回业务数据。
 * ============================================================ */
import type { StatsRange } from '../data/stats-full';

export type StatsAudit = 'wall' | 'checkin';
export type StatsTab = 'overview' | 'time' | 'books' | 'notes' | 'achv' | 'data';

export interface StatsUiState {
  range: StatsRange;
  audit: StatsAudit;
  preview: boolean;
  recalced: boolean;
  /** 当前子页签；默认概览 */
  tab: StatsTab;
  /** 热力图上展开的那一天（`YYYY-MM-DD`，空 = 没展开） */
  day: string;
}

const RANGES: readonly StatsRange[] = ['all', 'today', 'week', 'month', 'year'];
const TABS: readonly StatsTab[] = ['overview', 'time', 'books', 'notes', 'achv', 'data'];

export function defaultStatsUi(): StatsUiState {
  return { range: 'all', audit: 'checkin', preview: false, recalced: false, tab: 'overview', day: '' };
}

let current: StatsUiState = defaultStatsUi();

export function getStatsUi(): StatsUiState {
  return current;
}

export function setStatsUi(patch: Partial<StatsUiState>): StatsUiState {
  const next = { ...current, ...patch };
  if (!RANGES.includes(next.range)) next.range = 'all';
  if (next.audit !== 'wall' && next.audit !== 'checkin') next.audit = 'checkin';
  if (!TABS.includes(next.tab)) next.tab = 'overview';
  next.day = typeof next.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(next.day) ? next.day : '';
  current = next;
  return current;
}

/** 仅供测试：把状态拨回初始，避免用例之间互相污染 */
export function resetStatsUi(): void {
  current = defaultStatsUi();
}

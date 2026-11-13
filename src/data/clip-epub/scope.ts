/**
 * bz-reader · 剪藏成书「汇总范围」（data/clip-epub/scope.ts）
 *
 * 2026-11-14：设置里给剪藏本一个范围三选（全部 / 未读 / 今日+未读），
 * 默认**未读**。纯函数放这里，读盘与渲染都不掺进来。
 *
 * 口径（改之前先看这条，别按字面改回去）：
 *   · 「未读」= 除**明确读过**（state === 'read'）以外都算。剪藏（saved）
 *     是「存下来了」，不是「读过了」——用户收藏一篇没读，它就该留在书里。
 *   · 「今日」按**文章发布时间**（ts）按本机时区零点切，不按抓取时间：
 *     昨晚抓的今天的早报，读者认为它就是今天的。
 *   · ts 拿不到（0）的旧数据只靠 state 判定：未读照收，已读不进
 *     「今日+未读」——不能因为时间缺失就把它当成今天的。
 */
import type { ClipChapterState } from '../../engine/clipbook';

export type ClipScope = 'all' | 'unread' | 'todayUnread';

/** 缺省范围：只看没读过的（用户定的默认值） */
export const DEFAULT_CLIP_SCOPE: ClipScope = 'unread';

/** 设置页三选的顺序，也是落盘取值的白名单 */
export const CLIP_SCOPES: readonly ClipScope[] = ['all', 'unread', 'todayUnread'];

/** 老 data.json / 手改坏的值一律退回默认，别让筛选整块失效 */
export function normalizeClipScope(raw: unknown): ClipScope {
  return raw === 'all' || raw === 'todayUnread' ? raw : 'unread';
}

/** 本机时区的今天零点（毫秒） */
export function todayStart(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface ScopeItem {
  state: ClipChapterState;
  /** 发布时间戳；0 = 未知 */
  ts: number;
}

/** 这一篇在给定范围里要不要收 */
export function scopeKeeps(item: ScopeItem, scope: ClipScope, start = todayStart()): boolean {
  if (scope === 'all') return true;
  if (item.state !== 'read') return true;
  return scope === 'todayUnread' && Number(item.ts) >= start;
}

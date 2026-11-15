/* ============================================================
 * bz-reader · 预生成续跑（core/tts-prefetch.ts）
 *
 * 预生成可能跑到一半被停、也可能关掉插件再回来。缓存就是进度：合成一段
 * 写一段，所以「已经备好几段」这件事不需要另存一份会被写坏的进度文件
 * （那也是 2026-11-14 定下的口径）。
 *
 * 这里只负责「该问哪个窗」：纯函数，视图拿它决定弹「收费确认」「继续 /
 * 重做」还是「重备」。数字全按段数封顶，不让坏缓存把进度算成负剩余。
 * ============================================================ */

export type PrefetchMode = 'fresh' | 'resume' | 'rebuild';

export interface PrefetchPlan {
  mode: PrefetchMode;
  /** 已备好的段数（不会超过 total） */
  cached: number;
  total: number;
  /** 还要合成几段 */
  left: number;
}

/**
 * 缓存现状 → 该弹哪个窗。
 *
 *   · fresh   一段都没有：走第一次的确认（云端要讲钱、本地要讲时间）
 *   · resume  备了一部分：给「继续」和「全部重做」，让用户自己选
 *   · rebuild 整章都有：等同于重备，问一句确认
 */
export function prefetchPlan(cached: number, total: number): PrefetchPlan {
  const all = Math.max(0, Math.round(Number(total) || 0));
  const got = Math.min(all, Math.max(0, Math.round(Number(cached) || 0)));
  const left = Math.max(0, all - got);
  if (all > 0 && got >= all) return { mode: 'rebuild', cached: got, total: all, left: 0 };
  if (got > 0) return { mode: 'resume', cached: got, total: all, left };
  return { mode: 'fresh', cached: 0, total: all, left: all };
}

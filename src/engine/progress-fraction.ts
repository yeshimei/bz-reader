/* ============================================================
 * bz-reader · 进度小数（engine/progress-fraction.ts）
 *
 * foliate 的 relocate 每拍带一个 `fraction`，业务层拿它当「读到哪了」：
 * 阅读进度、书架百分比、以及「读完这本书」的判定。
 *
 * 但分页器算这个数时用的是 `(page - 1) / (pages - 2)`（`pages` 含首尾两张
 * 空白页）。**本章正好两页时分母为 0**：
 *   · 第 1 页 → 0 / 0 = NaN
 *   · 第 2 页 → 1 / 0 = Infinity
 * `Math.max(0, Infinity)` 仍然是 Infinity，夹到 1 之后就成了「100% 读完了」。
 *
 * 长篇 EPUB 一章几十页，撞不上；剪藏本按文章分章，两页是常态，
 * 于是每翻一章都弹一次「读完一本书」（2026-11-13 真机验证）。
 *
 * 处理口径：拿不到**有限**的数就当未知（0），绝不当成读到底。
 * 未知只影响一次进度刷新，误判却会打断阅读。
 * ============================================================ */

/** 分页器给的 `fraction` → 可用的 0..1 进度；NaN / Infinity / 非数字一律 0 */
export function safeFraction(raw: unknown): number {
  const v = Number(raw);
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

/**
 * 这次 relocate 该不该把书标成「读完」。
 *
 * 剪藏本是持续更新的订阅流：明天抓取又会多出新文章，「读完」语义不成立，
 * 更不能弹「给这本书写句书评」的结书卡（真机：只读到第 2 篇就被弹窗）。
 * 另外 percent 由分页器估算，末尾几页的估算偏差不该触发结书仪式。
 */
export function shouldMarkComplete(input: {
  percent: number;
  /** 活书（剪藏本）：永远不标读完 */
  live: boolean;
  completed: boolean;
  threshold?: number;
}): boolean {
  if (input.live || input.completed) return false;
  const threshold = input.threshold ?? 0.99;
  return Number.isFinite(input.percent) && input.percent >= threshold;
}

/**
 * 阅读区底部被宿主浮层盖住了多少。
 *
 * 两种浮层：手机底部导航栏（`.mobile-navbar`）和桌面状态栏（`.status-bar`）。
 * 两者都是 `position: fixed`，压在阅读区上；剪藏本的底条是壳层 flex 列的
 * 最后一行，于是正好落在它们下面：1024 宽时「剪藏本」按钮只露出「剪藏」，
 * 按钮中心点到的是状态栏；手机上整条底条被导航栏切掉上半截，三个按钮全
 * 点不到（真机三组验证都撞上）。
 *
 * 量法：**阅读区自己的底边 − 浮层顶边**。以前用「浮层高度」估算，手机上
 * 只让出 52px，而导航栏离屏幕底还有 32px 安全区，底条仍然压在栏上。
 * 这里直接量重叠，夹在 0–cap：浮层不在、量不到、或阅读区根本没伸到浮层
 * 下面时都返回 0，绝不凭空挖白。
 */
export function chromeBottomOverlap(
  paneBottom: number | null | undefined,
  barTop: number | null | undefined,
  cap = 120,
): number {
  if (paneBottom == null || barTop == null) return 0;
  if (!Number.isFinite(paneBottom) || !Number.isFinite(barTop)) return 0;
  const overlap = Math.round(paneBottom - barTop);
  if (overlap <= 0) return 0;
  return Math.min(overlap, cap);
}

/** 兼容旧调用：只按浮层高度让位（手机导航栏）。 */
export function navBottomGap(navHeight: number | null | undefined, cap = 96): number {
  if (navHeight == null || !Number.isFinite(navHeight) || navHeight <= 0) return 0;
  return Math.min(Math.round(navHeight), cap);
}

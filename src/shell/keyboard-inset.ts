/**
 * 键盘遮挡补偿（移动端）。
 *
 * 安卓 WebView 弹键盘时不一定缩小 layout viewport，`position: fixed; bottom: 0`
 * 的卡片会被键盘盖住——用户看到的就是「输入框在键盘下面」。
 * 用 visualViewport 的差值把卡片抬起来，键盘收起再放回去。
 */
export interface ViewportMetrics {
  innerHeight: number;
  visualHeight: number;
}

/** 键盘占掉的高度（没有键盘时为 0） */
export function keyboardInset(m: ViewportMetrics): number {
  if (!Number.isFinite(m.innerHeight) || !Number.isFinite(m.visualHeight)) return 0;
  const d = m.innerHeight - m.visualHeight;
  return d > 80 ? Math.round(d) : 0;
}

/** 卡片应该抬起的像素：键盘高度 + 一点余量，且不超过视口 60% */
export function sheetLift(m: ViewportMetrics): number {
  const inset = keyboardInset(m);
  if (!inset) return 0;
  /* 只按键盘高度抬，不再额外加余量：卡片本身有 10px 边距，加了会顶进正文 */
  return Math.min(inset, Math.round(m.visualHeight * 0.6));
}

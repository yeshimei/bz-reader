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

/**
 * 贴底抽屉的抬升量：**整个**键盘高度，不套 60% 上限。
 *
 * 上限是给「贴字小卡」留的：卡只占屏幕一小块，抬太多会顶到正文。
 * 抽屉本来就是整张卡，目标是把底边送到键盘上沿——截断只会让下半截
 * 留在键盘后面（真机 2026-11-09 截图：只抬起了三分之一）。
 */
export function drawerLift(m: ViewportMetrics): number {
  return keyboardInset(m);
}

/**
 * 从宿主写在根元素上的 `--keyboard-height` 读键盘高（可带 px）。
 *
 * 为什么优先用这个而不是 visualViewport 差值：Obsidian 移动端自己就用它
 * 定位移动工具栏与回链面板（桌面版安装包里能搜到
 * `getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height")`），
 * 说明它由宿主原生层维护、值可靠。部分安卓 WebView 的 visualViewport
 * 在键盘弹起时只报一半高度，用它抬抽屉会停在半路（真机 2026-11-09）。
 *
 * 空串 / 0 / 脏值一律当「没有键盘」。
 */
export function keyboardHeightFromCss(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

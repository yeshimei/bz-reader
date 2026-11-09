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

/** 抽屉抬升要看的几路信号（由调用点从 window / documentElement 上采集） */
export interface DrawerSignals extends ViewportMetrics {
  /** 宿主写在 --keyboard-height 上的值（没有就是 0） */
  hostHeight: number;
  /** 键盘弹起前的完整窗口高；用来判断 WebView 是否已经被系统缩小 */
  baseInnerHeight: number;
  /**
   * 是不是 iOS。iOS 的 Capacitor 会把 WebView 缩到键盘上方，
   * 安卓 adjustPan 不缩——两端「窗口与视觉视口等高」的含义正好相反。
   * 缺省按安卓算：宁可多抬一次，也不要让输入框落在键盘后面。
   */
  ios?: boolean;
}

/**
 * 贴底抽屉该抬多少——安卓与 iOS 共用这一份判断。
 *
 * 两端的键盘让位方式不一样：
 *   · 安卓 WebView 通常不缩窗口（adjustPan / overlay），键盘盖在内容上，
 *     只能自己把抽屉抬起来；
 *   · iOS 的 Capacitor 多半已经把 WebView 缩到键盘上方（resize native），
 *     此时 fixed 的容器也跟着变矮，再抬一次会把抽屉顶到屏幕上半截。
 *
 * 两条判据，任一条成立就不抬：
 *   1. 窗口比键盘弹起前矮了 80px 以上（有基线时最可靠）；
 *   2. iOS 上窗口与视觉视口几乎一样高、宿主又报了键盘高——说明键盘
 *      根本不在视口里，系统已经让过位了。
 *
 * 第 2 条是 2026-11-09 补的：点「分类管理」时键盘先被叫起，等弹层画
 * 出来已经缩过窗，而基线（baseInnerHeight）还是 0，第 1 条判不出来。
 * 真机上卡片被扣掉整个键盘高，只剩一条缝——用户说的「打不开」。
 */
export function drawerLiftFor(s: DrawerSignals): number {
  /* iOS：键盘已被系统让掉。用「半个键盘高」做容差——视觉视口可能比
     布局视口再小几十像素（滚动条 / 浏览器 UI），差值远小于键盘高就
     说明键盘那块并不在视口里。 */
  const pinnedBySystem =
    !!s.ios && s.hostHeight > 0 && s.innerHeight - s.visualHeight < s.hostHeight * 0.5;
  if (pinnedBySystem) return 0;
  const shrunk = s.baseInnerHeight > 0 && s.innerHeight < s.baseInnerHeight - 80;
  if (shrunk) return 0;
  return s.hostHeight || drawerLift(s);
}

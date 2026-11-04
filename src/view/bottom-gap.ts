/**
 * 手机底部导航栏盖住了多少正文。
 *
 * Obsidian 移动端的导航栏（`< > 🔍 + ☰` 那一排）浮在内容上，阅读区一直
 * 伸到屏幕最底。这里只回答一个问题：要在阅读区底部让出多高。
 *
 * 以前用的是「阅读区底边 − 栏顶边」，真机上这两个坐标经常不在同一个参照里
 * （栏在视口里是 fixed，阅读区的高度却是从宿主布局算的），一量就是一整截，
 * 底部凭空多出上百像素的空白。改成直接量**栏自己的高度**：它覆盖多少，
 * 就是多少。
 *
 * 上限 96px 是保险：万一选择器命中的是某个外层容器，也不会把整页留白吃掉。
 * 量不到（桌面端、栏被隐藏、类名变了）返回 0——顶多保持现状，绝不凭空挖白。
 */
export function navBottomGap(navHeight: number | null | undefined, cap = 96): number {
  if (navHeight == null || !Number.isFinite(navHeight) || navHeight <= 0) return 0;
  return Math.min(Math.round(navHeight), cap);
}

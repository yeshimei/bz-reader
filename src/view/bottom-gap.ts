/**
 * 手机底部导航栏盖住了多少正文。
 *
 * Obsidian 移动端的导航栏（`< > 🔍 + ☰` 那一排）是**浮在内容上**的：
 * 阅读区一直伸到屏幕最底下，分页按「容器高度」排，最后一行就压在栏下。
 * 只有翻到一页排满的时候才看得出来，所以用户觉得是「偶尔」。
 *
 * 这里只做一件事：量出重叠的高度，交给阅读区做 `padding-bottom`。
 * 量不到栏（桌面端、栏被隐藏、类名变了）就返回 0——不加留白，
 * 顶多保持现状，不会平白在正文底下挖一块空白。
 */
export function bottomOverlap(rootBottom: number, navTop: number | null): number {
  if (navTop == null || !Number.isFinite(navTop) || !Number.isFinite(rootBottom)) return 0;
  return Math.max(0, Math.round(rootBottom - navTop));
}

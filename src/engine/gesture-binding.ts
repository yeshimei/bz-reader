/* ============================================================
 * bz-reader · 手势挂在哪份文档上（engine/gesture-binding.ts）
 *
 * 点按翻页、划词上报、滚轮接管这三组监听都挂在**正文 iframe 自己的文档**上
 * （iframe 里的事件不冒泡到宿主）。以前只在 foliate 的 `load` 事件里挂一次：
 * `load` 一到就绑，之后不再管。
 *
 * 问题是 `load` 并不总是会来。iframe 被复用来换章、或者引擎在真机上没派发
 * 这个事件时，监听会整场落空——表现是「正文能选中、目录能跳章，但点正文
 * 毫无反应、划词也不出工具条」，而且从打开第一下就是这样，关书重开也一样。
 * iPhone 上的这次反馈正是这个形状。
 *
 * 所以绑定要**幂等**：每次拿到当前可见文档就跟已绑的那份比一比，一样就跳过，
 * 不一样才重挂。这样 `relocate`（每次可见位置变化必然到达）可以当兜底路径，
 * 不必指望 `load` 一次命中。
 * ============================================================ */

/** 渲染器 `getContents()` 返回的一项（只取这里用得上的字段） */
interface ContentsEntry {
  doc?: Document | null;
}

/**
 * 从 `renderer.getContents()` 的结果里挑出要挂监听的文档。
 *
 * 只取第一份：并排双栏是两个 host，各自管自己那一栏，不该去挂别人的。
 */
export function pickGestureDoc(
  contents: ReadonlyArray<ContentsEntry> | null | undefined,
): Document | null {
  if (!contents?.length) return null;
  return contents[0]?.doc ?? null;
}

/**
 * 这次拿到的文档要不要重挂。
 *
 * `relocate` 在一次翻页里可能连来好几次，所以「同一份文档」必须是跳过，
 * 否则每来一次就解绑重绑一遍，正在进行的滑动会被打断。
 */
export function needsGestureBind(current: Document | null, next: Document | null): boolean {
  return !!next && next !== current;
}

/** 上一页区占正文高度的比例（其余 60% 是下一页） */
export const TAP_ZONE_PREV_RATIO = 0.4;

/**
 * 手指落在正文的哪个区。
 *
 * 用**正文自己的坐标与高度**，不换算到屏幕坐标：iOS 的 WKWebView 里
 * iframe 的 `screenY` 与宿主窗口的对应关系不可靠，绕到屏幕再减回来会把
 * 上下判反。判成「上一页」而当前正在第一页时，点哪儿都不动——用户看到的
 * 就是「点了没反应」。
 *
 * 量不到高度、或者坐标不是有限数时按「下一页」：宁可往前走一页，
 * 也不要让整本书停在一个点不动的页面上。
 */
export function zoneFromFrameY(y: number, frameHeight: number): 'prev' | 'next' {
  if (!Number.isFinite(y) || !Number.isFinite(frameHeight) || frameHeight <= 0) return 'next';
  return y / frameHeight < TAP_ZONE_PREV_RATIO ? 'prev' : 'next';
}

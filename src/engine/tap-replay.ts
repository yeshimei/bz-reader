/* ============================================================
 * bz-reader · 点按重播判定（engine/tap-replay.ts）
 *
 * 一次点按会被两条路各报一次：pointerup 和 touchend。以前靠一个单向开关
 * （`pointerWorks`）决定「只认哪一条」——走过一次完整的 pointerup 之后就
 * 永久关掉触摸兜底。iPhone 上这套会锁死：分页器对带位移的 touchmove
 * 一律 preventDefault，WKWebView 于是一次手势只派 pointercancel、不派
 * pointerup，两条路同时哑掉，点正文完全没反应，只能关书重开。
 *
 * 现在两条路都独立上报，靠这里去掉重复的那一次。判据必须是
 * 「时间极近 + 位置几乎不动」两条同时成立：
 *   · 只看时间：连点两下会被吞成一下；
 *   · 只看位置：同一块地方隔一会儿再点，会被当成重播。
 * ============================================================ */

/** 上一次真的上报出去的点按（坐标是事件自带的，不是换算后的） */
export interface TapMark {
  at: number;
  x: number;
  y: number;
}

/**
 * 两条路报同一次手势的时间窗。
 *
 * pointerup 与 touchend 在规范里的顺序是 pointerup 先，真机实测间隔个位数
 * 毫秒；80ms 留够慢设备与线程卡顿的余量，又远小于人手最快连点（150ms 上下）。
 */
export const REPLAY_MS = 80;

/**
 * 同一手势两条路取到的坐标允许的偏差。
 *
 * 同一次触摸的 clientX/clientY 本该逐字相同，真机上偶尔差零点几像素
 * （指针与触摸各自取整）。12px 不会把「两次不同位置的点击」误判成一次。
 */
export const REPLAY_PX = 12;

/**
 * 这次上报是不是刚才那一次的重播。
 *
 * @param last 上一次上报出去的点按；没有就是 null
 * @param at 这一次的时间戳（毫秒）
 */
export function isReplayTap(
  last: TapMark | null | undefined,
  at: number,
  x: number,
  y: number,
): boolean {
  if (!last) return false;
  /* 窗口左闭右开：正好 80ms 之后算新的一次 */
  if (at - last.at >= REPLAY_MS) return false;
  return Math.abs(x - last.x) <= REPLAY_PX && Math.abs(y - last.y) <= REPLAY_PX;
}

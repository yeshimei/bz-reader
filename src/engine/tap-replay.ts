/* ============================================================
 * bz-reader · 点按重播判定（engine/tap-replay.ts）
 *
 * 一次点按会被两条路各报一次：pointerup 和 touchend。以前靠一个单向开关
 * （`pointerWorks`）决定「只认哪一条」——走过一次完整的 pointerup 之后就
 * 永久关掉触摸兜底。iPhone 上这套会锁死：分页器对带位移的 touchmove
 * 一律 preventDefault，WKWebView 于是一次手势只派 pointercancel、不派
 * pointerup，两条路同时哑掉，点正文完全没反应，只能关书重开。
 *
 * 现在两条路都独立上报，靠这里去掉重复的那一次。两层判据：
 *
 *  1. 手势身份（touchTapVerdict）：pointer 这条路报过就记在那次手势上，
 *     touchend 到了直接闭嘴。这是**主判据**——翻页的同步重排在手机上
 *     动辄上百毫秒，touchend 被拖到 80ms 之后才派发是常态，
 *     「一次点按翻两页、中间闪一下」就是时间窗判空造成的。
 *  2. 时间 + 位置（isReplayTap）：兜住「touchend 先到」「手势对象丢了」
 *     这类异常顺序，不指望它当第一道防线。
 * ============================================================ */

/** 上一次真的上报出去的点按（坐标是事件自带的，不是换算后的） */
export interface TapMark {
  at: number;
  x: number;
  y: number;
}

/**
 * 屏上这一次触摸手势。
 *
 * `reported` 是「同一次手势已经被 pointerup 上报过」的标记：一旦置位，
 * 后面那条 touchend 就只是同一次点按的回声，不能再翻一页。
 */
export interface TapGesture {
  /** 起手位置（clientX/clientY），位移判定用 */
  x: number;
  y: number;
  /** 起手时间（毫秒），长按判定用 */
  at: number;
  /** 手势过程中的最大位移 */
  moved: number;
  /** 起手时的手指数：两指落下那次手势不是点按 */
  fingers: number;
  /** 这次手势是否已经由 pointer 这条路上报过 */
  reported: boolean;
}

/**
 * touchend 捕获层的裁决。
 *
 * - `skip`：这次落点不算点按（还没抬完 / 多指 / 长按 / 拖动）。什么也别做，
 *   尤其**不能**吞掉这条 touchend——分页器还要靠它做滑动收尾与吸附。
 * - `settled`：同一次手势已经由 pointerup 上报过。不再上报，但仍要吞掉
 *   这条 touchend，否则分页器会跑零速度吸附（翻过去又被吸回来）。
 * - `report`：该由触摸这条路补上这一次点按。
 */
export type TouchTapVerdict = 'skip' | 'settled' | 'report';

/**
 * 两条路报同一次手势的时间窗（第二层兜底，见文件头）。
 *
 * 正常顺序下 pointerup 与 touchend 只会差个位数毫秒；80ms 留够余量，
 * 又远小于人手最快连点（150ms 上下）。但主线程被翻页占住时 touchend 会
 * 迟到几百毫秒，所以这一层**不能**当唯一防线。
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

/**
 * 手指抬起时，触摸这条路该不该上报这次点按。
 *
 * @param tap 屏上正在进行的那次手势；没有就是 null
 * @param ev.now 当前时间戳（毫秒）
 * @param ev.remaining 此刻还压在屏上的手指数（`ev.touches.length`）
 * @param ev.longPressMs 超过这个时长算长按
 * @param ev.movePx 位移超过这个距离算拖动
 */
export function touchTapVerdict(
  tap: TapGesture | null | undefined,
  ev: { now: number; remaining: number; longPressMs: number; movePx: number },
): TouchTapVerdict {
  /* 没有手势，或者起手就不是单指：不是点按 */
  if (!tap || tap.fingers !== 1) return 'skip';
  /* 还有手指没抬起来：这次手势还没结束 */
  if (ev.remaining > 0) return 'skip';
  /* pointer 已经报过这一次点按 —— 手势身份优先，不看时间也不看位移：
     翻页已经发生，后面这条 touchend 只是回声，再来一次就是翻两页。 */
  if (tap.reported) return 'settled';
  /* 长按 / 拖动：都是「按住不放」的意图，不该翻页 */
  if (ev.now - tap.at >= ev.longPressMs) return 'skip';
  if (tap.moved >= ev.movePx) return 'skip';
  return 'report';
}

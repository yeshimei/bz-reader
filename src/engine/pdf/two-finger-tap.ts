/**
 * bz-reader · PDF 的两指轻按判定（engine/pdf/two-finger-tap.ts）
 *
 * PDF 不用 foliate 的分页器，触摸序列落在宿主 document 上，和 EPUB 那条
 * iframe 里的路不是同一份；这里只负责「这次抬起算不算两指轻按」，切沉浸
 * 由视图侧接。
 *
 * 真机教训（2026-11-10）：原先要求「所有手指都抬离」才认，可每次抬手都会
 * 把计时状态清掉——第一根抬起时还剩一指，条件不满足、状态又被抹了，第二根
 * 再抬时已经是空的。真人两指不可能同时离屏，于是这个手势永远不触发；而移动端
 * 一进沉浸头栏就藏了，双指是唯一出口，表现就是「进得去、出不来」。
 *
 * 现在的凭据是：两指曾经同时在屏上、间距与各自位移都没怎么动、按得不长。
 * 第一根手指抬起就可以定案，不必等第二根。
 */

export interface FingerPoint {
  x: number;
  y: number;
}

export interface TwoFingerTapState {
  /** 第二根手指落下的时刻：从这里开始计时 */
  startedAt: number;
  /** 落下时两指的间距，用来识别捏合 */
  span: number;
  /** 落下时两指各自的坐标，用来识别平行拖动（间距不变，但手指确实在滑） */
  points: FingerPoint[];
  /** 到目前为止的最大位移：两指间距变化与单指位移取大 */
  moved: number;
}

export interface TwoFingerTapLimits {
  /** 第二指落下到第一指抬起的最长间隔 */
  maxMs: number;
  /** 单指位移 / 两指间距变化的上限 */
  maxMovePx: number;
}

/**
 * PDF 的门槛。
 *
 * EPUB 是 320ms / 10px（1.0.0 真机收紧过）。PDF 这里放宽到 400ms：头栏一藏，
 * 双指就是退出沉浸的唯一入口，手速稍慢就变成「进了出不来」。位移仍守 12px——
 * 太松的话两指滚动、两指捏合松手都会被当成轻按，静读时老跳沉浸。
 */
export const PDF_TWO_FINGER: TwoFingerTapLimits = { maxMs: 400, maxMovePx: 12 };

const distance = (a: FingerPoint, b: FingerPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 两指落下（恰好两根）：开始一轮判定；单指 / 三指都不作数 */
export function beginTwoFinger(
  points: readonly FingerPoint[],
  now: number,
): TwoFingerTapState | null {
  if (points.length !== 2) return null;
  const [a, b] = points;
  return {
    startedAt: now,
    span: distance(a, b),
    points: [
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
    ],
    moved: 0,
  };
}

/**
 * 两指移动：累计最大位移。
 *
 * 手指数量一变（中途又落下第三根）就整轮作废，返回 null——三指手势不是轻按，
 * 而且后面的抬手指顺序也不再对应原来那两指。
 */
export function moveTwoFinger(
  state: TwoFingerTapState,
  points: readonly FingerPoint[],
): TwoFingerTapState | null {
  if (points.length !== 2) return null;
  const [a, b] = points;
  const [fromA, fromB] = state.points;
  let moved = Math.max(state.moved, Math.abs(distance(a, b) - state.span));
  if (fromA) moved = Math.max(moved, Math.hypot(a.x - fromA.x, a.y - fromA.y));
  if (fromB) moved = Math.max(moved, Math.hypot(b.x - fromB.x, b.y - fromB.y));
  return { ...state, moved };
}

/**
 * 抬手指：给这次手势定案。
 *
 * `remaining` 是抬完之后还按在屏上的手指数。还剩两根说明这次抬手不属于
 * 原来那两指，先不判、状态留着；一到一根（或全抬）就定案——**不管后面
 * 还有没有第二次 touchend**，判定完状态即清空。
 */
export function endTwoFinger(
  state: TwoFingerTapState,
  now: number,
  remaining: number,
  limits: TwoFingerTapLimits = PDF_TWO_FINGER,
): { fire: boolean; state: TwoFingerTapState | null } {
  if (remaining >= 2) return { fire: false, state };
  const fire = now - state.startedAt <= limits.maxMs && state.moved <= limits.maxMovePx;
  return { fire, state: null };
}

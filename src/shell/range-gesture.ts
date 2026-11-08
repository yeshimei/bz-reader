/* ============================================================
 * bz-reader · 移动端滑杆的触摸判定（shell/range-gesture.ts）
 *
 * 原生 `input[type=range]` 在触摸按下的一瞬间就把值设成触点位置。
 * 手机上想往下滚设置页、手指刚好扫过滑轨，字号/行距/页边距就已经被
 * 改了（2026-11-08 真机录屏：滚动途中页边距直接跳到 100px）。
 *
 * 触摸不能再交给原生控件：按下只记录，横向移出死区才算拖滑块，
 * 纵向一律放行给页面滚动。这里只有判定与换算，不碰 DOM——真机触摸
 * 在 node 里测不了，至少把边界钉住。绑定在 shell/range-touch.ts。
 * ============================================================ */

/** 死区：位移不超过它时既不拖也不滚，先观望 */
export const RANGE_GESTURE_SLOP = 8;

export type RangeGestureAxis = 'pending' | 'drag' | 'scroll';

/**
 * 这次位移是「拖滑块」还是「滚页面」。
 *
 * `pending` = 还在死区里，调用方什么都不能做——按下瞬间改值正是要修的病。
 * 斜向五五开按滚动处理：误改一次值比少滚一下更烦。
 */
export function decideRangeGesture(dx: number, dy: number, slop = RANGE_GESTURE_SLOP): RangeGestureAxis {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 'pending';
  if (Math.abs(dx) <= slop && Math.abs(dy) <= slop) return 'pending';
  return Math.abs(dx) > Math.abs(dy) ? 'drag' : 'scroll';
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** step 的小数位：吸附后抹掉 1.4000000000000001 这类尾巴 */
function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  const e = s.indexOf('e-');
  if (e >= 0) {
    const base = s.slice(0, e);
    const exp = Number(s.slice(e + 2));
    const baseDecimals = (base.split('.')[1] || '').length;
    return Math.min(20, baseDecimals + (Number.isFinite(exp) ? exp : 0));
  }
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** 按步长吸附并夹回 min..max */
function snap(v: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return clamp(v, min, max);
  const stepped = min + Math.round((v - min) / step) * step;
  return Number(clamp(stepped, min, max).toFixed(stepDecimals(step)));
}

/**
 * 横向拖动后的新值。
 *
 * 以按下时的值为起点、按滑轨宽度折算位移，所以按住轨道右侧也不会先
 * 跳到触点——与原生「按下即跳」的区别就在这里。宽度量为 0（还没参与
 * 布局）时保持原值，宁可这一帧不动。
 */
export function rangeValueFromDrag(
  start: number,
  dx: number,
  width: number,
  min: number,
  max: number,
  step: number,
): number {
  if (!Number.isFinite(start)) return min;
  const span = max - min;
  if (!(width > 0) || !Number.isFinite(width) || !Number.isFinite(dx) || !(span > 0)) {
    return clamp(start, min, max);
  }
  return snap(start + (dx / width) * span, min, max, step);
}

/**
 * 点按滑轨的位置值。
 *
 * 只给「按下后原地抬起」用（tap），滚动时浏览器会 pointercancel，走不到
 * 这里。宽度量为 0 时返回 null：调用方应保持原值，别猜。
 */
export function rangeValueFromPoint(
  x: number,
  left: number,
  width: number,
  min: number,
  max: number,
  step: number,
): number | null {
  const span = max - min;
  if (!(width > 0) || !Number.isFinite(width) || !Number.isFinite(x) || !Number.isFinite(left) || !(span > 0)) {
    return null;
  }
  return snap(min + ((x - left) / width) * span, min, max, step);
}

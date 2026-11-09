/* ============================================================
 * bz-reader · 「这一下算不算点按」（core/tap.ts）
 *
 * 同一个判断以前散在三处、阈值还各不相同：分类菜单用 10px / 600ms、
 * 书卡长按用 520ms、菜单打开后压 click 用 600ms。改一处另外两处不会
 * 跟着变，用户看到的是「有时候点得动、有时候点不动」（2026-11-09 发版复核）。
 *
 * 这里只收口「按下 → 抬起」这一小段：位移、时长、起止时间拿得到就直接判。
 * 引擎那套还要处理多指与 pointer 回声，见 engine/tap-replay.ts——它已经
 * 把阈值参数化，不被这里的常量绑死。
 * ============================================================ */

/** 按下到抬起的位移超过这么多像素：算拖动，不算点按 */
export const TAP_SLOP_PX = 10;

/** 按住超过这么久：算长按（菜单 / 沉浸），不再算点按 */
export const TAP_LONG_PRESS_MS = 600;

/** 长按计时器与「菜单弹出后压住补发 click」共用的窗口 */
export const TAP_MENU_PRESSURE_MS = 600;

export interface TapPoint {
  x: number;
  y: number;
  at: number;
}

export interface TapTolerance {
  maxDistance?: number;
  maxMs?: number;
}

/**
 * 按下与抬起之间算不算一次点按。
 *
 * 任一座标或时间不是有限数（事件被合成、计时器丢帧）一律判「不算」：
 * 宁可漏一次点击，也不要拿 NaN 去和阈值比。
 */
export function isTap(start: TapPoint, end: TapPoint, tol: TapTolerance = {}): boolean {
  const maxDistance = tol.maxDistance ?? TAP_SLOP_PX;
  const maxMs = tol.maxMs ?? TAP_LONG_PRESS_MS;
  if (![start.x, start.y, end.x, end.y, start.at, end.at].every(Number.isFinite)) return false;
  if (end.at - start.at >= maxMs) return false;
  return Math.abs(end.x - start.x) < maxDistance && Math.abs(end.y - start.y) < maxDistance;
}

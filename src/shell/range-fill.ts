/* ============================================================
 * bz-reader · 滑杆填充比例（shell/range-fill.ts）
 *
 * 滑轨的「已填充」段是 CSS 画的：linear-gradient 用 `--fill` 当分界。
 * 纯 CSS 画不出「填充到当前值」，所以 `--fill` 必须由渲染时写进去。
 *
 * 以前只在 input 事件里写（见 actions.ts 的 dispatchInput），首次渲染时
 * `--fill` 缺省 50%：圆点在 18px 的位置、线却填到一半，看起来就是
 * 「滑块上的圆位置偏移」（真机反馈第 6 条）。抽成纯函数，渲染与拖动
 * 共用同一条换算。
 * ============================================================ */

/** 把 min/max/value 换算成 `--fill` 用的百分比字符串；非法值一律 0% */
export function rangeFill(min: number, max: number, value: number): string {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return '0%';
  const pct = ((value - min) / span) * 100;
  const clamped = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  return `${clamped.toFixed(1)}%`;
}

/* ============================================================
 * bz-reader · 头栏图标顺序交换（shell/header-order.ts）
 *
 * 设置页「阅读页图标」的上下移：只在这一台设备**看得见**的项之间交换。
 * 看不见的（手机上的并排 / 对照书籍 / 朗读；非 PDF 书里的页缩略图等）
 * 原位置不动——顺序偏好是一份完整清单，切回另一台设备要原位复现。
 *
 * 为什么抽出来：这段原来内联在动作分发里，按完整顺序交换相邻一位。
 * 手机上两项之间夹着隐藏项时，换掉的是看不见的那颗，画面毫无变化，
 * 用户以为按钮坏了（2026-11-11）。纯函数才测得出「跳过看不见的」。
 * ============================================================ */

export type HeaderMoveDir = -1 | 1;

/**
 * 把 `id` 朝 `dir` 方向移动一位，跳过 `visible` 判为 false 的项。
 *
 * @returns 交换后的新数组；`null` = 动不了（id 不在、到边界、同方向没有
 *   看得见的邻居）——调用方据此保持「禁用」而不是静默无变化。
 */
export function moveHeaderAction(
  order: readonly string[],
  id: string,
  dir: HeaderMoveDir,
  visible: (id: string) => boolean,
): string[] | null {
  const i = order.indexOf(id);
  if (i < 0) return null;

  let j = i + dir;
  while (j >= 0 && j < order.length && !visible(order[j])) j += dir;
  if (j < 0 || j >= order.length) return null;

  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/* ============================================================
 * bz-reader · PDF 页面排布算术（engine/pdf/layout.ts）
 *
 * 滚动容器里「第几页在哪一行」「往下翻一屏到第几页」都是纯算术，搬到这里
 * 单测，视图层只管调用。三处真机上踩过的地方：
 *
 *  1. **双页并排时一行两页 offsetTop 相同**：`pageAt` 的二分只会落到行尾
 *     那页，页码显示 3 而不是 2-3，翻页也会从 3 跳到 5。
 *  2. **第 1 页是封面，单独占一行**：1 | 2-3 | 4-5 …… 不这么排，跨页扫描件
 *     从第 2 页开始每一对都是「右页 + 下一页左页」，整本错开一页。
 *  3. **翻页要按屏跳**：双页模式一次跳一页，另一页当场被跳过。
 * ============================================================ */

/** 允许的行内偏移误差：不同页边框/小数取整会让同行 offsetTop 差 1-2px */
const ROW_SLACK = 2;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 二分找 `y` 落在第几页（1 基），然后回溯到**这一行的第一页**。
 *
 * offsets 是各页的 offsetTop，双页并排时成对相等、必须是非降序。
 * 空数组返回 1（调用方总会先建好骨架，这是兜底）。
 */
export function pageAtRow(offsets: readonly number[], y: number, slack = ROW_SLACK): number {
  if (!offsets.length) return 1;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return rowStartIndex(offsets, lo, slack) + 1;
}

/** index 所在行的第一页下标（0 基）。offsets 非降序时成立 */
export function rowStartIndex(offsets: readonly number[], index: number, slack = ROW_SLACK): number {
  if (!offsets.length) return 0;
  let i = clamp(Math.floor(index), 0, offsets.length - 1);
  while (i > 0 && Math.abs(offsets[i - 1] - offsets[i]) <= slack) i -= 1;
  return i;
}

/** 一屏几页：双页并排是 2，单栏是 1 */
export function pageStep(spread: boolean): number {
  return spread ? 2 : 1;
}

/**
 * 翻一屏之后落在第几页。
 *
 * 双页模式下第 1 页（封面）单独一行，所以：
 *   1 → 2、2 → 4、3 → 4、4 → 6 …
 * 反过来：1 → 1、2 → 1、3 → 2、4 → 2、5 → 4 …
 * 页码一律夹在 [1, total]，到末尾再翻还是末尾（由调用方判「没动」）。
 */
export function turnPage(page: number, total: number, dir: 1 | -1, spread: boolean): number {
  const last = Math.max(1, Math.floor(total));
  const cur = clamp(Math.floor(page), 1, last);
  if (!spread) return clamp(cur + dir, 1, last);
  if (dir > 0) {
    /* 奇数页是某对的第一页（封面除外），往后翻要跨过它自己的右页 */
    const next = cur <= 1 ? 2 : cur + (cur % 2 === 0 ? 2 : 1);
    return clamp(next, 1, last);
  }
  if (cur <= 2) return 1;
  return clamp(cur % 2 === 0 ? cur - 2 : cur - 1, 1, last);
}

/** 当前这一屏显示的页号区间（页码文案用：单栏是 `4`，双页是 `4–5`） */
export function screenRange(page: number, total: number, spread: boolean): { from: number; to: number } {
  const last = Math.max(1, Math.floor(total));
  const cur = clamp(Math.floor(page), 1, last);
  if (!spread) return { from: cur, to: cur };
  if (cur <= 1) return { from: 1, to: 1 };
  const from = cur % 2 === 0 ? cur : cur - 1;
  return { from, to: Math.min(from + 1, last) };
}

/** 页码文案：`4 / 278`、双页 `4–5 / 278`。不依赖语言，纯数字 */
export function pageLabel(page: number, total: number, spread: boolean): string {
  const { from, to } = screenRange(page, total, spread);
  const left = from === to ? String(from) : `${from}–${to}`;
  return `${left} / ${Math.max(1, Math.floor(total))}`;
}

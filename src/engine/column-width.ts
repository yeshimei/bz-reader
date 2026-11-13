/**
 * 每栏的最宽行宽（CSS px）。
 *
 * 分页器（foliate paginator）有一条 `--_max-inline-size`，默认 720px，
 * 意思是「一栏最多 720 宽」。双栏时它被乘成 720×2 = 1440，成为**整块正区
 * 的硬上限**，而且完全不看窗口有多大。
 *
 * 后果是窗口一宽，多出来的地方全变成两侧空白：2.7K 的窗口（阅读区约
 * 2400）上正文只占 1440，两边各空 470 多像素。2026-11-13 用户反馈的
 * 「两边空白特别多、文字在中间挤着」就是它。设置里的页边距只能改 iframe
 * 里 body 的左右 padding（文字到列边框），跟这层是两回事，所以怎么调都没用。
 *
 * 现在的算法：
 *   · 每栏按「阅读区宽 ÷ 栏数」取——窄窗口下与旧行为逐像素一致（正文铺满）；
 *   · 每栏封顶 880——宽屏上把多余空间用上一部分，又不至于一行四五十字。
 *
 * 880 这个数：默认字号 26px 时一行约 30 字，落在中文正文的舒适区间上沿；
 * 再宽就开始「读到行尾找下一行」了。
 */
export const COLUMN_CAP = 880;

/** 拿不到阅读区宽度时退回上游默认值（720），别自作主张把正文撑开 */
export const COLUMN_FALLBACK = 720;

/** 拖动窗口时每次下发都会让分页器整章重排，攒一段时间再发 */
export const COLUMN_APPLY_DELAY = 120;

/**
 * 算出这一屏每栏该多宽。
 *
 * @param viewportWidth 阅读区宽度（CSS px）。0 / 非数时退回 720。
 * @param columns 栏数：1 或 2（其他值按「大于 1 即双栏」处理）。
 */
export function columnMaxInlineSize(viewportWidth: number, columns: number): number {
  const cols = columns > 1 ? 2 : 1;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return COLUMN_FALLBACK;
  const per = Math.floor(Math.floor(viewportWidth) / cols);
  /* 极小窗口也别算出 0：分页器拿到 0 会按「一栏无数列」处理，页面直接空掉 */
  return Math.max(1, Math.min(per, COLUMN_CAP));
}

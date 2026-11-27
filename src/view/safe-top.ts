/**
 * 阅读区顶部让位（`--bzr-safe-top`）的算术。
 *
 * 语义：阅读区顶边之上还要补多少 px，好让章节名与正文避开系统状态栏。
 * Obsidian 移动端通常已按 `--safe-area-inset-top` 把阅读区推下来，那时补 0；
 * 一点没推才补足安全区。
 *
 * 2026-11-27 真机反馈：某些机型 / 状态下这个值被算成几百 px，正文被整段
 * 推到屏幕中下部——表现是「上方一大片空白」，而且只有带章节名的书才出现
 * （`--bzr-safe-top` 只喂给 `.bzs-reader.has-chapter .bzs-rpages` 的
 * padding-top）。剪藏成书每章都有标题，所以同样中招。
 *
 * 旧公式 `安全区 - 阅读区顶边` 没有上限：阅读区顶边为负（沉浸模式把阅读区
 * 上移出屏幕）或安全区变量异常大时，结果会远超一个状态栏该有的高度。
 * 这里加两道约束：补的量不超过安全区本身；安全区本身超过合理上限就视为
 * 变量不可信，退回最小值。正常机型的结果与旧公式逐像素一致。
 */
export const SAFE_TOP_MIN = 44;
/** 状态栏 + 标题栏的合理上限：超过它说明宿主变量不可信 */
export const SAFE_TOP_MAX = 120;

export function safeTopFor(insetPx: number, rootTopPx: number): number {
  const raw = Number.isFinite(insetPx) && insetPx > 0 ? insetPx : SAFE_TOP_MIN;
  const inset = raw > SAFE_TOP_MAX ? SAFE_TOP_MIN : Math.max(raw, SAFE_TOP_MIN);
  const rootTop = Number.isFinite(rootTopPx) ? rootTopPx : 0;
  const need = inset - Math.max(0, rootTop);
  return Math.round(Math.min(inset, Math.max(0, need)));
}

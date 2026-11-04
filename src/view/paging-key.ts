/* ============================================================
 * bz-reader · 翻页键位（view/paging-key.ts）
 *
 * `handleKey()` 里这段映射以前写死在 switch 里。抽出来的真正原因是
 * **滚动模式**（A-26）：flow === 'scroll' 时 foliate 的 paginator 自己
 * 变成 overflow:auto，方向键/空格应该交给浏览器滚动。以前这里照旧
 * `preventDefault()` + `next()`，滚轮滚到一半按一下方向键就整页跳走。
 *
 * 只回答「这个键算不算翻页、翻哪边」；Escape、输入框、修饰键由调用方先排除。
 * ============================================================ */
import type { FlowMode } from '../data/prefs';

export type PagingDirection = 'prev' | 'next';

export interface PagingKeyContext {
  flow: FlowMode;
  /** 竖排正文：物理方向要反（左键 = 下一页） */
  contentVertical: boolean;
}

export function pagingKeyAction(key: string, ctx: PagingKeyContext): PagingDirection | null {
  /* 滚动模式下一律不接管：空格是向下滚一屏，方向键是逐行滚，
     都由 foliate 的容器处理。 */
  if (ctx.flow === 'scroll') return null;
  switch (key) {
    case 'ArrowLeft':
    case 'PageUp':
      return ctx.contentVertical ? 'next' : 'prev';
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
      return ctx.contentVertical ? 'prev' : 'next';
    default:
      return null;
  }
}

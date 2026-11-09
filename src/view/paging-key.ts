/* ============================================================
 * bz-reader · 翻页键位（view/paging-key.ts）
 *
 * `handleKey()` 里这段映射以前写死在 switch 里。抽出来的真正原因是
 * **滚动模式**（A-26）：flow === 'scroll' 时 foliate 的 paginator 自己
 * 变成 overflow:auto，方向键/空格应该交给浏览器滚动。以前这里照旧
 * `preventDefault()` + `next()`，滚轮滚到一半按一下方向键就整页跳走。
 *
 * 左右键的语义**不在**这里定：交给 `tap-direction.ts`，与点按共用同一条
 * 「竖排 / RTL 反转」规则，免得键盘和点按在同一本书上各翻一边。
 *
 * 只回答「这个键算不算翻页、翻哪边」；Escape、输入框、修饰键由调用方先排除。
 * ============================================================ */
import type { FlowMode } from '../data/prefs';
import { arrowDirection, type PagingDirection } from './tap-direction';

export type { PagingDirection };

export interface PagingKeyContext {
  flow: FlowMode;
  /** 竖排正文：物理方向要反（左键 = 下一页） */
  contentVertical: boolean;
  /** RTL 书：左右同样要反 */
  contentRtl?: boolean;
  /**
   * 上下键也算翻页。
   *
   * 只给 PDF 用：EPUB 是「横向分栏」，上下键在分页器里没有对应物，接管了
   * 反而会和「滚一屏」打架。PDF 是纵向滚动的一叠纸，上下就是最自然的翻页键
   * （真机上按 ↓ 没反应，看着像卡住了）。
   */
  verticalKeys?: boolean;
}

export function pagingKeyAction(key: string, ctx: PagingKeyContext): PagingDirection | null {
  /* 滚动模式下一律不接管：空格是向下滚一屏，方向键是逐行滚，
     都由 foliate 的容器处理。 */
  if (ctx.flow === 'scroll') return null;
  const dir = { vertical: !!ctx.contentVertical, rtl: !!ctx.contentRtl };
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowRight':
      return arrowDirection(key, dir);
    /* 上下键不看竖排/RTL：它说的是「下一屏 / 上一屏」，和左右不是一回事 */
    case 'ArrowDown':
      return ctx.verticalKeys ? 'next' : null;
    case 'ArrowUp':
      return ctx.verticalKeys ? 'prev' : null;
    case 'PageUp':
      return dir.vertical ? 'next' : 'prev';
    case 'PageDown':
    case ' ':
      return dir.vertical ? 'prev' : 'next';
    default:
      return null;
  }
}

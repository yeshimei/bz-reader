/* ============================================================
 * bz-reader · 点按方向（view/tap-direction.ts）
 *
 * 「点在哪儿 → 翻哪边」只有这一份规则。以前桌面端在 reader-view 里现算，
 * 键盘在 paging-key 里另算一套，两边对竖排的处理一致但对 RTL 都没处理：
 * 一本阿拉伯语书（`direction: rtl`）明明从右往左排，点右边却翻到下一页，
 * 和整本书的阅读方向顶着来。
 *
 * 三条约定（AGENTS.md 的移动端交互 + 这里的语义反转）：
 *   · 手机是**上下**分区：下方 = 下一页，上方 = 上一页。手指的横向位置本来就
 *     随意，按左右分区会让同一个点忽左忽右；
 *   · 桌面横向分页按**左右一半**分区；
 *   · 竖排正文与 RTL 书都把左右反过来——「前进」在左边。
 * ============================================================ */

export type PagingDirection = 'prev' | 'next';

/** 点按落在可见区的哪一半 */
export type TapSide = 'left' | 'right' | 'top' | 'bottom';

export interface TapDirectionContext {
  /** 竖排正文（writing-mode: vertical-*）：从右往左排字 */
  vertical: boolean;
  /** 书的书写方向是 RTL（阿拉伯语 / 希伯来语等） */
  rtl: boolean;
}

/**
 * 左右哪一边是「下一页」。
 *
 * 竖排让前进跑到左边；RTL 也让前进跑到左边；两者同时成立就抵消回右边——
 * 这与 `pagingKeyAction` 里方向键的映射是**同一条规则**，两处必须一起改。
 */
function leftIsNext(ctx: TapDirectionContext): boolean {
  return !!ctx.vertical !== !!ctx.rtl;
}

export function tapDirection(side: TapSide, ctx: TapDirectionContext): PagingDirection {
  if (side === 'top') return 'prev';
  if (side === 'bottom') return 'next';
  const next = side === 'left' ? leftIsNext(ctx) : !leftIsNext(ctx);
  return next ? 'next' : 'prev';
}

/** 水平方向键 → 翻哪边；与 tapDirection 共用同一条反转规则 */
export function arrowDirection(key: string, ctx: TapDirectionContext): PagingDirection | null {
  if (key === 'ArrowLeft') return tapDirection('left', ctx);
  if (key === 'ArrowRight') return tapDirection('right', ctx);
  return null;
}

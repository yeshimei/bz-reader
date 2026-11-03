/* ============================================================
 * bz-reader · 目录高亮判定（shell/toc-active.ts）
 *
 * 目录项的 label **不唯一**。一本分「引子 / 童年 / 青春期」的书，每部分
 * 下面都有一节叫「-1-」；以前拿 label 比对，翻到任意一个「-1-」时，
 * 所有同名行会一起亮起来（用户截图里同时亮着三行）。
 *
 * href 才是唯一的（章节文件 + 锚点），所以优先按 href 比；只有引擎没给
 * href 的老快照才退回 label。抽成纯函数是为了能直接测——目录渲染在
 * DOM 里，翻页时又只切 class，不抽出来就只能靠真机看。
 * ============================================================ */

/** 目录项里参与比对的两个字段 */
export interface TocItemRef {
  label: string;
  href: string;
}

/** 当前阅读位置：href 优先，label 兜底 */
export interface TocActiveRef {
  label: string;
  href?: string;
}

/**
 * 这一项目的目录项是不是「当前章节」。
 *
 * - 有 href 时只认 href：同名的其它节不会跟着亮。
 * - 没 href 时才退回 label（引擎还没给 relocate 的极早期）。
 */
export function isTocItemActive(item: TocItemRef, active: TocActiveRef): boolean {
  if (active.href) return item.href === active.href;
  return !!active.label && item.label === active.label;
}

/* ============================================================
 * bz-reader · PDF 头栏动作（view/pdf-actions.ts）
 *
 * 只解决一件事：**动作要在点击时现取 PDF 视图，不能在建按钮时取。**
 *
 * 头栏按钮比引擎早出生：阅读视图先按 EPUB 的形态把那排图标建好，PDF
 * 引擎 mount 完才有 `host.pdfUi`。而且按钮会被复用（`ensureHeaderActions`
 * 只在找不到同名按钮时才新建），复用时不会重挂 click 监听——当初闭包里
 * 抓到的 `undefined` 就跟着这颗按钮一辈子，四颗 PDF 图标连同「排版」
 * 全都点了没反应。真机上唯一的表现是「图标在、点了没动静」。
 *
 * 所以这里收的是一个 `getPdf()` 而不是一个 `PdfUi`；调用方（头栏 / ⋮）
 * 都传 `() => this.host.pdfUi`。
 * ============================================================ */
import type { PdfUi } from '../engine/reader-engine';

export type PdfCopyAnchor = { right: number; bottom: number } | null;

export interface PdfActionRun {
  /** 排版：PDF 打开旋转/单双页/翻页面板；EPUB 走原来的字号行距面板 */
  type(): void;
  thumb(): void;
  copy(anchor?: PdfCopyAnchor): void;
  export(): void;
}

/**
 * @param getPdf   点击时现取，没有 PDF 视图就返回 undefined（安静退出）
 * @param typography 非 PDF 时的「排版」去处
 *
 * 「回到上一处」不在这里（2026-11-10）：EPUB 也有这条历史了，视图层直接走
 * `host.historyUi`，不再借 PDF 的壳。
 */
export function pdfActionRun(
  getPdf: () => PdfUi | undefined,
  typography: () => void,
): PdfActionRun {
  return {
    type: () => {
      const ui = getPdf();
      if (ui) ui.toggleLayout();
      else typography();
    },
    thumb: () => getPdf()?.toggleThumbs(),
    copy: (anchor) => getPdf()?.openCopyMenu(anchor),
    export: () => getPdf()?.exportPage(),
  };
}

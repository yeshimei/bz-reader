/* ============================================================
 * bz-reader · PDF 缩放适配（engine/pdf/fit.ts）
 *
 * 纯计算，不碰 DOM，方便单测。两个概念要分清：
 *   · **适配基准**（fitSize）：整本 PDF 里最宽、最高的那一页。
 *     不能拿第 1 页当基准——封面常常比正文窄。真机上踩过：《千亿个太阳》
 *     封面 471.8pt 宽、正文 707pt 宽，按封面算出来 356%，正文页于是宽度
 *     涨到阅读区的 1.45 倍，右边整块被裁掉。
 *   · **缩放比例**（scale）：同一本里所有页共用一个比例，页面尺寸不同的
 *     PDF 才会保持「宽窄不一」的原貌。
 * ============================================================ */

export interface PdfBox {
  width: number;
  height: number;
}

/** 开书时的缩放档。`auto` = 老行为（窄屏适合宽度，否则原大） */
export type PdfZoomMode = 'auto' | 'width' | 'page' | 'actual';

/** 一页尺寸都没有时的兜底：Letter，比 0 强（0 会让缩放算成无穷大） */
const LETTER: PdfBox = { width: 612, height: 792 };

/** 阅读区还没量出来时的兜底宽度/高度 */
const FALLBACK_AVAIL = 600;

export function pickFitSize(sizes: ReadonlyArray<PdfBox | undefined | null>): PdfBox {
  let width = 0;
  let height = 0;
  for (const size of sizes) {
    if (!size) continue;
    const w = Number(size.width);
    const h = Number(size.height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue;
    /* 宽、高各自取最大：适配要保证「任何一页都不超出」，不是「最大那页」 */
    if (w > width) width = w;
    if (h > height) height = h;
  }
  if (width <= 0 || height <= 0) return { ...LETTER };
  return { width, height };
}

/** 可用边长：减掉两侧留白；还没量出来（0 或负）时退到兜底值 */
function usableEdge(value: number, pad: number): number {
  const inner = Number(value) - pad * 2;
  if (Number.isFinite(inner) && inner > 0) return inner;
  return Math.max(1, FALLBACK_AVAIL - pad * 2);
}

export function fitScaleFor(
  mode: 'width' | 'page',
  page: PdfBox,
  avail: PdfBox,
  pad: number,
  min = 0.2,
  max = 8,
): number {
  const pageWidth = Math.max(1, Number(page?.width) || 0);
  const pageHeight = Math.max(1, Number(page?.height) || 0);
  const byWidth = usableEdge(avail?.width ?? 0, pad) / pageWidth;
  const byHeight = usableEdge(avail?.height ?? 0, pad) / pageHeight;
  const picked = mode === 'page' ? Math.min(byWidth, byHeight) : byWidth;
  if (!Number.isFinite(picked)) return min;
  return Math.min(max, Math.max(min, picked));
}

/**
 * 100% 摆不下整页宽吗？（窄分栏、手机竖屏都会）
 *
 * 放不下还硬按 100% 开局，右边整块就被裁在屏幕外——手机上 A4 正文只剩半页。
 * 这种情况下首屏该退到「适合宽度」。宽度还没量出来（0）时不下判断：
 * 等 ResizeObserver 报一次，免得在 0 宽的时候把书放大到离谱。
 */
export function needsFitWidth(pageWidth: number, availWidth: number, pad: number, scale = 1): boolean {
  const page = Number(pageWidth);
  const avail = Number(availWidth);
  if (!(page > 0) || !(avail > 0)) return false;
  return page * scale > avail - pad * 2;
}

/**
 * 开书时该用哪种缩放（设置页「PDF · 默认缩放」）。
 *
 * `auto` 是以前写死的行为：窄屏（手机竖屏、窄分栏）适合宽度，摆得下就按原大。
 * 其余三档是用户的显式选择，不再看屏宽——选了「实际大小」的人，多半是要
 * 拿 100% 去比着看排版。
 */
export function resolveInitialZoom(
  mode: PdfZoomMode,
  narrow: boolean,
): 'width' | 'page' | 'actual' {
  if (mode === 'width' || mode === 'page' || mode === 'actual') return mode;
  return narrow ? 'width' : 'actual';
}

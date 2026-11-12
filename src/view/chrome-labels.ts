/* ============================================================
 * bz-reader · 两角小字的显示口径（view/chrome-labels.ts）
 *
 * 沉浸模式的两角小字：左上章节名、右下页码。
 *
 * 2026-11-12 用户改的口径：
 *   · 非全屏时章节名只出现在**头栏标题**里（同色同透明度），左上角不再重复；
 *   · 全屏时头栏藏起来，章节名回到左上角；
 *   · 页码两种模式都留（桌面非全屏没别处显示进度）；
 *   · 手机的非全屏本来就不露两角（头栏有标题、底栏有进度）。
 *
 * 只做模式判断：设置里的「章节名」开关、PDF 之类由调用处再叠。
 * ============================================================ */

export interface ChromeLabelModeInput {
  /** 当前是不是沉浸（全屏） */
  immersive: boolean;
  /** 手机形态（含桌面 force-mobile 验收） */
  mobileShell: boolean;
  /** 当前引擎是不是 PDF（PDF 右下角有页码浮条，不再画两角） */
  pdf: boolean;
}

export interface ChromeLabelMode {
  /** 左上角显示章节名 */
  chapter: boolean;
  /** 右下角显示页码 */
  page: boolean;
}

export function chromeLabelMode(i: ChromeLabelModeInput): ChromeLabelMode {
  if (i.pdf) return { chapter: false, page: false };
  return {
    /* 章节名只在头栏不在的地方补位：全屏头栏是 display:none */
    chapter: i.immersive,
    page: i.immersive || !i.mobileShell,
  };
}

/* ============================================================
 * bz-reader · 两角小字的显示口径（view/chrome-labels.ts）
 *
 * 沉浸模式的两角小字：左上章节名、右下页码。
 *
 * 2026-11-12 用户改的口径：
 *   · 非全屏时章节名只出现在**头栏标题**里（同色同透明度），左上角不再重复；
 *   · 桌面非全屏的页码搬进宿主状态栏；用户在设置里把状态栏关掉时，
 *     页码回正文右下角（状态栏那条路走不通，就退回原样）；
 *   · 全屏时头栏、状态栏都藏起来，章节名回左上角、页码回右下角；
 *   · 手机没有宿主状态栏，口径与原来一致（只有全屏露两角）。
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
  /** 桌面页码是不是已经挂进宿主状态栏（状态栏被用户关掉时为 false） */
  statusBar: boolean;
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
    /* 桌面非沉浸的页码在状态栏里；状态栏被关掉、或全屏（状态栏也藏），
       页码就回正文右下角。手机没有状态栏这一路，口径不变。 */
    page: i.immersive || (!i.mobileShell && !i.statusBar),
  };
}

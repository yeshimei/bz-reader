/* ============================================================
 * bz-reader · 头栏标题（view/header-title.ts）
 *
 * 头栏那一行字（2026-11-12 用户要求）：
 *   1. 内容是**当前章节名**，不是书名。书名在 tab、书架、侧栏「阅读中」里
 *      到处都是；「现在读到哪」只有头栏这一处能一直看见。
 *      章节名暂时拿不到（封面、目录页、书还没定位）时退回书名，别空着。
 *   2. 左缘对齐正文左缘。桌面正文是居中排版的（宽屏时左右各留好几百 px），
 *      宿主默认把标题居中放在头栏里，和正文左缘差出一大截。
 *
 * 为什么自绘而不是改宿主的 `.view-header-title`：
 *   · 宿主有 `.is-focused .workspace-leaf.mod-active .view-header-title`，
 *     特异性 4 个类，窗口一聚焦就把颜色写回正常色——失焦时灰、聚焦时黑
 *     （2026-11-12 用户反馈）；
 *   · 宿主容器是 flex 居中，左对齐还得反过来改它的布局。
 * 收掉宿主那一行、自己画一个，颜色与位置都归我们管。
 *
 * 只做算术：rect 由 reader-view 量好传进来，这里能单测。
 * ============================================================ */

/** 标题与左侧按钮区 / 右侧动作区之间至少留的空隙（px） */
export const HEAD_TITLE_GAP = 10;

/**
 * 头栏实际显示的那一行字。
 *
 * 桌面：章节名优先（拿不到退回书名）——书名在 tab、书架、侧栏都有，
 *       「现在读到哪」只有头栏这一处能一直看见。
 * 手机：只显示书名（2026-11-12 用户要求移动端别改）——窄屏 fetch 标题空间少，
 *       书名更能说明「在读哪本」。
 * 都没有时留空，不写「阅读」这种没有信息量的兜底词。
 */
export function headerTitleText(
  bookTitle: string | undefined,
  chapter: string | undefined,
  mode: 'desktop' | 'mobile' = 'desktop',
): string {
  const book = (bookTitle ?? '').trim();
  if (mode === 'mobile') return book;
  return (chapter ?? '').trim() || book;
}

export interface HeadTitleBoxInput {
  /** 头栏左缘在视口中的位置 */
  headerLeft: number;
  /** 头栏宽度 */
  headerWidth: number;
  /** 阅读区（.bzs-reader）左缘在视口中的位置 */
  rootLeft: number;
  /** 正文左缘距阅读区左边的距离（引擎里的 contentLeftInset） */
  contentLeft: number;
  /** 左侧按钮区（返回 / 前进）右缘在视口中的位置 */
  leftRegionRight: number;
  /** 右侧动作区左缘在视口中的位置；null = 还没建出来 */
  actionsLeft: number | null;
  /** 与两块按钮区之间留的空隙 */
  gap: number;
}

export interface HeadTitleBox {
  /** 相对头栏左缘的左偏移 */
  left: number;
  /** 相对头栏右缘的右偏移 */
  right: number;
}

/**
 * 自绘标题该占的矩形（相对头栏的左右偏移）。
 *
 * 左缘取「正文左缘」，但不越过左侧按钮区——窗口窄到正文左缘落到按钮下面时
 * 退回按钮右侧，否则标题会压在返回 / 前进上。右缘只留到动作区左边，
 * 长章节名由 ellipsis 收尾，不会伸到图标底下。
 *
 * 头栏还没量出宽度（沉浸、换 tab 的空窗）时返回 null，调用方保持原样。
 */
export function headTitleBox(i: HeadTitleBoxInput): HeadTitleBox | null {
  if (!Number.isFinite(i.headerWidth) || i.headerWidth <= 0) return null;
  const gap = Number.isFinite(i.gap) ? Math.max(0, i.gap) : 0;
  const target = i.rootLeft - i.headerLeft + i.contentLeft;
  const minLeft = i.leftRegionRight - i.headerLeft + gap;
  const left = Number.isFinite(target) ? Math.max(minLeft, target) : minLeft;
  const right = i.actionsLeft === null
    ? gap
    : Math.max(gap, i.headerLeft + i.headerWidth - i.actionsLeft + gap);
  return { left: Math.round(left), right: Math.round(right) };
}

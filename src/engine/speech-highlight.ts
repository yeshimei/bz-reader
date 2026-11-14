/* ============================================================
 * bz-reader · 朗读高亮（engine/speech-highlight.ts）
 *
 * 2026-11-14 换的实现：**不画矩形**，把「当前这一句的 Range」注册进
 * iframe 自己的 CSS Custom Highlight。
 *
 * 以前是在宿主里画绝对定位的 div：rect 从 iframe 的 `getClientRects()`
 * 拿，乘 scale、减 span.x0、加 viewBox.left —— 四个量串成一条链，翻页 /
 * 缩放 / 双栏下任何一环抖一下就整体偏。真机表现是「离线朗读的高亮偏了
 * 一点，实时朗读不偏」（离线要边念边翻，每一页都重算一次）。
 *
 * 交给浏览器排版的直接好处：
 *   · 翻页、缩放、单双栏、竖排、深色主题全部自动正确，零坐标计算；
 *   · 高亮挂在 Range 上跟文字走，先翻页再画也不会错；
 *   · 换句 / 停止只是换一条 Highlight，不碰 DOM，不用清理旧元素。
 *
 * 兼容：`CSS.highlights` 是 2025-06 起的新基线（Chromium 105+、Safari 17+）。
 * 老环境返回 false，调用方退回 foliate 的 overlayer（仍在 iframe 内画 SVG，
 * 只是要自己 redraw）。
 *
 * 跨 realm 注意：`CSS` 与 `Highlight` 都必须是**书页文档自己的**。拿宿主
 * 的构造器往 iframe 的注册表里塞，行为未定义（csswg #13888）。
 * ============================================================ */

/** 注册名。一个文档同时只有一句在念，不需要多份。 */
const KEY = 'bzr-speech';

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

interface HighlightRealm {
  Highlight?: new (...ranges: Range[]) => unknown;
  CSS?: { highlights?: HighlightRegistryLike };
}

function realmOf(doc: Document): HighlightRealm | null {
  const win = doc.defaultView;
  return win ? (win as unknown as HighlightRealm) : null;
}

/** 这个文档支不支持 CSS Custom Highlight（决定走 Range 还是退回 overlayer） */
export function speechHighlightSupported(doc: Document): boolean {
  const realm = realmOf(doc);
  return Boolean(realm?.Highlight && realm.CSS?.highlights);
}

/**
 * 把这一句高亮出来。返回 false 表示这个环境不支持，调用方该走兜底。
 *
 * 每次都整体覆盖：同一时刻只有一个「正在念的句子」，先删再设，不会越积越多。
 */
export function applySpeechHighlight(doc: Document, range: Range): boolean {
  const realm = realmOf(doc);
  const registry = realm?.CSS?.highlights;
  const HighlightCtor = realm?.Highlight;
  if (!registry || !HighlightCtor) return false;
  try {
    registry.set(KEY, new HighlightCtor(range));
    return true;
  } catch {
    return false;
  }
}

/** 撤掉高亮（停止朗读、换页、念完）。文档已经拆了也不报错。 */
export function clearSpeechHighlight(doc: Document): void {
  const registry = realmOf(doc)?.CSS?.highlights;
  if (!registry) return;
  try {
    registry.delete(KEY);
  } catch {
    /* 文档跟着章一起拆了 */
  }
}

/**
 * 高亮样式。`::highlight()` 能吃的属性有限（背景、前景、下划线、阴影），
 * 做不出「下半笔刷」那种画法——底色够用，浓度跟强调色走。
 */
export function speechHighlightCss(accent: string): string {
  const color = String(accent ?? '').trim() || '#9a7434';
  return `::highlight(${KEY}){background-color: color-mix(in srgb, ${color} 18%, transparent);}`;
}

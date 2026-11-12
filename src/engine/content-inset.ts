/**
 * 正文左右缘到阅读区左右边的距离（px）。
 *
 * 页码要贴着正文右缘、章节名要贴着正文左缘，但正文在 iframe 里，隔着三层：
 *   · 分页器会把整个 iframe **横向平移**（每翻一页平移一列宽，真机上
 *     `frame.left` 量出来是 13.54px，不是 0）——这一截以前漏了，两角小字
 *     就比正文靠左/靠右十几像素；
 *   · iframe 里的 html 还有列间距的一半（分页器 `gap / 2`）；
 *   · body 还有用户设的页边距（prefs.margin）。
 *
 * 三截加起来才是「正文边缘」的真实位置。只做算术，DOM 由调用方量好传进来，
 * 这样能单测，也能在拿不到 iframe 时由调用方传 0 退化。
 */
export interface ContentInsetInput {
  /** 阅读区宽度 */
  rootWidth: number;
  /** iframe 左边缘相对阅读区左边（分页器平移后的实际位置） */
  frameLeft: number;
  /** iframe 里 html 的 padding-left（列间距的一半） */
  htmlPadLeft: number;
  /** iframe 里 body 的 offsetWidth（含 padding） */
  bodyWidth: number;
  bodyPadLeft: number;
  bodyPadRight: number;
}

export interface ContentInset {
  /** 正文左缘距阅读区左边 */
  left: number;
  /** 正文右缘距阅读区右边 */
  right: number;
}

export function contentInset(i: ContentInsetInput): ContentInset {
  const contentLeft = i.frameLeft + i.htmlPadLeft + i.bodyPadLeft;
  const contentRight = i.frameLeft + i.htmlPadLeft + i.bodyWidth - i.bodyPadRight;
  return {
    left: Math.round(Math.max(0, contentLeft)),
    right: Math.round(Math.max(0, i.rootWidth - contentRight)),
  };
}

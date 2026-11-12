/**
 * 正文左右缘到阅读区左右边的距离（px）。
 *
 * 页码要贴着正文右缘、章节名要贴着正文左缘，但正文在 iframe 里，隔着三层：
 *   · 分页器把整个 iframe **横向平移**（每翻一页挪一整页），`frame.left` 会变成
 *     -3912 这种大数——直接拿它当偏移，两角小字会跑到屏幕外；
 *   · iframe 里的 html 还有列间距的一半（分页器 `gap / 2`）；
 *   · body 还有用户设的页边距（prefs.margin）。
 *
 * 关键是先求出「iframe 相对**当前这一页**的起点挪了多少」：
 * `frameLeft % pageWidth`（再补成正数）。翻到第几页这个余数都一样，
 * 真机上恒为 13.54px——它才是两角小字要补的那一截。
 *
 * `pageWidth` 是 html 的 CSS 宽度：单栏手机上一栏宽，桌面双栏时是「两栏 + 中间
 * 列间距」的整页宽（分页器一次翻一整页）。右缘因此也从整页右边算，双栏时页码
 * 才会落在右侧那一栏的外沿，而不是屏幕中间。
 *
 * 只做算术，DOM 由调用方量好传进来，这样能单测，也能在拿不到 iframe 时
 * 由调用方传 0 退化。
 */
export interface ContentInsetInput {
  /** 阅读区宽度 */
  rootWidth: number;
  /** iframe 左边缘在宿主里的位置（分页器平移后的实际值，可正可负） */
  frameLeft: number;
  /** iframe 里 html 的宽度 = 一整页（分页器平移的步长）；拿不到传 0 */
  pageWidth: number;
  /** iframe 里 html 的 padding-left（列间距的一半） */
  htmlPadLeft: number;
  /** iframe 里 html 的 padding-right */
  htmlPadRight: number;
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
  /* 拿不到页宽（滚动模式 / 换章空窗）时按「正文铺满阅读区」算：
     宁可退回老行为，也别把页码推到屏幕外 */
  const pageWidth = i.pageWidth > 0 ? i.pageWidth : i.rootWidth;
  const shift = pageWidth > 0 ? ((i.frameLeft % pageWidth) + pageWidth) % pageWidth : 0;
  const contentLeft = shift + i.htmlPadLeft + i.bodyPadLeft;
  const contentRight = shift + pageWidth - i.htmlPadRight - i.bodyPadRight;
  return {
    left: Math.round(Math.max(0, contentLeft)),
    right: Math.round(Math.max(0, i.rootWidth - contentRight)),
  };
}

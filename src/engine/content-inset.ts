/**
 * 正文左右缘到阅读区左右边的距离（px）。
 *
 * 页码要贴着正文右缘、章节名要贴着正文左缘，但正文在 iframe 里，隔着三层：
 *   · 分页器把整个 iframe **横向平移**（每翻一页挪一列），`frame.left` 会变成
 *     -18503 这种大数——直接拿它当偏移，两角小字会跑到屏幕外；
 *   · iframe 里的 html 还有列间距的一半（分页器 `gap / 2`）；
 *   · body 还有用户设的页边距（prefs.margin）。
 *
 * 关键是先求出「iframe 相对**当前这一列**的起点挪了多少」：
 * `frameLeft % columnWidth`（再补成正数）。翻到第几页这个余数都一样，
 * 真机上恒为 13.54px——它才是两角小字要补的那一截。
 *
 * 只做算术，DOM 由调用方量好传进来，这样能单测，也能在拿不到 iframe 时
 * 由调用方传 0 退化。
 */
export interface ContentInsetInput {
  /** 阅读区宽度 */
  rootWidth: number;
  /** iframe 左边缘在宿主里的位置（分页器平移后的实际值，可正可负） */
  frameLeft: number;
  /** iframe 里 html 的宽度 = 一列的宽度（分页器平移的步长）；拿不到传 0 */
  columnWidth: number;
  /** iframe 里 html 的 padding-left（列间距的一半） */
  htmlPadLeft: number;
  /** iframe 里 body 的 CSS 宽度（一列，含 padding） */
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
  const shift =
    i.columnWidth > 0 ? (((i.frameLeft % i.columnWidth) + i.columnWidth) % i.columnWidth) : 0;
  const contentLeft = shift + i.htmlPadLeft + i.bodyPadLeft;
  const contentRight = shift + i.htmlPadLeft + i.bodyWidth - i.bodyPadRight;
  return {
    left: Math.round(Math.max(0, contentLeft)),
    right: Math.round(Math.max(0, i.rootWidth - contentRight)),
  };
}

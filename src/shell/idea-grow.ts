/* ============================================================
 * bz-reader · 想法输入框按内容撑高（shell/idea-grow.ts）
 *
 * 想法常常不止一句话：回车换行是用户自己在排版（写三条、分行对照），
 * 一个永远只有一行高的输入框会把它们全藏在滚动条后面——写的人看不见
 * 自己刚写的那句，改也无从改起。
 *
 * 上限写在样式表里（overlay.css 的 `.bzs-idea-card .txt { max-height }`），
 * 这里把它读回来当裁切线：CSS 是唯一数值来源，JS 不再藏一份同样的魔数。
 * 读不到（测试环境、样式被主题盖掉）才退回「屏高 40%」。
 *
 * 高度计算是纯函数，量高度那一下留给 DOM（量不到就不动，见 ideaFitHeight）。
 * ============================================================ */

/**
 * 算出输入框该有多高。
 *
 * @param contentHeight 内容需要的高度（textarea.scrollHeight）
 * @param maxHeight     上限；`NaN` / 0 / 负数当作没有上限
 * @returns 该写进 `style.height` 的整数；`null` = 量不到，别动它
 */
export function ideaFitHeight(contentHeight: number, maxHeight: number): number | null {
  /* 还没布局（display:none、刚挂进 DOM）时 scrollHeight 是 0：照着它写，
     框会塌成一条线，比不长高难看得多。 */
  if (!Number.isFinite(contentHeight) || contentHeight <= 0) return null;
  const cap = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : Infinity;
  return Math.min(Math.round(contentHeight), cap);
}

/** 上限：优先取样式表算出来的 max-height */
export function ideaMaxPx(el: HTMLElement): number {
  try {
    const v = parseFloat(getComputedStyle(el).maxHeight);
    if (Number.isFinite(v) && v > 0) return v;
  } catch {
    /* 没有 getComputedStyle（node 里的单测）就走下面的兜底 */
  }
  const vh = typeof window === 'undefined' ? 0 : window.innerHeight;
  return vh > 0 ? Math.round(vh * 0.4) : 320;
}

/**
 * 按内容把输入框撑到该有的高度。
 *
 * 先清成 auto 再读 scrollHeight：留着上一轮写死的高度，scrollHeight 量的是
 * 那个高度里的内容，删字之后框再也缩不回去。
 *
 * @returns 高度真的变了没有——没变就别重排浮层（每敲一个字都重排会抖）
 */
export function fitIdeaInput(ta: HTMLTextAreaElement): boolean {
  const before = ta.style.height;
  ta.style.height = 'auto';
  const h = ideaFitHeight(ta.scrollHeight, ideaMaxPx(ta));
  if (h === null) {
    ta.style.height = before;
    return false;
  }
  ta.style.height = `${h}px`;
  return ta.style.height !== before;
}

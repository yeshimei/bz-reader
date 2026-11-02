/* bz-reader · DOM 小工具（ui/dom.ts）
 * 只有最常用的三个：建元素、设属性、清空。刻意不做虚拟 DOM。 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setAttrs(node: HTMLElement, attrs: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) node.removeAttribute(k);
    else node.setAttribute(k, v);
  }
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** 百分比 → 人话（0% 不显示「0%」，显示「未读」） */
export function percentLabel(p: number): string {
  if (!p || p <= 0) return '未读';
  if (p >= 0.999) return '已读完';
  return `${Math.round(p * 100)}%`;
}

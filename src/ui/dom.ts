/* ============================================================
 * bz-reader · DOM 小工具（ui/dom.ts）
 *
 * 只有几个最常用的：建元素、封面、滑杆、分段选择。刻意不做虚拟 DOM。
 * 图标一律用 CSS 画（和原型一致）：随 currentColor 变色，不占包体。
 * ============================================================ */

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

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** 百分比 → 人话（0% 不显示「0%」，显示「未读」） */
export function percentLabel(p: number): string {
  if (!p || p <= 0) return '未读';
  if (p >= 0.999) return '已读完';
  return `${Math.round(p * 100)}%`;
}

/** 时长 → 「1 小时 12 分」/「23 分钟」/「不到 1 分钟」 */
export function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return '不到 1 分钟';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`;
}

/**
 * 书名 → 封面色。色相由 djb2 哈希决定，同一本书永远同一个颜色。
 * 明度压到 22–31%：封面要能托住白字，又不能抢界面里唯一那个强调色。
 */
export function coverColors(seed: string): { c1: string; c2: string } {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  const n = h >>> 0;
  const hue = n % 360;
  const sat = 16 + ((n >> 7) % 10);
  const light = 28 + ((n >> 13) % 5);
  return { c1: `hsl(${hue} ${sat}% ${light}%)`, c2: `hsl(${hue} ${sat + 3}% ${light - 7}%)` };
}

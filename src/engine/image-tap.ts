/* ============================================================
 * bz-reader · 点图判定（engine/image-tap.ts）
 *
 * 书页在 iframe 里，点图这一下从 host 的 emitTap 出来，target 是另一个
 * realm 的元素——不能用 instanceof，只看 tagName / getAttribute。
 *
 * 图片优先于链接：EPUB 常把图套在 <a href> 里（点图跳原文），先判链接
 * 就把图吃掉了。所以 emitTap 里的图片判断必须排在链接判断之前。
 * ============================================================ */

export interface ImageHit {
  src: string;
  kind: 'img' | 'svg';
}

interface FakeEl {
  tagName?: string;
  getAttribute?: (name: string) => string | null;
  currentSrc?: string;
}

/** 目标是不是一张可放大的图。开关关时一律返回 null，照旧翻页。 */
export function imageHitOf(target: EventTarget | null, enabled: boolean): ImageHit | null {
  if (!enabled || !target) return null;
  const el = target as FakeEl;
  const tag = String(el.tagName ?? '').toLowerCase();
  if (tag === 'img') {
    const src = String(el.currentSrc || el.getAttribute?.('src') || '').trim();
    return src ? { src, kind: 'img' } : null;
  }
  if (tag === 'image') {
    const src = String(el.getAttribute?.('href') || el.getAttribute?.('xlink:href') || '').trim();
    return src ? { src, kind: 'svg' } : null;
  }
  return null;
}

/* ============================================================
 * bz-reader · 目录按章名找 href（engine/toc.ts）
 *
 * AI 回答的来源只带章名——画像里存不下 CFI，也不该存（换版本 = 另一本书）。
 * 点来源时拿章名回目录换一次 href，再交给 goToHref。
 *
 * 找不到就返回空串，调用方据此**不动**：把用户扔到书的开头，比什么都不做
 * 更像坏了。
 * ============================================================ */

export interface TocNode {
  label?: string;
  href?: string;
  subitems?: readonly TocNode[];
}

/** 章名 → href；同名取第一个（先出现的才是作者给的入口），没有 href 的跳过 */
export function findTocHref(toc: readonly TocNode[] | undefined | null, title: string): string {
  const want = String(title ?? '').trim();
  if (!want) return '';
  const walk = (items: readonly TocNode[] | null | undefined): string => {
    for (const it of items ?? []) {
      if (String(it.label ?? '').trim() === want && String(it.href ?? '').trim()) {
        return String(it.href).trim();
      }
      const deep = walk(it.subitems);
      if (deep) return deep;
    }
    return '';
  };
  return walk(toc);
}

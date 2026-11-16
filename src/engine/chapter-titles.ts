/* ============================================================
 * bz-reader · 画像里的章名（engine/chapter-titles.ts）
 *
 * 建索引要逐章读正文，每块要记「这一块出自哪一章」。章名只有目录里有
 * （`book.toc` 的 label），所以拿 section 的标识回目录换一次。
 *
 * **EPUB 的 section 只有 `id`，没有 `href`**：foliate 造 section 时写的是
 * `id: item.href`（包内文件路径），从来没设过 `href`。2026-11-17 之前这里
 * 读的是 `section.href`，EPUB 上恒为 undefined，于是每一章都退化成
 * 「第 1 节 / 第 2 节 …」；AI 来源按这个假名字回目录找章，目录里是
 * 「第五章」，找不到，最后落到「全书第一次出现这句话」——真机上就是
 * 「依据跳转全是错的」。
 *
 * TXT 与剪藏本两个引擎自己造 section：它们 `id` 是 `txt-0` / `clip-0`
 * 这类内部串，真正的文件路径在 `href`（目录用的也是这个）。所以匹配
 * 两个都要试，不能只看一个。
 * ============================================================ */
import type { FoliateTOCItem } from '../types/foliate';

/** 只要能提供标识就算一章：EPUB 给 id，TXT / 剪藏本给 href */
export interface ChapterSectionLike {
  id?: string;
  href?: string;
}

/** 目录里 href → 章名；去掉 `#fragment`，同一文件出现多次取第一条 */
export function tocLabelMap(toc: readonly FoliateTOCItem[] | undefined | null): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (items: readonly FoliateTOCItem[] | undefined | null): void => {
    for (const it of items ?? []) {
      const href = String(it?.href ?? '').split('#')[0].trim();
      const label = String(it?.label ?? '').trim();
      if (href && label && !map.has(href)) map.set(href, label);
      walk(it?.subitems);
    }
  };
  walk(toc);
  return map;
}

/**
 * 每一章的显示名：目录里的真名；目录里对不上才用调用方给的兜底名。
 *
 * `fallback` 由调用方给（引擎层不写界面文案）：EPUB / TXT 是「第 N 节」，
 * PDF 那边整条路不经过这里。
 */
export function chapterTitles(
  toc: readonly FoliateTOCItem[] | undefined | null,
  sections: ReadonlyArray<ChapterSectionLike | null | undefined>,
  fallback: (index: number) => string,
): string[] {
  const map = tocLabelMap(toc);
  return sections.map((section, i) => {
    const id = String(section?.id ?? '').split('#')[0].trim();
    const href = String(section?.href ?? '').split('#')[0].trim();
    /* 两个都试：EPUB 只有 id，TXT / 剪藏本的 id 是内部串、href 才是目录键 */
    return (id ? map.get(id) : '') || (href ? map.get(href) : '') || fallback(i);
  });
}

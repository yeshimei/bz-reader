/**
 * bz-reader · 剪藏正文的图片寻址（data/clip-asset.ts）
 *
 * 真机 bug（2026-11-13）：正文里的图写成 `![[xxx.jpg]]` 短名，文件实际在
 * bz 的图片文件夹（默认 CONFIG/APPENDIX），阅读器却只按库根路径找，
 * 找不到就落成「[图片]」——整篇文章的图全丢。
 *
 * 解析顺序（由准到宽）：
 *   1. 正文里写了目录（`附件/a.jpg`）→ 按库内路径直查；
 *   2. 短名 → 交给 Obsidian 的链接解析（它知道同名附件在哪个目录）；
 *   3. 仍找不到 → 全库按文件名兜底（老库、索引未就绪时）。
 *
 * 抽成纯函数是为了能单测：宿主那边把 app.metadataCache / vault 适配成
 * 下面三个查询就行，判定与顺序都在这里。
 */

export interface ClipAssetCandidate {
  /** 库内路径（斜杠分隔） */
  path: string;
  /** 文件名（含扩展名） */
  name: string;
}

export interface ClipAssetLookup<T extends ClipAssetCandidate> {
  /** 库内路径直查（app.vault.getAbstractFileByPath） */
  byPath(path: string): T | null;
  /** Obsidian 链接解析（app.metadataCache.getFirstLinkpathDest） */
  byLink(name: string): T | null;
  /** 全库文件清单（兜底同名） */
  all(): T[];
}

/** 正文里给的名字 → 库内文件；找不到返回 null（调用方渲染「[图片]」占位） */
export function pickClipImageFile<T extends ClipAssetCandidate>(
  lookup: ClipAssetLookup<T>,
  raw: string,
): T | null {
  const clean = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (!clean) return null;

  const direct = lookup.byPath(clean);
  if (direct) return direct;

  const linked = lookup.byLink(clean);
  if (linked) return linked;

  /* 兜底：同名文件。多个同名取第一个（文件清单顺序稳定，不会每次随机跳） */
  const base = clean.split('/').pop() || clean;
  return lookup.all().find((f) => f.name === base) ?? null;
}

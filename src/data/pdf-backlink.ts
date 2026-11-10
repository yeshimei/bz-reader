/* ============================================================
 * bz-reader · PDF 反链高亮（data/pdf-backlink.ts）
 *
 * 笔记里 `[[论文.pdf#page=7&rect=…]]` 这种链接，打开 PDF 时应该能在页面上
 * 看到「这句被人引过」——PDF++ 的 backlink highlighting 就是这个。
 *
 * 数据来源是 Obsidian 的链接索引（resolvedLinks），所以这里只做两件
 * 纯粹的事：把一条指向本书的链接解析成「页 + 位置」，再按笔记去重。
 * 真正的全库扫描在调用方，方便测试也方便加缓存。
 * ============================================================ */

import { parsePdfLinkHash, type PdfLinkRect, type PdfLinkSelection } from './pdf-link';

export interface PdfBacklinkSource {
  /** 写链接的那篇笔记的路径 */
  path: string;
  /** 链接目标原文，可能带 `#page=…` 子路径 */
  link: string;
}
export interface PdfBacklinkHit {
  sourcePath: string;
  /** 1 基页码 */
  page: number;
  selection?: PdfLinkSelection;
  rect?: PdfLinkRect;
  color?: string;
  /**
   * 本插件自己复制出来的精确定位串（`pdf/4/29-81`）。
   *
   * 自己复制的高亮链接只带 `bzr=`，没有 PDF++ 那套 `selection/rect`——
   * 不把它带上，这类反链在页面上只能退化成一整页的「被引过」竖线。
   */
  locator?: string;
  /**
   * 链接的显示别名（`[[x.pdf#page=3|第 3 页那段]]` 里的后半截）。
   *
   * 页面上悬停反链框时用它当提示：只报笔记名不够，用户想知道「引的是哪句」。
   * 没有别名就是 undefined——不拿链接原文凑数，那只是一串路径。
   */
  label?: string;
}

/** 去掉 `[[ ]]` 外壳：Obsidian 链接索引里的 `original` 带它（EPUB 那份解析也用） */
export function unwrapHref(href: string): string {
  let raw = String(href ?? '').trim();
  if (raw.startsWith('[[')) raw = raw.slice(2);
  if (raw.endsWith(']]')) raw = raw.slice(0, -2);
  return raw;
}

/** `[[x.pdf#page=3|别名]]` 里的别名；没有别名返回 undefined */
export function aliasOfHref(href: string): string | undefined {
  const raw = unwrapHref(href);
  const bar = raw.lastIndexOf('|');
  if (bar < 0) return undefined;
  const alias = raw.slice(bar + 1).trim();
  return alias || undefined;
}

/** 从链接里取 `#` 之后的子路径；没有子路径返回空串 */
export function subpathOfHref(href: string): string {
  const raw = unwrapHref(href);
  const at = raw.indexOf('#');
  return at >= 0 ? raw.slice(at + 1) : '';
}

/**
 * 一批「指向本书的链接」→ 页面上标得出来的命中。
 *
 * 只认带页码的 PDF++ 子路径：`#section` 这类普通锚点、写成 `#page=0` 的坏链接
 * 一律丢掉。同一篇笔记里同一条链接写两遍只算一次——反链列表重复没有意义。
 */
export function pdfBacklinkHits(sources: ReadonlyArray<PdfBacklinkSource>): PdfBacklinkHit[] {
  const seen = new Set<string>();
  const out: PdfBacklinkHit[] = [];
  for (const source of sources) {
    const path = String(source?.path ?? '').trim();
    /* `[[书.pdf#page=3&rect=…|别名]]` 里的别名不进子路径 */
    const sub = subpathOfHref(source?.link ?? '').split('|')[0];
    if (!path || !sub) continue;
    const target = parsePdfLinkHash(sub);
    if (!target) continue;
    const key = `${path}|${target.page}|${target.selection ? 's' : ''}${target.rect ? 'r' : ''}|${
      target.selection ? Object.values(target.selection).join(',') : ''
    }|${target.rect ? [target.rect.left, target.rect.top, target.rect.width, target.rect.height].join(',') : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourcePath: path,
      page: target.page,
      selection: target.selection,
      rect: target.rect,
      color: target.color,
      locator: target.locator,
      label: aliasOfHref(source?.link ?? ''),
    });
  }
  return out;
}

/** 这一页上的反链（侧栏「只看本页」用；不要改原数组） */
export function hitsOnPage(
  hits: ReadonlyArray<PdfBacklinkHit>,
  page: number,
): PdfBacklinkHit[] {
  const n = Math.max(1, Math.floor(Number(page) || 1));
  return hits.filter((hit) => hit.page === n);
}

/** 同一页上有几条反链（侧栏/提示里说「第 7 页被引 3 次」） */
export function backlinkCountByPage(hits: ReadonlyArray<PdfBacklinkHit>): Map<number, number> {
  const map = new Map<number, number>();
  for (const hit of hits) map.set(hit.page, (map.get(hit.page) ?? 0) + 1);
  return map;
}

/**
 * 从 Obsidian 的链接索引里捞出「指向这本书」的所有链接。
 *
 * 只看目标路径，不关心书的格式：PDF 与 EPUB 的反链解析共用这一份扫描
 * （PDF 用 `pdfBacklinkHits`，EPUB 用 `epubBacklinkHits`）。
 *
 * 先用 `resolvedLinks` 反查哪些笔记链到了它（一次 O(链接数) 的扫描），
 * 再只对这些笔记读 cache 拿子路径——直接遍历全库 cache 在几万篇笔记的库里
 * 要几秒，开书时会明显卡一下。
 *
 * **坑**：笔记 cache 里的 `link.link` 是带子路径的（`x.pdf#page=7&…`），
 * 而 `getFirstLinkpathDest` 只认纯路径，带 `#` 一律返回 null。不过滤就去查，
 * 结果是所有 PDF 反链全被丢掉、页面上一个框也画不出来（真机上验证过）。
 */
export function collectPdfBacklinks(
  app: {
    metadataCache: {
      resolvedLinks?: Record<string, Record<string, number>>;
      getFileCache(file: unknown): { links?: ReadonlyArray<{ link: string; original?: string }> } | null;
      getFirstLinkpathDest?(linkpath: string, sourcePath: string): { path: string } | null;
    };
    vault: { getFileByPath(path: string): unknown };
  },
  bookPath: string,
): PdfBacklinkSource[] {
  const cache = app?.metadataCache;
  if (!cache) return [];
  /* 按「当前 metadataCache 的解析版本」缓存整份索引结果，一次全量扫描被同一
     时刻开多本书共享，不再每本书各扫一遍大库的 resolvedLinks。版本号用
     resolvedLinks 的对象引用——Obsidian 重建索引会换一个新对象，引用一变就
     判定为变了。索引内部的数据我们一份都不攥着（只存自己算出来的 byPath）。 */
  const version = cache.resolvedLinks;
  if (!indexCache || indexCache.version !== version) {
    indexCache = { version, byPath: scanBacklinkIndex(app) };
  }
  return indexCache.byPath.get(bookPath) ?? [];
}

/**
 * 一次全量扫描：把 resolvedLinks 里所有链接解析成「书路径 → 指向它的链接」。
 * 结果按书路径分桶，开任意一本书都复用同一份，不必每本重扫。
 * 只存自己算出来的数组，不长期持有 resolvedLinks 对象（Obsidian 会给新对象）。
 */
function scanBacklinkIndex(
  app: Parameters<typeof collectPdfBacklinks>[0],
): Map<string, PdfBacklinkSource[]> {
  const cache = app.metadataCache;
  const resolved = cache?.resolvedLinks ?? {};
  const byPath = new Map<string, PdfBacklinkSource[]>();
  for (const source of Object.keys(resolved)) {
    const file = app.vault.getFileByPath(source);
    if (!file) continue;
    const links = cache.getFileCache(file)?.links ?? [];
    for (const link of links) {
      /* 子路径不能进 getFirstLinkpathDest：查不到目标，整条反链就没了 */
      const linkpath = String(link?.link ?? '').split('#')[0];
      if (!linkpath) continue;
      let dest: { path: string } | null = null;
      try {
        dest = cache.getFirstLinkpathDest?.(linkpath, source) ?? null;
      } catch {
        dest = null;
      }
      if (!dest) continue;
      const arr = byPath.get(dest.path) ?? [];
      arr.push({ path: source, link: link.original || link.link });
      byPath.set(dest.path, arr);
    }
  }
  return byPath;
}

/**
 * 整份索引按 metadataCache 的解析版本缓存，跨书共享。
 *
 * `resolvedLinks` 是一次 O(笔记数) 的扫描，大库里每次开书都要几百毫秒；
 * 索引没动就没必要重算。版本变了（引用不同）或 `invalidatePdfBacklinks` 被调，
 * 整份作废，宁可重扫也不留旧账——书改名后旧路径的缓存也不会再被命中。
 */
let indexCache: { version: unknown; byPath: Map<string, PdfBacklinkSource[]> } | null = null;

export function invalidatePdfBacklinks(): void {
  indexCache = null;
}

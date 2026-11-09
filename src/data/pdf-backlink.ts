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
}

/** 从链接里取 `#` 之后的子路径；没有子路径返回空串 */
export function subpathOfHref(href: string): string {
  const raw = String(href ?? '');
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
    });
  }
  return out;
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
  const cached = memo.get(bookPath);
  if (cached) return cached;

  const cache = app?.metadataCache;
  const resolved = cache?.resolvedLinks ?? {};
  const out: PdfBacklinkSource[] = [];
  for (const source of Object.keys(resolved)) {
    const targets = resolved[source];
    if (!targets || !(bookPath in targets)) continue;
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
      if (dest?.path !== bookPath) continue;
      out.push({ path: source, link: link.original || link.link });
    }
  }
  memo.set(bookPath, out);
  return out;
}

/**
 * 一本书记一份扫描结果。
 *
 * `resolvedLinks` 是一次 O(笔记数) 的扫描，大库里每次开书都要几百毫秒；
 * 索引没动就没必要重算。索引一动（插件在 metadataCache 的 `resolved`
 * 事件里调用 `invalidatePdfBacklinks`）整份作废，宁可重扫也不留旧账。
 */
const memo = new Map<string, PdfBacklinkSource[]>();

export function invalidatePdfBacklinks(): void {
  memo.clear();
}

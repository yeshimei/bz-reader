/* ============================================================
 * bz-reader · EPUB 反链（data/epub-backlink.ts）
 *
 * 笔记里从书里复制出来的划线长这样：
 *   `[[bz-reader/books/围城.epub#bzr-cfi=epubcfi(… )&t=…&c=重印前记|重印前记]]`
 *
 * PDF 那套按 `#page=` 认页；EPUB 没有页码，定位是 `bzr-cfi=` 的 CFI。
 * 这里只做解析：一条指向这本书的链接 → 「引的是哪一句、在哪一章」。
 * 全库扫描在调用方（和 PDF 共用 `collectPdfBacklinks` 的缓存）。
 *
 * 只认**带定位**的链接：`[[围城.epub]]` 光有书名，点进去也不知道去哪，
 * 列出来只会让用户点了个寂寞。
 * ============================================================ */
import { isPdfLocator } from '../engine/pdf/locator';
import { aliasOfHref, unwrapHref, type PdfBacklinkSource } from './pdf-backlink';
import { parseWikilinkHref } from './wikilink';

export interface EpubBacklinkHit {
  /** 写链接的那篇笔记的路径 */
  sourcePath: string;
  /** 书内定位（CFI）；老链接 / 手写链接可能只有原文片段 */
  cfi?: string;
  /** 原文前若干字（CFI 失效时靠它搜） */
  text?: string;
  /** 章节名（链接里的 `c=`），侧栏按它分组 */
  chapter?: string;
  /** 章节内百分比 0..1（链接里的 `p=`，划线链接通常没有） */
  pct?: number;
  /** 链接的显示别名（`|重印前记`），行标题用 */
  label?: string;
}

/**
 * 一批「指向本书的链接」→ EPUB 页签排得出来的命中。
 *
 * `bookPath` 给了就只认这本书的链接（调用方扫描时已按书过滤，这里再挡一道：
 * 传进来的 `link` 是博客里的原文，路径写错一个字符就会挂到别的书上）。
 *
 * 同一篇笔记里同一条链接写两遍只算一次（重复的引用列表没有意义）；
 * 同一篇笔记引了两个不同位置则两处都留——用户要的是「哪几句被引过」。
 */
export function epubBacklinkHits(
  sources: ReadonlyArray<PdfBacklinkSource>,
  bookPath?: string,
): EpubBacklinkHit[] {
  const want = String(bookPath ?? '').trim();
  const seen = new Set<string>();
  const out: EpubBacklinkHit[] = [];
  for (const source of sources) {
    const path = String(source?.path ?? '').trim();
    if (!path) continue;
    /* `[[书.epub#…|别名]]`：别名不进子路径，先切掉再解析 */
    const href = unwrapHref(source?.link ?? '').split('|')[0].trim();
    if (!href) continue;
    const parsed = parseWikilinkHref(href);
    if (!parsed) continue;
    if (want && parsed.vaultPath !== want) continue;
    const target = parsed.target;
    /* 既没 CFI 也没原文片段 = 定位不了 */
    if (!target.cfi && !target.text) continue;
    /* PDF++ 形状的 `#page=` 是另一份数据（pdfBacklinkHits 管） */
    if (target.cfi && isPdfLocator(target.cfi)) continue;
    const key = `${path}|${target.cfi ?? ''}|${target.text ?? ''}|${target.chapter ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourcePath: path,
      cfi: target.cfi,
      text: target.text,
      chapter: target.chapter,
      pct: target.pct,
      label: aliasOfHref(source?.link ?? ''),
    });
  }
  return out;
}

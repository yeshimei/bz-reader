/* ============================================================
 * bz-reader · PDF 大纲 → 目录（engine/pdf/outline.ts）
 *
 * PDF 的目录不是「章节」，是书签树：每个节点带一个 dest，dest 指向页。
 * 这里只做两件事：
 *   · 把能解析出页码的节点映射成 foliate 形状的目录项（href 用 pdf 定位串）；
 *   · 解析不出页码的节点不丢子树，把子项提升到同级——目录上少一个坏
 *     书签，总比整段目录消失好。
 *
 * 没有书签的 PDF 在这种书里很常见。`synthPdfToc` 按固定页数切段，
 * 让目录面板至少能用来跳页，而不是一片空白。
 * ============================================================ */

export interface PdfOutlineNode {
  title?: string;
  dest?: unknown;
  items?: PdfOutlineNode[];
}

export interface PdfTocItem {
  label: string;
  href: string;
  subitems?: PdfTocItem[];
}

/** 书签树最多走这么深：坏 PDF 里见过自引用的节点 */
const MAX_DEPTH = 8;

/**
 * @param pageOf 把 dest 解析成 1 基页码；解析不出返回 null。
 *               pdf.js 的 dest 既可能是数组，也可能是命名目标字符串，
 *               解析是异步的，所以由调用方预先消化成同步回调。
 */
export function mapPdfOutline(
  nodes: readonly PdfOutlineNode[] | null | undefined,
  pageOf: (dest: unknown) => number | null,
  depth = 0,
): PdfTocItem[] {
  if (!nodes?.length || depth >= MAX_DEPTH) return [];
  const out: PdfTocItem[] = [];
  for (const node of nodes) {
    if (!node) continue;
    const page = node.dest == null ? null : pageOf(node.dest);
    const children = mapPdfOutline(node.items, pageOf, depth + 1);
    if (page === null || !Number.isFinite(page) || page < 1) {
      out.push(...children);
      continue;
    }
    const title = String(node.title ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({
      label: title || `第 ${page} 页`,
      href: `pdf/${page}`,
      ...(children.length ? { subitems: children } : {}),
    });
  }
  return out;
}

/**
 * 没有书签时的占位目录：每 `step` 页一项。
 * `step <= 0` 时整本合成一项（一本 5 页的 PDF 不该出现 5 个目录行）。
 */
export function synthPdfToc(numPages: number, step = 10): PdfTocItem[] {
  const n = Math.max(0, Math.floor(Number.isFinite(numPages) ? numPages : 0));
  if (!n) return [];
  const size = step > 0 ? Math.max(1, Math.floor(step)) : n;
  const out: PdfTocItem[] = [];
  for (let page = 1; page <= n; page += size) {
    const end = Math.min(n, page + size - 1);
    out.push({
      label: page === end ? `第 ${page} 页` : `第 ${page}–${end} 页`,
      href: `pdf/${page}`,
    });
  }
  return out;
}

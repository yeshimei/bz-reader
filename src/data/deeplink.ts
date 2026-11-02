/* ============================================================
 * bz-reader · 位置链接（data/deeplink.ts）
 *
 * 一条划线 → 一个 obsidian:// 链接 → 粘进任何笔记 → 点一下跳回原文那一句。
 *
 * 为什么不生成 `[[书名#章节]]`：
 *   书不是 vault 里的笔记，wiki 链接解析不到。「真双链」需要给每本书
 *   生成一个占位笔记，粒度也只能到章节。通往原文句子的路只有一条：
 *   **obsidian:// 协议 + CFI**。它看起来像链接、点得动、精确到句子，
 *   只是不会出现在反向链接面板里。
 *
 * 定位做了三级降级，因为「同一本书换了个文件」是真实会发生的：
 *   1. CFI 精确跳（99% 命中）
 *   2. CFI 失效 → 在该章里搜链接里存的「原文前 20 字」
 *   3. 再不行 → 按链接里的章节百分比落个大概位置
 * 所以链接里同时写了 cfi / t / c / p 四个参数。
 * ============================================================ */
import type { Bookmark, Highlight, ReaderBook } from './schema';

/** 协议名：注册在 plugin.registerObsidianProtocolHandler('bz-reader', …) */
export const PROTOCOL = 'bz-reader';

export interface LinkTarget {
  bookId: string;
  /** EPUB CFI（首选定位于此） */
  cfi?: string;
  /** 原文前若干字，CFI 失效时用来搜 */
  text?: string;
  /** 章节标题，给降级搜索限定范围，也用来写链接文字 */
  chapter?: string;
  /** 章节内百分比 0..1，最后兜底 */
  pct?: number;
}

/** CFI 里塞全文会撑爆链接，20 字足够在章节里唯一定位一次 */
const SNIPPET = 20;

function snippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET);
}

export function targetOfMark(book: ReaderBook, h: Highlight): LinkTarget {
  return {
    bookId: book.id,
    cfi: h.cfiRange,
    text: snippet(h.text),
    chapter: h.chapterTitle?.trim() || undefined,
  };
}

export function targetOfBookmark(book: ReaderBook, b: Bookmark): LinkTarget {
  return {
    bookId: book.id,
    cfi: b.cfi,
    text: b.label,
    chapter: b.chapterTitle?.trim() || undefined,
    pct: b.percent,
  };
}

function enc(v: string | number | undefined): string | null {
  if (v === undefined || v === null || v === '') return null;
  return encodeURIComponent(String(v));
}

/** 生成 `obsidian://bz-reader?book=…&cfi=…&t=…&c=…&p=…` */
export function protocolUrl(t: LinkTarget): string {
  const q: string[] = [];
  const push = (k: string, v: string | number | undefined): void => {
    const e = enc(v);
    if (e) q.push(`${k}=${e}`);
  };
  push('book', t.bookId);
  push('cfi', t.cfi);
  push('t', t.text);
  push('c', t.chapter);
  push('p', t.pct);
  return `obsidian://${PROTOCOL}?${q.join('&')}`;
}

/**
 * 解析协议参数。Obsidian 传进来的值已经 decode 过，这里不要再 decode 一次，
 * 否则原文里的 `%` 会被二次解释成乱码。
 */
export function parseProtocolParams(p: Record<string, string> | null | undefined): LinkTarget | null {
  if (!p) return null;
  const bookId = p.book;
  if (!bookId) return null;
  const pct = p.p === undefined ? undefined : Number(p.p);
  return {
    bookId,
    cfi: p.cfi || undefined,
    text: p.t || undefined,
    chapter: p.c || undefined,
    pct: Number.isFinite(pct) ? pct : undefined,
  };
}

function displayName(book: ReaderBook): string {
  return book.meta.title?.trim() || '未命名';
}

function authorPart(book: ReaderBook): string {
  const a = book.meta.author?.trim();
  return a ? ` ${a}` : '';
}

/** 形式一：只有一行可点击的链接 */
export function linkInline(book: ReaderBook, t: LinkTarget): string {
  const where = t.chapter ? ` · ${t.chapter}` : '';
  return `[《${displayName(book)}》${where}](${protocolUrl(t)})`;
}

/** 形式二（默认）：引文 + 出处，读书笔记最常见的样子 */
export function linkQuote(book: ReaderBook, h: Highlight): string {
  const t = targetOfMark(book, h);
  const body = h.text.replace(/\s*\n\s*/g, ' ').trim();
  const where = t.chapter ? ` · ${t.chapter}` : '';
  const lines = [`> ${body}`, `> ——《${displayName(book)}》${authorPart(book)}${where} [原文](${protocolUrl(t)})`];
  if (h.comment?.trim()) lines.push('>', `> **想法**：${h.comment.trim()}`);
  return lines.join('\n');
}

/**
 * 形式三：双向链接。
 *
 * 前两种是 obsidian:// 协议——点得动、精确到句子，但不进反链面板。
 * 想要「这本书的笔记里看得到所有引用过它的地方」，只有 wiki 链接能做到：
 * 它指向导出稿（`<导出目录>/书名.md`）里的 `## 章节`。
 *
 * 链接里不写目录：Obsidian 按文件名解析，导出目录换了也照样认得。
 * 导出稿不存在时点它会问「是否创建」——这是 Obsidian 处理未建链接的
 * 标准行为，比指到一个死路径好。
 */
export function wikiLink(book: ReaderBook, h: Highlight): string {
  const clean = (v: string): string => v.replace(/[\[\]|#^]/g, ' ').replace(/\s+/g, ' ').trim();
  const name = clean(displayName(book));
  const chapter = clean(h.chapterTitle ?? '');
  if (!chapter) return `[[${name}]]`;
  return `[[${name}#${chapter}|${name} · ${chapter}]]`;
}

/** 导出到 Markdown 时用的行内链接（只要 URL，不要外层的 []） */
export function rawUrl(book: ReaderBook, h: Highlight): string {
  return protocolUrl(targetOfMark(book, h));
}

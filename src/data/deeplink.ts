/* ============================================================
 * bz-reader · 位置链接（data/deeplink.ts）
 *
 * 一条划线 → 一个 obsidian:// 链接 → 粘进任何笔记 → 点一下跳回原文那一句。
 *
 * 2026-11-05 起双链也能到句子了（data/wikilink.ts 产 `[[书.epub#定位|文字]]`），
 * 这里保留 obsidian:// 有两个理由：
 *   1. **Live Preview 里双链接管不了点击**——那条路是编辑器装饰器，不经过
 *      post-processor，点开只会落到上次阅读位置；
 *   2. **老链接已经散在用户笔记里**，协议处理器不能撤。
 * 两条路共用同一套定位参数与三级降级（CFI → 原文片段 → 章节百分比）。
 *
 * 早先这里写着「书不是 vault 里的笔记，wiki 链接解析不到」——只对了一半：
 * `[[]]` 解析的是 vault 里的**文件**，不要求是 .md，书本来就是文件。
 * 真正缺的只是子路径那一段没人认，靠 shell/link-postprocessor.ts 补上。
 *
 * 定位做了三级降级，因为「同一本书换了个文件」是真实会发生的：
 *   1. CFI 精确跳（99% 命中）
 *   2. CFI 失效 → 在该章里搜链接里存的「原文前 20 字」
 *   3. 再不行 → 按链接里的章节百分比落个大概位置
 * 所以链接里同时写了 cfi / t / c / p 四个参数。
 * ============================================================ */
import type { Bookmark, Highlight, ReaderBook } from './schema';
import { kbLinkMarkdown } from './kb-link';
import { t } from '../i18n';

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

/* 双链（data/wikilink.ts）也用这一份：两处各写一套清洗规则，
   迟早会在「换行怎么压、方括号清不清」上走散。 */
export function snippet(text: string): string {
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
  /* 书名与章节名来自 EPUB 元数据（外部文件，不可信）。不清方括号的话，
     `书名](https://外站)` 会把 Markdown 链接提前闭合，外站地址变成用户
     笔记里可点的链接（A-20）。 */
  const title = cleanLabel(displayName(book)) || '未命名';
  const chapter = t.chapter ? cleanLabel(t.chapter) : '';
  const where = chapter ? ` · ${chapter}` : '';
  return `[《${title}》${where}](${protocolUrl(t)})`;
}

/** 形式二（默认）：引文 + 出处，读书笔记最常见的样子 */
export function linkQuote(book: ReaderBook, h: Highlight): string {
  const target = targetOfMark(book, h);
  const body = h.text.replace(/\s*\n\s*/g, ' ').trim();
  const where = target.chapter ? ` · ${target.chapter}` : '';
  const lines = [`> ${body}`, `> ——《${displayName(book)}》${authorPart(book)}${where} [原文](${protocolUrl(target)})`];
  if (h.comment?.trim()) lines.push('>', `> **想法**：${h.comment.trim()}`);
  /* 知识盒链接与想法分家：各占一行，粘贴出去以后仍然是可点的双链 */
  for (const kb of h.kb ?? []) {
    const link = kbLinkMarkdown(kb.path);
    if (link) lines.push('>', `> **${t(kb.kind === 'term' ? 'export.kb.term' : 'export.kb.passage')}**：${link}`);
  }
  return lines.join('\n');
}

/**
 * 形式三：原文链接（`[划线文字](obsidian://bz-reader?…)`）。
 *
 * 双链（`[[书.epub#定位|文字]]`）已由 data/wikilink.ts 接管，这里留下的是
 * Live Preview 里仍然更可靠的那条：编辑器不跑 post-processor，双链的子路径
 * 没人认，点开只会打开书、落到上次位置；obsidian:// 则由协议处理器精确落地。
 * 老链接也一直走这条路。
 */

/**
 * 链接文字里的方括号要清掉（`]` 会提前闭合 `[文字]`），
 * 其余标点、竖线、井号都原样保留——那是原文的一部分。
 */
export function cleanLabel(v: string): string {
  return v
    .replace(/[[\]]/g, ' ')
    /* 中文之间的换行不该变成空格（与 data/export.ts 的 oneLine 同一规则） */
    .replace(/\s+/g, ' ')
    .replace(/([\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])\s+(?=[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef])/g, '$1')
    .trim();
}

export interface LinkTextInput {
  /** 划线原文 / 选区文字；空时退回书名 */
  text: string;
  cfiRange?: string;
  chapterTitle?: string;
  /**
   * PDF 划词时给 PDF++ 用的文字块定位。
   * 别的格式用不到，留空即可——它只影响 PDF 的双链怎么写。
   */
  pdfSelection?: { beginIndex: number; beginOffset: number; endIndex: number; endOffset: number };
  /** PDF 框选区域（页面坐标 pt） */
  pdfRect?: { left: number; top: number; width: number; height: number };
  /** PDF 高亮颜色名（黄/绿/蓝/粉），写进链接的 `color=` */
  color?: string;
}

/**
 * 划线或划词 → 一段可粘进笔记的行内链接。
 *
 * 导出仍走这里；高级版的「双向链接」由
 * data/wikilink.ts 单独拼，两条路共用同一套定位与清洗。
 */
export function linkOfText(book: ReaderBook, input: LinkTextInput): string {
  const target: LinkTarget = {
    bookId: book.id,
    cfi: input.cfiRange,
    text: snippet(input.text),
    chapter: input.chapterTitle?.trim() || undefined,
  };
  const label = cleanLabel(input.text) || `《${displayName(book)}》`;
  return `[${label}](${protocolUrl(target)})`;
}

export function linkOfMark(book: ReaderBook, h: Highlight): string {
  return linkOfText(book, { text: h.text, cfiRange: h.cfiRange, chapterTitle: h.chapterTitle });
}

/** 导出到 Markdown 时用的行内链接（只要 URL，不要外层的 []） */
export function rawUrl(book: ReaderBook, h: Highlight): string {
  return protocolUrl(targetOfMark(book, h));
}

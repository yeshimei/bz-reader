/* ============================================================
 * bz-reader · 纯文本书（engine/txt.ts）
 *
 * foliate 没有 TXT loader，这里把一段文本造成它认得的 book 对象：
 *   sections[].load()       → blob URL（分页器只收 string，会话内有效）
 *   sections[].createDocument() → Document（搜索用，foliate 的 search 需要）
 *   splitTOCHref / getTOCFragment → 打开进度计算（SectionProgress 依赖它俩存在）
 *
 * 章节切分策略：先认「第 X 章 / Chapter N / 卷 X / 序章」这类标题行，
 * 认不出就按 12000 字硬切。**硬切只影响目录，不影响阅读**——
 * 切错了最多是目录里出现「第 3 节」这种名字。
 * ============================================================ */
import type { FoliateBook, FoliateSection, FoliateTOCItem } from '../types/foliate';

/* 注意别在 CJK 后面加 \b：JS 的 \b 只认 ASCII 词字符，
   「第一章 初见」在 章 与空格之间没有词边界，加了就永远匹配不上。 */
const CHAPTER_RE = /^\s*(?:第\s*[0-9零一二三四五六七八九十百千两]+\s*[章节回卷部篇]|序章|楔子|引子|尾声|后记|番外|Chapter\s+\d+)/i;
const HARD_SPLIT_CHARS = 12000;

interface Chapter {
  title: string;
  text: string;
  size: number;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 段落化：空行分段；中文 txt 常见单换行，单换行也当分段（句子已用缩进标识） */
function toParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const inner = escapeHtml(block).replace(/\n/g, '<br>');
      return `<p>${inner}</p>`;
    })
    .join('\n');
}

function splitChapters(text: string): Chapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chapters: Chapter[] = [];
  let title = '正文';
  let buf: string[] = [];

  const flush = (): void => {
    const body = buf.join('\n').trim();
    if (body) chapters.push({ title, text: body, size: body.length });
    buf = [];
  };

  for (const line of lines) {
    if (CHAPTER_RE.test(line) && line.trim().length <= 40) {
      flush();
      title = line.trim();
      continue;
    }
    buf.push(line);
  }
  flush();

  if (chapters.length > 1) return chapters;

  // 认不出章节：按字数硬切，标题给「第 N 节」，至少让目录可用
  const all = text.trim();
  if (all.length <= HARD_SPLIT_CHARS) return [{ title: '正文', text: all, size: all.length }];
  const out: Chapter[] = [];
  for (let i = 0, n = 1; i < all.length; i += HARD_SPLIT_CHARS, n++) {
    const seg = all.slice(i, i + HARD_SPLIT_CHARS);
    out.push({ title: `第 ${n} 节`, text: seg, size: seg.length });
  }
  return out;
}

function htmlDoc(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${bodyHtml}</body></html>`;
}

/**
 * 造一本 TXT 书。`raw` 是整份文本（已按 UTF-8 解码）。
 * 返回的对象形状对齐 README 里 foliate 的契约，可直接交给 View.open。
 */
export function makeTxtBook(raw: string, meta: { title: string; author?: string }): FoliateBook {
  const chapters = splitChapters(raw);
  const urls: string[] = [];

  const sections: FoliateSection[] = chapters.map((c, i) => {
    const href = `${i}.xhtml`;
    const html = htmlDoc(c.title, `<h2>${escapeHtml(c.title)}</h2>${toParagraphs(c.text)}`);
    return {
      id: `txt-${i}`,
      href,
      linear: 'yes',
      size: c.size,
      load: async () => {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        urls.push(url);
        return url;
      },
      createDocument: async () => new DOMParser().parseFromString(html, 'text/html'),
      unload: () => undefined,
      resolveHref: () => href,
    };
  });

  const toc: FoliateTOCItem[] = chapters.map((c, i) => ({ label: c.title, href: `${i}.xhtml` }));

  const book: FoliateBook = {
    metadata: { title: meta.title, author: meta.author, language: 'zh' },
    toc,
    sections,
    rendition: { layout: 'reflowable' },
    dir: 'ltr',
    // 有这两个，View 才会建 SectionProgress —— 否则百分比永远是 0
    splitTOCHref: async (href: string) => {
      const [file, frag] = String(href).split('#');
      return [file, frag ?? null];
    },
    getTOCFragment: (doc: Document, id: string) => doc.getElementById(id),
    resolveHref: (href: string) => {
      const [file, frag] = String(href).split('#');
      const index = chapters.findIndex((_, i) => `${i}.xhtml` === file);
      return {
        index: index >= 0 ? index : 0,
        anchor: frag ? (doc: Document) => doc.getElementById(frag) ?? 0 : 0,
      };
    },
    isExternal: (href: string) => /^https?:/i.test(href),
    destroy: () => {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
    },
  };

  return book;
}

/** 字数统计（中文按字符，英文按词，粗估即可——bz 侧只用来排序/展示） */
export function countWords(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + words;
}

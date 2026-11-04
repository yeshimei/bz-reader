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

/** 一章的 HTML。默认实现：章题 + 段落化；抽出来是为了能被替换/被测试计数 */
function chapterHtml(title: string, text: string): string {
  return htmlDoc(title, `<h2>${escapeHtml(title)}</h2>${toParagraphs(text)}`);
}

export interface TxtBookOptions {
  /**
   * 章节 HTML 生成器。默认 `chapterHtml`；测试用它断言「没 load 就不生成」，
   * 将来换轻量渲染器也只改这一处。
   */
  renderChapter?: (title: string, text: string) => string;
}

/**
 * 造一本 TXT 书。`raw` 是整份文本（已解码；见 engine/encoding.ts）。
 * 返回的对象形状对齐 README 里 foliate 的契约，可直接交给 View.open。
 *
 * **章节 HTML 是惰性的（A-33）**：以前一上来就给所有章节拼 HTML，一本
 * 800 章的网文打开第一页要先把整本几 MB 文本段落化 + 转义 + 拼字符串，
 * 主线程卡死，字符串还一整天挂在 section 闭包里。现在 section 只留文本引用，
 * `load()` / `createDocument()` 第一次用到时才生成，生成后缓存复用。
 */
export function makeTxtBook(
  raw: string,
  meta: { title: string; author?: string },
  opts: TxtBookOptions = {},
): FoliateBook {
  const chapters = splitChapters(raw);
  const urls: string[] = [];
  const render = opts.renderChapter ?? chapterHtml;

  const sections: FoliateSection[] = chapters.map((c, i) => {
    const href = `${i}.xhtml`;
    /** 惰性缓存：null = 还没生成；生成后整章复用同一份（含 createDocument） */
    let html: string | null = null;
    const htmlOf = (): string => (html ??= render(c.title, c.text));
    /**
     * 这个 section 最近一次造出来的 blob URL。
     *
     * 以前 `unload` 是空实现、`urls` 只增不减：来回翻几百章之后，整本书
     * 每一章的 HTML Blob 都还活着，手机上内存一路涨（还会被 blob-srcdoc
     * 的全局表钉住）。现在 foliate 卸章时就把这一章那份还回去（P2-20）。
     */
    let current: string | null = null;
    return {
      id: `txt-${i}`,
      href,
      linear: 'yes',
      size: c.size,
      load: async () => {
        const url = URL.createObjectURL(new Blob([htmlOf()], { type: 'text/html' }));
        urls.push(url);
        current = url;
        return url;
      },
      createDocument: async () => new DOMParser().parseFromString(htmlOf(), 'text/html'),
      unload: () => {
        const url = current;
        current = null;
        if (!url) return;
        // 从 destroy 的清单里摘掉，免得收尾时重复 revoke
        const at = urls.indexOf(url);
        if (at >= 0) urls.splice(at, 1);
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* 已经回收过就算了 */
        }
      },
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
      for (const url of urls.splice(0)) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* 单条回收失败不该拦住整本收尾 */
        }
      }
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

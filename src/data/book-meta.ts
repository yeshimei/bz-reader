/* ============================================================
 * bz-reader · 引擎元数据回填（data/book-meta.ts）
 *
 * 打开一本书时，引擎会把 EPUB 里读到的书目信息回填进元数据。
 *
 * 两条规则：
 *   - 用户改过名（meta.titleEdited）就永远不再用文件里的书名覆盖；
 *   - 其余字段「有值才写」：引擎这次没读到，不代表要把旧值抹掉。
 *
 * 为什么要收全：这份数据文件不只给插件自己看，bz 书库也在读。
 * 以前只回填 title/author/wordCount，而且 `pick()` 只认字符串——
 * foliate 的 author 是 contributor 对象/数组，于是**作者从来没有落过盘**。
 * 现在把 metadata 里能拿到的全拿下来，并兼容 foliate `tidy()` 之后的三种形状：
 * 字符串、contributor 对象（`{name}`）、LanguageMap（`{zh: …}`）。
 *
 * 抽成纯函数是为了能直接测：回填发生在 onReady 回调里，拖进 DOM 与
 * foliate 之后只能靠真机看。
 * ============================================================ */
import type { ReaderBook } from './schema';
import type { FoliateBook } from '../types/foliate';

/**
 * 引擎回填面。除了 title/author/wordCount，其余是「冗余保存」：
 * 现在没有消费方，但数据文件是拿不回来的——打开书的那一刻不存，以后就没了。
 */
export interface EngineMeta {
  title?: string;
  subtitle?: string;
  author?: string;
  publisher?: string;
  language?: string;
  description?: string;
  subjects?: string[];
  identifier?: string;
  isbn?: string;
  publishDate?: string;
  series?: string;
  seriesIndex?: string;
  chapterCount?: number;
  wordCount?: number;
}

/** LanguageMap / contributor 的递归深度上限：防手写坏 JSON 或函数返回自身 */
const MAX_DEPTH = 5;

/**
 * 把引擎给的任意元数据值收敛成一个字符串。
 *
 * 处理顺序对应 foliate 的真实输出：
 *   - `string`            → 直接用
 *   - `function`          → foliate 有些版本给的是取值函数
 *   - `{ name: … }`       → contributor（tidy 之后单作者就是对象）
 *   - `{ zh: …, en: … }`  → LanguageMap，取第一个非空值
 *   - 数组                → 取第一个非空
 */
export function textOf(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'function') {
    try {
      return textOf((value as () => unknown)(), depth + 1);
    } catch {
      return '';
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = textOf(item, depth + 1);
      if (s) return s;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('name' in obj) return textOf(obj.name, depth + 1);
    for (const item of Object.values(obj)) {
      const s = textOf(item, depth + 1);
      if (s) return s;
    }
  }
  return '';
}

/**
 * 多人字段（作者/出版社）：数组拼起来，别只留第一个——
 * 「A、B 合著」只存 A 就是把另一个作者弄丢了。
 */
export function contributorText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => textOf(item)).filter(Boolean).join('、');
  }
  return textOf(value);
}

/** 分类等「多个名字」字段：去空、去重、保序 */
export function contributorNames(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const out: string[] = [];
  for (const item of list) {
    const name = textOf(item);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 从任意字符串里捞 ISBN（`urn:isbn:` / `isbn:` / 裸 ISBN） */
function isbnFromText(text: string): string {
  const s = String(text || '').trim();
  const m = s.match(/isbn[\s:_-]*([0-9Xx][0-9Xx-]{8,16})/i);
  if (m) {
    const digits = m[1].replace(/-/g, '').toUpperCase();
    if (digits.length >= 10) return digits;
  }
  /* EPUB2 常把 ISBN 直接写在 dc:identifier 里：纯 10 位（末位可为 X）或 13 位数字。
     weave 的《红楼梦》就是这么存的（identifier = 1619127694）。 */
  if (/^\d{9}[\dXx]$/.test(s) || /^\d{13}$/.test(s)) return s.toUpperCase();
  return '';
}

/**
 * ISBN：优先顶层 `isbn`，其次 identifier，再其次 altIdentifier 里 scheme=isbn 的条目。
 * 拿不到就返回空串——**不要拿 uuid 之类的 identifier 硬充**，那会让消费方
 * 以为这本书有 ISBN，却对不上任何一本真书。
 */
export function isbnOf(metadata: unknown): string {
  const md = (metadata ?? {}) as Record<string, unknown>;
  const direct = typeof md.isbn === 'string' ? md.isbn.replace(/-/g, '').trim() : '';
  if (direct) return direct;
  if (typeof md.identifier === 'string') {
    const fromIdentifier = isbnFromText(md.identifier);
    if (fromIdentifier) return fromIdentifier;
  }
  const alts = Array.isArray(md.altIdentifier)
    ? md.altIdentifier
    : md.altIdentifier
      ? [md.altIdentifier]
      : [];
  for (const alt of alts) {
    if (typeof alt === 'string') {
      const s = isbnFromText(alt);
      if (s) return s;
      continue;
    }
    if (alt && typeof alt === 'object') {
      const rec = alt as Record<string, unknown>;
      const scheme = (typeof rec.scheme === 'string' ? rec.scheme : '').toLowerCase();
      if (scheme === 'isbn' && typeof rec.value === 'string') return rec.value.replace(/-/g, '').trim();
      const s = isbnFromText(typeof rec.value === 'string' ? rec.value : '');
      if (s) return s;
    }
  }
  return '';
}

/**
 * 从 foliate 的 book 对象提取一份完整书目。
 *
 * `chapterCount` 取 spine 篇数：EPUB 通常一章一个文件；整本单文件的书
 * 这个值会偏小，所以它只是「大致章节数」，不要拿它当目录项数用。
 */
export function engineMetaFromBook(book: FoliateBook, fallbackTitle: string, wordCount = 0): EngineMeta {
  const md = (book?.metadata ?? {}) as Record<string, unknown>;
  const belongsTo = (md.belongsTo ?? {}) as Record<string, unknown>;
  const series = belongsTo.series as Record<string, unknown> | null | undefined;
  return {
    title: textOf(md.title) || fallbackTitle,
    subtitle: textOf(md.subtitle),
    author: contributorText(md.author),
    publisher: contributorText(md.publisher),
    language: textOf(md.language),
    description: textOf(md.description),
    subjects: contributorNames(md.subject),
    identifier: textOf(md.identifier),
    isbn: isbnOf(md),
    publishDate: textOf(md.published),
    series: series ? textOf(series.name) : '',
    seriesIndex: series ? textOf(series.position) : '',
    chapterCount: book?.sections?.length ?? 0,
    wordCount,
  };
}

/** 文本字段清单：有值才写，且写的是 trim 后的值 */
const TEXT_FIELDS = [
  'author',
  'publisher',
  'language',
  'description',
  'isbn',
  'identifier',
  'publishDate',
  'series',
  'seriesIndex',
  'subtitle',
] as const;

/**
 * 把引擎读到的元数据回填进书。返回是否有字段真的变了
 * （调用方据此决定要不要重绘 / 落盘）。
 */
export function applyEngineMeta(book: ReaderBook, m: EngineMeta): boolean {
  let changed = false;
  if (m.title && !book.meta.titleEdited && book.meta.title !== m.title) {
    book.meta.title = m.title;
    changed = true;
  }

  for (const key of TEXT_FIELDS) {
    const next = m[key]?.trim();
    if (next && book.meta[key] !== next) {
      book.meta[key] = next;
      changed = true;
    }
  }

  if (Array.isArray(m.subjects)) {
    const next = m.subjects.map((s) => s.trim()).filter(Boolean);
    const prev = Array.isArray(book.meta.subjects) ? book.meta.subjects : [];
    if (next.join('\u0000') !== prev.join('\u0000')) {
      book.meta.subjects = next;
      changed = true;
    }
  }

  if (typeof m.chapterCount === 'number' && m.chapterCount > 0 && book.meta.chapterCount !== m.chapterCount) {
    book.meta.chapterCount = m.chapterCount;
    changed = true;
  }

  if (typeof m.wordCount === 'number' && m.wordCount > 0 && book.meta.wordCount !== m.wordCount) {
    book.meta.wordCount = m.wordCount;
    changed = true;
  }

  return changed;
}

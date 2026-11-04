/* ============================================================
 * bz-reader · 标注数据（data/notes.ts）
 *
 * 纯函数，只改 `ReaderBook.notes`，不碰 DOM、不碰存储。
 * 形状见 data/schema.ts：highlights / excerpts / bookmarks 三个数组，
 * 名字与 bz 侧读书笔记对齐，将来把文件路径一换就能对上。
 *
 * 两条约定：
 *  1. **highlight 是主本，excerpt 是镜像**。bz 侧的「想法数」读的是
 *     `notes.excerpts[]`，所以每次增删改都要同步过去——两边同 id，
 *     删一条就删得掉一对。这不是冗余设计，是对齐既有消费点。
 *  2. **颜色只存名字**（amber / vermilion / …），不存十六进制。
 *     深色与浅色主题下同一个「琥珀」要取不同的具体值，写死颜色号
 *     等于把这个选择权永久焊死在今天这版配色上。
 * ============================================================ */
import type { Bookmark, BookNotes, Excerpt, Highlight, ReaderBook } from './schema';

export const HIGHLIGHT_COLORS = [
  { value: 'amber', label: '琥珀', css: '#e8b53a' },
  { value: 'vermilion', label: '朱红', css: '#e2571c' },
  { value: 'green', label: '松绿', css: '#4f9a63' },
  { value: 'blue', label: '黛蓝', css: '#4a83d0' },
] as const;

export type HighlightColorName = (typeof HIGHLIGHT_COLORS)[number]['value'];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColorName = 'amber';

/** 颜色名 → 具体色值（认不出的名字退回琥珀，别在书页里画出一条透明线） */
export function colorCss(name?: string): string {
  return (HIGHLIGHT_COLORS.find((c) => c.value === name) ?? HIGHLIGHT_COLORS[0]).css;
}

export function isHighlightColor(name: unknown): name is HighlightColorName {
  return HIGHLIGHT_COLORS.some((c) => c.value === name);
}

/** 选中文字最多存这么多字，超出的截断——划线跨整章并不稀奇，别把 JSON 撑爆 */
const MAX_TEXT = 5000;

function uid(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function notes(book: ReaderBook): BookNotes {
  // 老数据可能是别的版本写下的，缺数组就补上（不信任磁盘上的形状）
  if (!book.notes) book.notes = { highlights: [], excerpts: [], bookmarks: [] };
  book.notes.highlights ??= [];
  book.notes.excerpts ??= [];
  book.notes.bookmarks ??= [];
  return book.notes;
}

export interface NewHighlight {
  text: string;
  cfiRange: string;
  chapterIndex?: number;
  chapterTitle?: string;
  color?: HighlightColorName;
  comment?: string;
}

/** 同一条划线的镜像摘录（bz 侧计数读这个数组） */
function mirrorExcerpt(n: BookNotes, h: Highlight): void {
  const at = n.excerpts.findIndex((e) => e.id === h.id);
  const next: Excerpt = {
    id: h.id,
    text: h.text,
    cfiRange: h.cfiRange,
    comment: h.comment,
    createdAt: h.createdAt,
  };
  if (at >= 0) n.excerpts[at] = next;
  else n.excerpts.push(next);
}

export function addHighlight(book: ReaderBook, input: NewHighlight): Highlight {
  const n = notes(book);
  const now = Date.now();
  const h: Highlight = {
    id: uid('h'),
    text: input.text.trim().slice(0, MAX_TEXT),
    cfiRange: input.cfiRange,
    chapterIndex: input.chapterIndex,
    chapterTitle: input.chapterTitle,
    color: input.color ?? DEFAULT_HIGHLIGHT_COLOR,
    comment: input.comment?.trim() || undefined,
    createdAt: now,
  };
  n.highlights.push(h);
  mirrorExcerpt(n, h);
  book.updatedAt = now;
  return h;
}

export function findHighlight(book: ReaderBook, idOrCfi: string): Highlight | undefined {
  const n = notes(book);
  return n.highlights.find((h) => h.id === idOrCfi || h.cfiRange === idOrCfi);
}

export function setHighlightComment(book: ReaderBook, id: string, comment: string): boolean {
  const n = notes(book);
  const h = n.highlights.find((x) => x.id === id);
  if (!h) return false;
  const text = comment.trim();
  h.comment = text || undefined;
  h.updatedAt = Date.now();
  mirrorExcerpt(n, h);
  book.updatedAt = h.updatedAt;
  return true;
}

export function setHighlightColor(book: ReaderBook, id: string, color: HighlightColorName): boolean {
  const n = notes(book);
  const h = n.highlights.find((x) => x.id === id);
  if (!h) return false;
  h.color = color;
  h.updatedAt = Date.now();
  book.updatedAt = h.updatedAt;
  return true;
}

export function removeHighlight(book: ReaderBook, id: string): boolean {
  const n = notes(book);
  const at = n.highlights.findIndex((x) => x.id === id);
  if (at < 0) return false;
  n.highlights.splice(at, 1);
  const mirror = n.excerpts.findIndex((e) => e.id === id);
  if (mirror >= 0) n.excerpts.splice(mirror, 1);
  book.updatedAt = Date.now();
  return true;
}

/**
 * 批量删除（标注多选）。
 *
 * 一次遍历、一把过滤：500 条标注逐条调 `removeHighlight` 会做 500 次
 * `splice`，而且每次都改 `updatedAt`。这里返回**真实删掉**的条数——
 * 选中项里可能有已经被另一台设备删掉的 id，按数量给提示才对得上。
 */
export function removeHighlights(book: ReaderBook, ids: ReadonlySet<string>): number {
  if (!ids.size) return 0;
  const n = notes(book);
  const before = n.highlights.length;
  n.highlights = n.highlights.filter((h) => !ids.has(h.id));
  n.excerpts = n.excerpts.filter((e) => !ids.has(e.id));
  const removed = before - n.highlights.length;
  if (removed > 0) book.updatedAt = Date.now();
  return removed;
}

/** 划线的展示顺序：先按章节，再按在章节里的先后（createdAt 近似即可） */
export function highlightsOf(book: ReaderBook): Highlight[] {
  return [...notes(book).highlights].sort((a, b) => {
    const ca = a.chapterIndex ?? 0;
    const cb = b.chapterIndex ?? 0;
    if (ca !== cb) return ca - cb;
    return a.createdAt - b.createdAt;
  });
}

export interface HighlightGroup {
  chapterTitle: string;
  items: Highlight[];
}

/** 按章节分组（侧栏用）。没有章节名的归到「未标注章节」 */
export function groupHighlights(book: ReaderBook): HighlightGroup[] {
  const out: HighlightGroup[] = [];
  const at = new Map<string, HighlightGroup>();
  for (const h of highlightsOf(book)) {
    const title = h.chapterTitle?.trim() || '未命名章节';
    let g = at.get(title);
    if (!g) {
      g = { chapterTitle: title, items: [] };
      at.set(title, g);
      out.push(g);
    }
    g.items.push(h);
  }
  return out;
}

export interface NewBookmark {
  cfi: string;
  percent: number;
  chapterTitle?: string;
  label?: string;
}

export function addBookmark(book: ReaderBook, input: NewBookmark): Bookmark {
  const n = notes(book);
  const now = Date.now();
  const b: Bookmark = {
    id: uid('m'),
    cfi: input.cfi,
    percent: Math.min(1, Math.max(0, input.percent || 0)),
    chapterTitle: input.chapterTitle,
    label: input.label,
    createdAt: now,
  };
  n.bookmarks.push(b);
  book.updatedAt = now;
  return b;
}

/** 当前页已有的书签（按 CFI 精确比对：只认「就停在这一页」） */
export function bookmarkAt(book: ReaderBook, cfi: string): Bookmark | undefined {
  if (!cfi) return undefined;
  return notes(book).bookmarks.find((b) => b.cfi === cfi);
}

export function removeBookmark(book: ReaderBook, id: string): boolean {
  const n = notes(book);
  const at = n.bookmarks.findIndex((b) => b.id === id);
  if (at < 0) return false;
  n.bookmarks.splice(at, 1);
  book.updatedAt = Date.now();
  return true;
}

/** 书签开关：有就删，没有就加。返回加完的这条（删掉时为 undefined） */
export function toggleBookmark(book: ReaderBook, input: NewBookmark): Bookmark | undefined {
  const exist = bookmarkAt(book, input.cfi);
  if (exist) {
    removeBookmark(book, exist.id);
    return undefined;
  }
  return addBookmark(book, input);
}

export function bookmarksOf(book: ReaderBook): Bookmark[] {
  return [...notes(book).bookmarks].sort((a, b) => a.percent - b.percent);
}

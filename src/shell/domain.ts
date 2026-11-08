/* ============================================================
 * bz-reader · 壳层领域查询（shell/domain.ts）
 *
 * 渲染层不该认识 ReaderBook 的嵌套形状（notes.highlights[i].chapterTitle…），
 * 更不该在模板里到处写 `?.`。这里把「一本书的标注」拍平成行，
 * 顺带补上跨书视图需要的书名、色值、章节名。
 *
 * 只读：不写 store，不改数据。写操作一律走 data/notes.ts 的纯函数。
 * ============================================================ */
import type { Bookmark, Highlight, ReaderBook } from '../data/schema';
import { HIGHLIGHT_COLORS, colorCss, colorLabel } from '../data/notes';
import { NO_SHELF } from '../data/shelves';
import { getState } from './state';

export interface MarkRow {
  id: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  text: string;
  comment: string;
  /** 颜色名（amber / vermilion / green / blue） */
  color: string;
  colorLabel: string;
  /** 该颜色的具体色值，直接给 CSS 变量 --c 用 */
  css: string;
  chapterTitle: string;
  chapterIndex: number;
  createdAt: number;
  cfiRange: string;
}

export interface BmkRow {
  id: string;
  bookId: string;
  bookTitle: string;
  label: string;
  chapterTitle: string;
  percent: number;
  createdAt: number;
  cfi: string;
}

const NO_CHAPTER = '未命名章节';

export function penLabel(color?: string): string {
  return colorLabel(color);
}

export function penCss(color?: string): string {
  return colorCss(color);
}

export function markRow(book: ReaderBook, h: Highlight): MarkRow {
  return {
    id: h.id,
    bookId: book.id,
    bookTitle: book.meta.title || '未命名',
    bookAuthor: book.meta.author || '佚名',
    text: h.text,
    comment: h.comment?.trim() || '',
    color: h.color || HIGHLIGHT_COLORS[0].value,
    colorLabel: penLabel(h.color),
    css: penCss(h.color),
    chapterTitle: h.chapterTitle?.trim() || NO_CHAPTER,
    chapterIndex: h.chapterIndex ?? 0,
    createdAt: h.createdAt || 0,
    cfiRange: h.cfiRange || '',
  };
}

/** 一本书的标注，按章节再按时间排好 */
export function marksOf(book: ReaderBook): MarkRow[] {
  const list = book.notes?.highlights ?? [];
  return [...list]
    .sort((a, b) => {
      const ca = a.chapterIndex ?? 0;
      const cb = b.chapterIndex ?? 0;
      if (ca !== cb) return ca - cb;
      return (a.createdAt || 0) - (b.createdAt || 0);
    })
    .map((h) => markRow(book, h));
}

/** 全库标注，时间倒序（笔记页默认的「最近写过」） */
export function allMarks(books: ReaderBook[]): MarkRow[] {
  const out: MarkRow[] = [];
  for (const b of books) {
    for (const h of b.notes?.highlights ?? []) out.push(markRow(b, h));
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function bmkRow(book: ReaderBook, k: Bookmark): BmkRow {
  return {
    id: k.id,
    bookId: book.id,
    bookTitle: book.meta.title || '未命名',
    label: k.label?.trim() || k.chapterTitle?.trim() || '书签',
    chapterTitle: k.chapterTitle?.trim() || NO_CHAPTER,
    percent: Math.round((k.percent || 0) * 100),
    createdAt: k.createdAt || 0,
    cfi: k.cfi || '',
  };
}

/** 一本书的书签：按书中先后（与侧栏时间线一致） */
export function bmksOf(book: ReaderBook): BmkRow[] {
  return [...(book.notes?.bookmarks ?? [])]
    .sort((a, b) => (a.percent || 0) - (b.percent || 0))
    .map((k) => bmkRow(book, k));
}

export function allBmks(books: ReaderBook[]): BmkRow[] {
  const out: BmkRow[] = [];
  for (const b of books) for (const k of b.notes?.bookmarks ?? []) out.push(bmkRow(b, k));
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/* ─────────── 分组与筛选 ─────────── */

export interface BookGroup<T> {
  bookId: string;
  bookTitle: string;
  items: T[];
}

/** 按书分组，保持输入顺序（调用方已经按想要的优先级排过） */
export function groupByBook<T extends { bookId: string; bookTitle: string }>(rows: T[]): Array<BookGroup<T>> {
  const order: string[] = [];
  const at = new Map<string, BookGroup<T>>();
  for (const r of rows) {
    let g = at.get(r.bookId);
    if (!g) {
      g = { bookId: r.bookId, bookTitle: r.bookTitle, items: [] };
      at.set(r.bookId, g);
      order.push(r.bookId);
    }
    g.items.push(r);
  }
  return order.map((id) => at.get(id)!);
}

/** 按章分组，用于侧栏划线页 */
export function groupByChapter(rows: MarkRow[]): Array<{ title: string; items: MarkRow[] }> {
  const order: string[] = [];
  const at = new Map<string, MarkRow[]>();
  for (const m of rows) {
    if (!at.has(m.chapterTitle)) {
      at.set(m.chapterTitle, []);
      order.push(m.chapterTitle);
    }
    at.get(m.chapterTitle)!.push(m);
  }
  return order.map((t) => ({ title: t, items: at.get(t)! }));
}

/**
 * 笔记页的筛选。`filter` 的取值：
 *   all      全部
 *   comment  有想法
 *   amber/vermilion/green/blue  按笔色
 */
export function filterMarks(rows: MarkRow[], filter: string, kw: string): MarkRow[] {
  const q = kw.trim().toLowerCase();
  return rows.filter((m) => {
    if (filter === 'comment' && !m.comment) return false;
    if (filter !== 'all' && filter !== 'comment' && m.color !== filter) return false;
    if (!q) return true;
    return (m.text + m.comment + m.bookTitle).toLowerCase().includes(q);
  });
}

/* ─────────── 统计口径 ─────────── */

/** 今日阅读秒数（本地时区）——热力图与 KPI 用同一份口径 */
export function fmtMinutes(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} 分钟`;
  const h = m / 60;
  return h >= 10 ? `${Math.round(h)} 小时` : `${h.toFixed(1)} 小时`;
}

/** 相对时间：今天 / 昨天 / 10月26日 */
export function fmtWhen(ts: number, now = Date.now()): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const n = new Date(now);
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return '今天';
  const y = new Date(now - 86_400_000);
  if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 书架集合：优先用户自定（业务数据里的 `book.shelf`，经 hydrateLibrary 进壳层），
 * 退回 EPUB 自带的 subjects。
 *
 * subjects 只在**是中文**时才用（P3-12）：EPUB 里的分类常是 `Fiction` /
 * `Science` / `Literary Collections` 这类英文串，直接塞进筛选条会变成
 * 一排中英混杂的 chip，用户根本不知道自己什么时候建过这些书架。
 */
export function shelfOf(book: ReaderBook): string {
  const own = getState().shelves[book.id];
  if (own) return own;
  const sub = book.meta.subjects?.[0]?.trim();
  if (sub && /[\u4e00-\u9fff]/.test(sub)) return sub;
  return NO_SHELF;
}

/* ============================================================
 * bz-reader · 数据适配（shell/adapt.ts）
 *
 * 真实数据（ReaderBook）与原型视图需要的东西差三块：
 *   1. 没有「已读完 / 在读 / 未读」——由 percent 推导
 *   2. 没有封面配色——按 id 哈希出稳定的一组色，同一本书永远同色
 *   3. 没有「今天 / 昨天」文案——由 lastReadTime 算
 *
 * 这一层只读不写：任何会改数据的动作都走 store，不在这里动手。
 * ============================================================ */
import type { App } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import { orderShelves } from '../data/shelves';
import { getState, isFav } from './state';
import { shelfOf } from './domain';

export type BookStatus = 'reading' | 'done' | 'new';

export interface BookRow {
  id: string;
  title: string;
  author: string;
  /** 0..100，取整 */
  percent: number;
  status: BookStatus;
  fav: boolean;
  /** 累计分钟 */
  minutes: number;
  /** 上次打开：今天 / 昨天 / 10月26日 / — */
  lastText: string;
  lastTs: number;
  shelf: string;
  format: string;
  /** 有封面文件就出图，否则用色块 + 竖排书名 */
  coverUrl: string | null;
  bg: string;
  fg: string;
  glyph: string;
  chapterTitle: string;
  noteCount: number;
  /** 文件不在登记的路径上：书卡压暗 + 角标，点它进「重新定位」 */
  missing: boolean;
}

/** 封面配色：12 组暖调，都压过饱和度，避免封面墙花成调色盘 */
const COVER_COLORS: Array<[string, string, string]> = [
  ['#4a3a28', '#2c2115', '#e9dcc3'],
  ['#35424a', '#1f2830', '#d7e2e8'],
  ['#3a2f33', '#241c1f', '#e3d3d6'],
  ['#47413a', '#2a2521', '#e6dfd2'],
  ['#2f4038', '#1c2620', '#d5e4da'],
  ['#503a2a', '#2f2115', '#ecdcc0'],
  ['#3c3630', '#211d18', '#ddd3c0'],
  ['#55372c', '#2f1f18', '#f0d9cc'],
  ['#3f3a4a', '#231f2e', '#ddd6e8'],
  ['#4a4030', '#282015', '#e8dcc0'],
  ['#33413f', '#1c2624', '#d4e0dd'],
  ['#4a3438', '#281a1d', '#e8d2d5'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function coverColors(id: string): [string, string, string] {
  return COVER_COLORS[hash(id) % COVER_COLORS.length];
}

/** 书名取前两字做封面题签；英文书名取首词前两字母 */
export function glyphOf(title: string): string {
  const t = title.trim();
  if (!t) return '无题';
  // 中文按字取两枚
  if (/[\u4e00-\u9fa5]/.test(t[0])) return t.replace(/[\s·・:：]/g, '').slice(0, 2);
  return t.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'BK';
}

function fmtDate(ts: number, now = Date.now()): string {
  if (!ts || ts <= 0) return '—';
  const d = new Date(ts);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return '今天';
  const y = new Date(now - 86400000);
  if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** vault 相对路径 → 可放进 <img src> 的资源地址 */
function resourceUrl(app: App, vaultPath?: string): string | null {
  if (!vaultPath) return null;
  try {
    return app.vault.adapter.getResourcePath(vaultPath);
  } catch {
    return null;
  }
}

export function toRow(app: App, b: ReaderBook): BookRow {
  const percent = Math.round((b.reading.position.percent || 0) * 100);
  /* 读完只看 completedTime（P2-06）。以前还认 `percent >= 99`，于是
     「标为读完 → 取消」之后 percent 仍是 1，卡片继续显示「读完」，
     按钮却写「标为在读」，怎么点都翻不过状态。 */
  const done = !!b.reading.stats.completedTime;
  const status: BookStatus = done ? 'done' : percent > 0 ? 'reading' : 'new';
  const [c1, c2, fg] = coverColors(b.id);
  const title = b.meta.title || '未命名';
  const noteCount = b.notes.highlights.length;
  /* 分组走 domain.shelfOf（P3-12）：英文 subjects 不再混进中文筛选条 */
  const shelf = shelfOf(b);

  return {
    id: b.id,
    title,
    author: b.meta.author || '佚名',
    percent,
    status,
    fav: isFav(b.id),
    minutes: Math.round((b.reading.stats.totalReadTime || 0) / 60),
    lastText: fmtDate(b.reading.stats.lastReadTime),
    lastTs: b.reading.stats.lastReadTime || 0,
    shelf,
    format: (b.fileRef.format || 'epub').toUpperCase(),
    coverUrl: resourceUrl(app, b.meta.coverPath),
    bg: `linear-gradient(150deg,${c1},${c2})`,
    fg,
    glyph: glyphOf(title),
    chapterTitle: b.reading.position.chapterTitle || '',
    noteCount,
    missing: b.fileRef.fileMissing === true,
  };
}

export function toRows(app: App, books: ReaderBook[]): BookRow[] {
  return books.map((b) => toRow(app, b));
}

/**
 * 分类条的顺序。
 *
 * 以前是「全部 + 按拼音排的分类名」：用户自己排过的顺序、刚建的空分类都留不住。
 * 现在顺序由 `data/shelves` 的名单说了算，书自带的分类接在后面，「未分类」收尾。
 */
export function shelfNames(rows: BookRow[], saved: readonly string[] = []): string[] {
  return orderShelves(
    saved,
    rows.map((r) => r.shelf),
  );
}

/** 书库筛选 + 排序：与原型 libBooks() 一致的语义 */
export function filterRows(rows: BookRow[], s = getState()): BookRow[] {
  let arr = [...rows];
  const k = s.libKw.trim().toLowerCase();
  if (k) arr = arr.filter((b) => (b.title + b.author + b.shelf).toLowerCase().includes(k));
  if (s.libShelf !== '全部') arr = arr.filter((b) => b.shelf === s.libShelf);
  if (s.libFilter === 'reading') arr = arr.filter((b) => b.status === 'reading');
  if (s.libFilter === 'done') arr = arr.filter((b) => b.status === 'done');
  if (s.libFilter === 'new') arr = arr.filter((b) => b.status === 'new');
  if (s.libFilter === 'fav') arr = arr.filter((b) => b.fav);

  if (s.libSort === 'title') arr.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  else if (s.libSort === 'progress') arr.sort((a, b) => b.percent - a.percent);
  else arr.sort((a, b) => b.lastTs - a.lastTs || b.percent - a.percent);

  return arr;
}

/** 「继续阅读」挑最近在读、且读到一半的那本；失联的不选（点了也读不了） */
export function continueRow(rows: BookRow[]): BookRow | null {
  const reading = rows.filter((r) => r.status === 'reading' && !r.missing);
  if (reading.length) return reading.sort((a, b) => b.lastTs - a.lastTs)[0];
  const alive = rows.filter((r) => !r.missing);
  return alive.length ? [...alive].sort((a, b) => b.lastTs - a.lastTs)[0] : null;
}

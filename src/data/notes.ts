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
import { locale, type Locale } from '../i18n';
import type { Bookmark, BookNotes, Excerpt, Highlight, KbLink, ReaderBook, ReviewLink } from './schema';
import { upsertKbLink } from './kb-link';

export const HIGHLIGHT_COLORS = [
  { value: 'amber', css: '#e8b53a' },
  { value: 'vermilion', css: '#e2571c' },
  { value: 'green', css: '#4f9a63' },
  { value: 'blue', css: '#4a83d0' },
] as const;

export type HighlightColorName = (typeof HIGHLIGHT_COLORS)[number]['value'];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColorName = 'amber';

/**
 * 颜色名 → 各语言的说法。
 *
 * **故意不进主语言包**：四个色名是成套的东西，拆进 8 个包以后谁漏翻一个
 * 没人看得出来（少一条 key 是 tsc 报错，但少一条翻译只是「英文界面里冒出
 * 一个中文色名」）。集中成一张表，`Record<Locale, string>` 让「八种语言
 * 都齐」变成类型约束，一次看全也方便对齐语感。
 *
 * 西文的色名走各自语言的常用说法，不是音译：德语 Bernstein、法语 Ambre、
 * 西语 Ámbar、葡语 Âmbar。日语保留汉字色名（琥珀色／朱色／松葉色／藍色）——
 * 这几个人家本来就这么写。
 */
const COLOR_LABELS: Record<HighlightColorName, Record<Locale, string>> = {
  amber: {
    zh: '琥珀',
    'zh-TW': '琥珀',
    en: 'Amber',
    ja: '琥珀色',
    de: 'Bernstein',
    fr: 'Ambre',
    es: 'Ámbar',
    pt: 'Âmbar',
  },
  vermilion: {
    zh: '朱红',
    'zh-TW': '朱紅',
    en: 'Vermilion',
    ja: '朱色',
    de: 'Zinnober',
    fr: 'Vermillon',
    es: 'Bermellón',
    pt: 'Vermelhão',
  },
  green: {
    zh: '松绿',
    'zh-TW': '松綠',
    en: 'Pine green',
    ja: '松葉色',
    de: 'Tannengrün',
    fr: 'Vert pin',
    es: 'Verde pino',
    pt: 'Verde-pinho',
  },
  blue: {
    zh: '黛蓝',
    'zh-TW': '黛藍',
    en: 'Indigo',
    ja: '藍色',
    de: 'Indigoblau',
    fr: 'Bleu indigo',
    es: 'Índigo',
    pt: 'Anil',
  },
};

/** 颜色名 → 当前界面语言的说法（认不出的名字退回琥珀，别在界面上留空） */
export function colorLabel(name?: string): string {
  const key = isHighlightColor(name) ? name : DEFAULT_HIGHLIGHT_COLOR;
  return COLOR_LABELS[key][locale()] ?? COLOR_LABELS[key].zh;
}

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

/**
 * 标注变更的公共收尾（A-15）。
 *
 * 两条时间线：
 *   · `updatedAt`   —— 这本书整体最后一次改动（书架「最近」排序、旧版合并用）；
 *   · `notesUpdatedAt` —— 只记标注。跨设备合并时 notes 取它大的那份，
 *     而阅读进度取 `updatedAt` 大的那份，互不覆盖。
 */
function touchNotes(book: ReaderBook, now = Date.now()): void {
  book.notesUpdatedAt = now;
  book.updatedAt = now;
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
  touchNotes(book, now);
  return h;
}

export function findHighlight(book: ReaderBook, idOrCfi: string): Highlight | undefined {
  const n = notes(book);
  return n.highlights.find((h) => h.id === idOrCfi || h.cfiRange === idOrCfi);
}

/**
 * 落一条线，同位置已有就复用（2026-11-10）。
 *
 * 「双链 / 存为名词 / 存为段落」点下去要顺手标出这段字，可用户可能**已经**
 * 自己划过它——再叠一条就会出现两条一模一样的线，删的时候还得删两次。
 *
 * 两条规矩：
 *   · 复用**不改色**：颜色是用户自己选的，不该被一次点击覆盖；
 *   · 没有 CFI 的输入不去重：空串会让所有「无定位」的线互相命中。
 */
export function ensureHighlight(
  book: ReaderBook,
  input: NewHighlight,
): { highlight: Highlight; created: boolean } {
  const existing = input.cfiRange ? findHighlight(book, input.cfiRange) : undefined;
  if (existing) return { highlight: existing, created: false };
  return { highlight: addHighlight(book, input), created: true };
}

export function setHighlightComment(book: ReaderBook, id: string, comment: string): boolean {
  const n = notes(book);
  const h = n.highlights.find((x) => x.id === id);
  if (!h) return false;
  const text = comment.trim();
  h.comment = text || undefined;
  h.updatedAt = Date.now();
  mirrorExcerpt(n, h);
  touchNotes(book, h.updatedAt);
  return true;
}

/**
 * 记一条知识盒链接（2026-11-08）。
 *
 * 与想法分家：**不碰 `comment`**。名词 / 段落各一格，同类型再存是替换——
 * 名词笔记改名后再存一次，不该同时出现两个「看名词」。
 *
 * 空路径也返回 true（动作本身成功，只是没有东西可写），由 upsertKbLink 保住旧链接。
 */
export function setHighlightKb(book: ReaderBook, id: string, link: KbLink): boolean {
  const n = notes(book);
  const h = n.highlights.find((x) => x.id === id);
  if (!h) return false;
  const next = upsertKbLink(h.kb, link);
  h.kb = next.length ? next : undefined;
  h.updatedAt = Date.now();
  touchNotes(book, h.updatedAt);
  return true;
}

/**
 * 记下一条划线生成的复习卡（2026-11-11）。
 *
 * 与 setHighlightKb 同一套：路径记在划线上，工具条那颗按钮据此从「复习」
 * 变成「已复习」。返回 false 只表示这条划线找不到，与写卡成败无关。
 */
export function setHighlightReview(book: ReaderBook, id: string, link: ReviewLink): boolean {
  const n = notes(book);
  const h = n.highlights.find((x) => x.id === id);
  if (!h) return false;
  h.review = { path: link.path, at: link.at, scheduled: link.scheduled === true };
  h.updatedAt = link.at;
  touchNotes(book, h.updatedAt);
  return true;
}

/**
 * 抹掉划线 → 复习卡的链接（「移出复习计划」）。
 *
 * 只摘排期与记录，**卡片文件留着**：那是用户库里的一篇笔记，可能已经写了
 * 自己的想法，插件不该替人删文件。要删让他自己去文件列表里删。
 */
export function clearHighlightReview(book: ReaderBook, id: string): boolean {
  const n = notes(book);
  const h = n.highlights.find((x) => x.id === id);
  if (!h || !h.review) return false;
  delete h.review;
  h.updatedAt = Date.now();
  touchNotes(book, h.updatedAt);
  return true;
}

export function setHighlightColor(book: ReaderBook, id: string, color: HighlightColorName): boolean {
  const n = notes(book);
  const h = n.highlights.find((x) => x.id === id);
  if (!h) return false;
  h.color = color;
  h.updatedAt = Date.now();
  touchNotes(book, h.updatedAt);
  return true;
}

export function removeHighlight(book: ReaderBook, id: string): boolean {
  const n = notes(book);
  const at = n.highlights.findIndex((x) => x.id === id);
  if (at < 0) return false;
  n.highlights.splice(at, 1);
  const mirror = n.excerpts.findIndex((e) => e.id === id);
  if (mirror >= 0) n.excerpts.splice(mirror, 1);
  touchNotes(book);
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
  if (removed > 0) touchNotes(book);
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
  touchNotes(book, now);
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
  touchNotes(book);
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

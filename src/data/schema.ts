/* ============================================================
 * bz-reader · 数据形状（data/schema.ts）
 *
 * **与 weave-data.json 同构是硬约束**，不是审美选择：bz 的
 * `bookshelf/data.ts` 与 `reading-report/stats.ts` 已经在按这个形状解析。
 * 形状一致，bz 侧改造 = 换一个文件路径；形状不一致，就要动两个域。
 *
 * 已核实的消费点（bz 侧）：
 *   meta.title / meta.author / meta.wordCount / meta.subjects
 *   fileRef.vaultPath
 *   reading.position.percent
 *   reading.stats.totalReadTime / lastReadTime / completedTime
 *   reading.sessions[].start / .end / .durationSeconds   ← start 必须是毫秒时间戳
 *   notes.highlights[] / notes.excerpts[]
 *
 * 三个反推出来的细节（别改）：
 *   1. sessions[].start 缺失或 ≤0 会被 bz 整条丢弃，**不要补 0**
 *      （补了会落到 1970-01 的幽灵月，热力图能翻到、连续天数被孤点干扰）
 *   2. 报告的 `duration` 由 durationSeconds 派生，不单独存
 *   3. `type: 'completed'` 由「有起止且时长 > 0」派生，不必自己写
 * ============================================================ */

export type BookFormat = 'epub' | 'txt' | 'mobi' | 'azw3' | 'fb2' | 'cbz';

export interface BookMeta {
  title: string;
  author?: string;
  publisher?: string;
  language?: string;
  /** 正文字数（epub 由章节文本估算；txt 直接数） */
  wordCount?: number;
  /** 分类（bz 侧 subjects 通道，缺省归「未分类」） */
  subjects?: string[];
  /** 封面落盘后的 vault 相对路径 */
  coverPath?: string;
  description?: string;
  isbn?: string;
}

export interface BookFileRef {
  /** 书文件在 vault 里的相对路径 */
  vaultPath: string;
  format: BookFormat;
  /** 文件大小（字节），导入去重与统计用 */
  size?: number;
  /** 内容指纹（前 64KB + 大小的哈希），重命名后仍能认出是同一本 */
  fingerprint?: string;
}

export interface ReadingPosition {
  /** 0..1 */
  percent: number;
  /** EPUB CFI（重新定位的唯一依据；txt 用字符偏移） */
  cfi?: string;
  charOffset?: number;
  chapterIndex?: number;
  chapterTitle?: string;
}

export interface ReadingStats {
  /** 累计有效阅读秒数 */
  totalReadTime: number;
  /** 最后一次阅读时间（毫秒戳） */
  lastReadTime: number;
  /** 读完时间（到 99% 时落一次） */
  completedTime?: number;
  /** 第一次打开时间 */
  startReadTime?: number;
}

/** 一次阅读会话。`start` 必须是可解析的毫秒戳，缺了就等于这条数据不存在。 */
export interface ReadingSession {
  start: number;
  end: number;
  durationSeconds: number;
  /** 会话结束时的进度（0..1），用于算「这次读了多少」 */
  percent?: number;
}

export interface Highlight {
  id: string;
  /** 选中文本 */
  text: string;
  /** EPUB CFI 范围 */
  cfiRange?: string;
  chapterIndex?: number;
  chapterTitle?: string;
  color?: string;
  /** 想法 / 批注正文 */
  comment?: string;
  createdAt: number;
  updatedAt?: number;
}

/** 摘录（与 highlight 同源，bz 侧 thinks 计数读的是这个数组） */
export interface Excerpt {
  id: string;
  text: string;
  cfiRange?: string;
  comment?: string;
  createdAt: number;
}

export interface Bookmark {
  id: string;
  cfi?: string;
  percent: number;
  chapterTitle?: string;
  label?: string;
  createdAt: number;
}

export interface BookNotes {
  highlights: Highlight[];
  excerpts: Excerpt[];
  bookmarks: Bookmark[];
}

export interface ReadingBlock {
  position: ReadingPosition;
  stats: ReadingStats;
  sessions: ReadingSession[];
}

export interface ReaderBook {
  /** 稳定 id：文件指纹或 vaultPath 的哈希 */
  id: string;
  meta: BookMeta;
  fileRef: BookFileRef;
  reading: ReadingBlock;
  notes: BookNotes;
  addedAt: number;
  updatedAt: number;
}

export interface ReaderData {
  version: 1;
  books: ReaderBook[];
}

export const EMPTY_DATA: ReaderData = { version: 1, books: [] };

export function emptyReading(): ReadingBlock {
  return {
    position: { percent: 0 },
    stats: { totalReadTime: 0, lastReadTime: 0 },
    sessions: [],
  };
}

export function emptyNotes(): BookNotes {
  return { highlights: [], excerpts: [], bookmarks: [] };
}

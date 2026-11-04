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
  /**
   * 用户在书架上改过名。改过之后打开书时不再用文件里的书名回填，
   * 否则「改名 → 重开 → 变回旧名」（真机反馈第 4 条）。
   * bz 侧读到不认识的键会忽略，不影响数据同构。
   */
  titleEdited?: boolean;
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
  /*
   * 这里曾经有 `fingerprint`（「前 64KB + 大小的哈希」），但全仓没有一个地方
   * 算过它，认「书被改名」时也从没读过（2026-11-04 删）。
   * 留着未使用的字段比没有更糟：下一个人会以为内容比对已经做了。
   */
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
  /**
   * 读完时的打分（1..5）与一句话感受。
   *
   * 这是 bz 侧没有的扩展字段：bz 读到不认识的键会忽略，重写时可能丢，
   * 所以读完那一刻同时会写进导出的 Markdown frontmatter——
   * 数据可以丢，沉淀下来的文字不能丢。
   */
  rating?: number;
  review?: string;
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
  /**
   * 收藏（书架上那颗星）。
   *
   * 2026-11-04 从 localStorage 搬进业务数据：以前换台电脑，书在、进度在、
   * 划线在，收藏星标没了——README 承诺的「跟着走」只兑现了一半。
   * bz 侧读到不认识的键会忽略，不影响数据同构。
   */
  favorite?: boolean;
  /**
   * 书架分组名（用户自己起的中文书架名）。
   *
   * 与 `meta.subjects` 分开：那是 EPUB 自带的英文分类，只当默认值。
   * 以前分组也存在 localStorage，换设备后整排书退回「未分类」。
   */
  shelf?: string;
}

export interface ReaderData {
  version: 1;
  books: ReaderBook[];
  /** 全局阅读偏好（字号/行距/主题），缺省见 data/prefs.ts */
  prefs?: unknown;
  /**
   * 年度阅读目标（本）。
   *
   * 以前只活在 localStorage 里，换设备就回到 20 本。现在跟着业务数据走，
   * 统计页那圈铜线和「还差几本」才不会自相矛盾。
   */
  goal?: number;
  /**
   * 数据目录的镜像（vault 相对路径）。
   *
   * 真相在 `data.json`（它不会被清浏览器缓存干掉）；这里镜像一份是为了
   * 「把库整个拷到另一台电脑、但没带 .obsidian」时还能看出原来放在哪。
   */
  dataDir?: string;
  /**
   * 每日打卡：`YYYY-MM-DD`（本地时区）→ 当天有效阅读秒数。
   *
   * 新功能「阅读目标真正可打卡」：以前 `goal` 只是统计页那圈铜线的一个数字，
   * 不记录、不提醒、不结算——用户设了 30 本，年底看到「已读 8 本」而已。
   * 现在每次阅读会话结束都会把秒数记进当天，连续打卡与本月格子都由它算。
   */
  checkins?: Record<string, number>;
  /** 每日阅读目标（分钟）。打卡判据：当天秒数 ≥ 它 × 60 */
  dailyGoalMinutes?: number;
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

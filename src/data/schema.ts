/* ============================================================
 * bz-reader · 数据形状（data/schema.ts）
 *
 * 这份 JSON 是**对外契约**：bz 书库直接读 `<数据目录>/bz-reader.json`。
 * 插件按自己的命名存（`fileRef` / `comment` / `createdAt`），bz 侧自己做适配；
 * 这里保证的是「字段齐全、语义稳定」，不是与 weave-data.json 逐字同构。
 *
 * 外部消费点（bz 侧当前读的，2026-11-04 核对）：
 *   meta.title / meta.author / meta.wordCount / meta.subjects / meta.coverPath
 *   fileRef.vaultPath            ← 不是 file.vaultPath（旧注释写错过）
 *   reading.position.percent     ← 0..1（bz 侧 epubProgress 会归一）
 *   reading.stats.totalReadTime / lastReadTime / completedTime
 *   reading.sessions[].start / .end / .durationSeconds
 *   notes.highlights[]           ← 想法正文在 `comment`（不是 commentText）、
 *                                  时间在 `createdAt`（不是 createdTime）
 *   notes.excerpts[]             ← 是 highlights 的**同 id 镜像**，不是独立「想法」集合；
 *                                  bz 的 thinks 计数应改读 highlights 里 comment 非空的条数
 *
 * 冗余字段（现在没有消费者，打开书时顺手存下，为以后准备）：
 *   schemaVersion / lastPosition / position.chapterHref /
 *   sessions[].chapterIndex / chapterTitle / meta 的完整书目（出版社、语言、简介、
 *   ISBN、出版日期、丛书、副标题、章节数）。
 *
 * 三个反推出来的细节（别改）：
 *   1. sessions[].start 缺失或 ≤0 会被 bz 整条丢弃，**不要补 0**
 *      （补了会落到 1970-01 的幽灵月，热力图能翻到、连续天数被孤点干扰）
 *   2. 报告的 `duration` 由 durationSeconds 派生，不单独存
 *   3. `type: 'completed'` 由「有起止且时长 > 0」派生，不必自己写
 * ============================================================ */

export type BookFormat = 'epub' | 'txt' | 'mobi' | 'azw3' | 'fb2' | 'cbz';

/**
 * 业务数据格式版本。
 *
 * 2026-11-06（schemaVersion 3）：`fileRef.fingerprint` 开始真的写入。
 * 外部消费者忽略未知键即可；老数据没有它，读侧不受影响。
 *
 * `version` 是「这份 JSON 能不能读」的版本；`schemaVersion` 是给**外部消费者**
 * （bz 书库）判断字段代际用的。两者分开：以后只加字段不改结构时，只推
 * schemaVersion，读侧不用动。
 */
export const SCHEMA_VERSION = 3;

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
  /** 分类（bz 侧 subjects 通道，缺省归「未分类」）；来自 EPUB 的 dc:subject */
  subjects?: string[];
  /**
   * 封面图的 vault 相对路径（`<数据目录>/covers/<id>-<size>.<ext>`）。
   *
   * 由 shell/covers.ts 在第一次解出封面时回填。以前这个字段声明了却没有
   * 写入点，外部读这份数据就只能看到一片色块。
   */
  coverPath?: string;
  description?: string;
  isbn?: string;
  /** EPUB 的 dc:identifier 原串（`urn:isbn:` / `urn:uuid:` 等） */
  identifier?: string;
  /** 出版日期（dc:date，原串，可能带时间与时区） */
  publishDate?: string;
  /** 丛书名（belongsTo.series.name） */
  series?: string;
  /** 丛书中的卷次（belongsTo.series.position，原串——EPUB 允许 "2.2.1"） */
  seriesIndex?: string;
  /** 副标题（dc:title 里 title-type=subtitle 的那条） */
  subtitle?: string;
  /** 章节数（EPUB 的 spine 篇数；漫画等固定版式可能不准） */
  chapterCount?: number;
}

export interface BookFileRef {
  /** 书文件在 vault 里的相对路径 */
  vaultPath: string;
  format: BookFormat;
  /** 文件大小（字节），导入去重与统计用 */
  size?: number;
  /**
   * 内容指纹（`v1-…`，算法见 data/fingerprint.ts）。
   *
   * 2026-11-06 起真的算了：导入/扫描登记前先算，**同一指纹只允许一条记录**。
   * 以前这里有个同名字段但全仓没有一个写入点（2026-11-04 删掉）；现在它
   * 就是「同一份文件只能进书架一次」的依据，所以重新加回来。
   *
   * 老记录没有这个值：下次扫描到文件时补算（大文件超过 64MB 不补，退回
   * 按路径去重）。
   */
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
  /** 当前章节的目录 href（章节标题会重复，只有 href 能唯一定位——冗余给外部用） */
  chapterHref?: string;
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
  /**
   * 会话结束时所在章节（冗余：现在没有消费方，以后按章分析/年度报告要用）。
   * 只在会话结算时那一瞬取快照，不随后续翻页变化。
   */
  chapterIndex?: number;
  chapterTitle?: string;
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

/** 位置快照（上一次位置）。`savedAt` 是它被顶掉的时间，不是位置本身的时间 */
export interface PositionSnapshot extends ReadingPosition {
  savedAt?: number;
}

export interface ReadingBlock {
  position: ReadingPosition;
  /**
   * 上一次位置（冗余）。
   *
   * `position` 是「现在读到哪」，这里存「上一次读到哪」——给未来的「返回上一处」
   * 与阅读轨迹用。没有消费者时它只是多一个对象，不影响读侧（bz 忽略未知键）。
   */
  lastPosition?: PositionSnapshot;
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
   * 标注（划线 / 想法 / 书签）最后一次变更的时间。
   *
   * 与 `updatedAt` 分两条时间线（A-15）：翻页只动阅读进度，不该刷新
   * `updatedAt`；否则两台设备（一台在读、一台在写想法）合并时，整本按
   * `updatedAt` 二选一，刚写的标注会被另一次翻页盖掉。
   * `mergeData` 对 notes 取这个值大的那份，其余字段仍按 `updatedAt`。
   * 旧数据没有这个字段时按 0 处理（见 data/store.ts 的 mergeData）。
   * bz 侧读到不认识的键会忽略，不影响数据同构。
   */
  notesUpdatedAt?: number;
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
  /**
   * 外部消费者（bz 书库）判断字段代际用。读侧不校验它——
   * 旧文件没有这个键时按 `SCHEMA_VERSION` 补上（见 store.ts）。
   */
  schemaVersion: typeof SCHEMA_VERSION;
  books: ReaderBook[];
  /** 全局阅读偏好（字号/行距/主题），缺省见 data/prefs.ts */
  prefs?: unknown;
  /**
   * 桌面端与移动端各一套偏好，互不覆盖。
   *
   * 老的单一 `prefs` 保留为迁移源：新平台槽为空时先读它，
   * 第一次改设置才写自己的槽。字体/行距在手机上合适的值，
   * 到桌面往往要另调一遍——共用一份只会两边都不舒服。
   */
  prefsDesktop?: unknown;
  prefsMobile?: unknown;
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

export const EMPTY_DATA: ReaderData = { version: 1, schemaVersion: SCHEMA_VERSION, books: [] };

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

/**
 * 记录一个新位置：原地改 `position`，并把**被顶掉的那一个**存进 `lastPosition`。
 *
 * 只在 CFI 真的变了时写 lastPosition——翻页回调一秒能来好几次，
 * 同一页反复上报不该把「上一次位置」刷成同一个地方。
 * 章节字段只在本次读到值时更新：定位事件没带章节（TXT、解析失败）时
 * 不要把已知的章节名清空。
 */
export function recordPosition(
  reading: ReadingBlock,
  next: { percent: number; cfi?: string; chapterIndex?: number; chapterTitle?: string; chapterHref?: string },
  now = Date.now(),
): void {
  const prev = reading.position;
  if (next.cfi && prev.cfi && next.cfi !== prev.cfi) {
    reading.lastPosition = { ...prev, savedAt: now };
  }
  prev.percent = next.percent;
  if (next.cfi) prev.cfi = next.cfi;
  if (typeof next.chapterIndex === 'number') prev.chapterIndex = next.chapterIndex;
  if (next.chapterTitle) prev.chapterTitle = next.chapterTitle;
  if (next.chapterHref) prev.chapterHref = next.chapterHref;
}

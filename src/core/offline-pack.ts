/* ============================================================
 * bz-reader · 离线听书包（core/offline-pack.ts）
 *
 * 一个包 = 一本书的目录 + 每章一个音频文件 + 一份 manifest.json：
 *
 *   bz-reader/offline/围城/
 *     manifest.json
 *     第一章.mp3
 *     第二章.mp3
 *
 * 为什么不是「缓存直接跟着库走」：缓存（IndexedDB）只在本机，换设备、
 * 换库就没了；而库内文件会跟着同步。这一层就是把缓存里那些按句存的
 * 音频，压成「一个章一个文件 + 一句话一条时间轴」的可搬运数据。
 *
 * 关键约束：音频文件里没有句子边界。高亮、跳句、续播全靠 manifest 里
 * 的 at / ms，所以这份时间轴必须和音频严格同源——拼 mp3 时顺带算，
 * 不要事后靠码率估。
 *
 * 这个模块只做**纯逻辑**：算时间轴、校验清单、对齐正文。读写库、解码
 * 音频都在调用方，这样规则层能在 node 里逐条断言。
 * ============================================================ */

/** 清单版本。改结构就 +1，旧包一律不认，免得半懂不懂地播错。 */
export const OFFLINE_VERSION = 1;

/** 库内根目录。整目录可被用户直接拷走 / 放进别的库。 */
export const OFFLINE_ROOT = 'bz-reader/offline';

/** 清单文件名 */
export const OFFLINE_MANIFEST = 'manifest.json';

/** 一句话在音频里的位置 */
export interface OfflineMark {
  /** 原文。正文改过之后靠它重新对齐，不靠序号硬配。 */
  text: string;
  /** 起点（毫秒，相对本章文件开头） */
  at: number;
  /** 这句有多长（毫秒） */
  ms: number;
}

export interface OfflineChapter {
  /** 章标题，同时是显示名 */
  title: string;
  /** 书目录下的文件名 */
  file: string;
  /** 本章总时长（毫秒） */
  ms: number;
  /** 音频字节数，给「占了多大」用 */
  bytes: number;
  marks: OfflineMark[];
}

export interface OfflineBook {
  version: number;
  /** 书名（目录名也是它） */
  title: string;
  /** 书的 id。只作辅助——书重新导入后 id 会变，不能当唯一依据 */
  bookId: string;
  engine: string;
  voice: string;
  format: string;
  /** 生成时间（ms） */
  madeAt: number;
  chapters: OfflineChapter[];
}

/** 导出文件名 / 目录名：去掉路径分隔符与 Windows 不认的字符 */
export function safeName(raw: string): string {
  const s = String(raw ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return s || 'audio';
}

/** 一本书的包目录 */
export function packagePath(bookTitle: string): string {
  return `${OFFLINE_ROOT}/${safeName(bookTitle)}`;
}

/**
 * 章名 → 文件名。
 *
 * 带扩展名是因为包里就是真实音频文件，用户在文件管理器里直接点能播；
 * 不带序号前缀是因为章标题本身唯一（同一本书不会有两个「第一章」）。
 */
export function chapterFile(title: string, format: string): string {
  return `${safeName(title)}.${format || 'mp3'}`;
}

/** 时长数组 → 时间轴。两边长度不一致就按短的截，绝不猜。 */
export function buildMarks(texts: readonly string[], ms: readonly number[]): OfflineMark[] {
  const n = Math.min(texts.length, ms.length);
  const out: OfflineMark[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const dur = Number.isFinite(ms[i]) ? Math.max(0, Math.round(ms[i])) : 0;
    out.push({ text: String(texts[i] ?? ''), at, ms: dur });
    at += dur;
  }
  return out;
}

/**
 * 播放到第几毫秒时念的是哪一句。
 *
 * 用二分而不是线性扫：播放器每 250ms 问一次，一章几百句，线性扫
 * 在手机上会白烧电。超出末尾给最后一句——宁可停在末句，也别让高亮
 * 突然消失。
 */
export function markIndexAt(marks: readonly OfflineMark[], ms: number): number {
  if (!marks.length) return -1;
  const t = Number.isFinite(ms) ? ms : 0;
  if (t <= 0) return 0;
  let lo = 0;
  let hi = marks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (marks[mid].at <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 往后看多少句去找同一句话。正文被删掉一大段时还能接上。 */
const ALIGN_WINDOW = 32;

/**
 * 当前正文的句子 → 清单里的句子序号；对不上的给 -1。
 *
 * 为什么不能按下标硬配：用户可能重新排过版、删掉一段、改过错字。按下标
 * 硬配的后果是「从改动处往后全部错位」，听起来像念错了书。这里改成按
 * 文本顺序找，找到才算，找不到这一句就没声音（跳过它继续），其余照常。
 */
export function alignMarks(marks: readonly OfflineMark[], texts: readonly string[]): number[] {
  const out: number[] = new Array(texts.length).fill(-1);
  if (!marks.length) return out;
  let j = 0;
  for (let i = 0; i < texts.length; i++) {
    if (j >= marks.length) break;
    if (marks[j].text === texts[i]) {
      out[i] = j;
      j++;
      continue;
    }
    const end = Math.min(marks.length, j + ALIGN_WINDOW);
    let hit = -1;
    for (let k = j + 1; k < end; k++) {
      if (marks[k].text === texts[i]) {
        hit = k;
        break;
      }
    }
    if (hit >= 0) {
      out[i] = hit;
      j = hit + 1;
    }
    /* 没找到：这一句留 -1，j 不动——后面那句可能正好接上 */
  }
  return out;
}

/** 整包的章数 / 总时长 / 总字节，给「已导入几章、多大」用 */
export function offlineTotals(book: OfflineBook): { chapters: number; ms: number; bytes: number } {
  return book.chapters.reduce(
    (acc, c) => ({
      chapters: acc.chapters + 1,
      ms: acc.ms + Math.max(0, c.ms),
      bytes: acc.bytes + Math.max(0, c.bytes),
    }),
    { chapters: 0, ms: 0, bytes: 0 },
  );
}

/**
 * 拿不到精确时长时的兜底：按字节估算。
 *
 * 只有 mp3 能这么算（本地服务固定 64 kbps CBR）。别的格式给 0——瞎猜
 * 出来的时间轴比没有更糟：高亮会稳定地偏，用户还以为包坏了。
 */
export function estimateMs(bytes: number, format: string): number {
  const n = Math.max(0, Math.floor(bytes));
  if (!n) return 0;
  if (format === 'mp3') return Math.round(n / 8); /* 64 kbps = 8 KB/s */
  return 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseMarks(raw: unknown): OfflineMark[] {
  if (!Array.isArray(raw)) return [];
  const out: OfflineMark[] = [];
  for (const m of raw) {
    if (!isRecord(m)) continue;
    const text = str(m.text);
    if (!text) continue;
    out.push({ text, at: Math.max(0, num(m.at)), ms: Math.max(0, num(m.ms)) });
  }
  return out;
}

function parseChapter(raw: unknown): OfflineChapter | null {
  if (!isRecord(raw)) return null;
  const title = str(raw.title).trim();
  const file = str(raw.file).trim();
  if (!title || !file) return null;
  if (/[\\/]/.test(file) || file.startsWith('.')) return null;
  const marks = parseMarks(raw.marks);
  if (!marks.length) return null;
  return {
    title,
    file,
    ms: Math.max(0, num(raw.ms)),
    bytes: Math.max(0, num(raw.bytes)),
    marks,
  };
}

/**
 * 读清单。**任何一处不对都不能抛**——这是用户会从网盘、U 盘、别人的
 * 手机上拷进来的文件，坏了只该「这本书没有离线音频」，不该让整本书
 * 打不开。
 */
export function parseOfflineBook(raw: unknown): OfflineBook | null {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(obj)) return null;
  if (num(obj.version) !== OFFLINE_VERSION) return null;
  const title = str(obj.title).trim();
  if (!title) return null;
  if (!Array.isArray(obj.chapters)) return null;
  const chapters: OfflineChapter[] = [];
  for (const c of obj.chapters) {
    const one = parseChapter(c);
    if (one) chapters.push(one);
  }
  if (!chapters.length) return null;
  return {
    version: OFFLINE_VERSION,
    title,
    bookId: str(obj.bookId),
    engine: str(obj.engine),
    voice: str(obj.voice),
    format: str(obj.format) || 'mp3',
    madeAt: num(obj.madeAt),
    chapters,
  };
}

export function serializeOfflineBook(book: OfflineBook): string {
  return JSON.stringify(book, null, 1);
}

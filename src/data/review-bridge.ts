/* ============================================================
 * bz-reader · 与 bz Review 的运行期契约（data/review-bridge.ts）
 *
 * 分工（2026-11-16 拍板）：
 *   Reader 决定「哪些内容值得复习」——挑章节、让 AI 挑重点、把题出好；
 *   Review 只负责「复习」——排期、会话、统计。
 *
 * 所以这里只做三件事：
 *   1. 探测 Review 装没装（拿不到就降级，绝不抛错）；
 *   2. 把划线 / AI 出的卡片转成 Review 认的形状；
 *   3. 生成稳定的钥匙（同一条划线、同一段正文，重复加入不会排两次）。
 *
 * 跨插件调用一律 `typeof` 守卫：老版本 Review 没有 `reviewApi` 时，
 * 用户看到的应该是一句「没装 Review」，而不是控制台红字。
 * ============================================================ */
import type { App } from 'obsidian';

/** Review 的插件 id（目录名可以改，id 不会） */
export const REVIEW_PLUGIN_ID = 'bz-review';

/** 交给 Review 的一张卡（与 Review 的 ReviewCardInput 对齐，多一个都不传） */
export interface ReviewCardPayload {
  key: string;
  bookTitle: string;
  chapterTitle?: string;
  text: string;
  comment?: string;
  backlink?: string;
  context?: { before?: string; after?: string };
  /** 已经出好的问答对：给了就不在 Review 那边再生成一次 */
  qa?: { q: string; a: string };
  /** 复习方式（增强：方式跟着卡走，Review v2 起认得） */
  mode?: ReviewMode;
  /** 做题卡已经出好的题（Review v2 起落到题库，不再二次生成） */
  questions?: Array<{ q: string; options: string[]; correct: number[]; explain?: string }>;
}

/** 三选一方式（与 Review 的 CardMode 子集对齐：全文回忆/抽认卡/做题） */
export type ReviewMode = 'plain' | 'flashcard' | 'quiz';

export interface ReviewAddSummary {
  added: number;
  exists: number;
  notFound: number;
  /** 免费版额度到顶被拒的条数 */
  rejected?: number;
}

/** 划线卡额度（Review v2 起提供） */
export interface ReviewQuota {
  used: number;
  limit: number;
  remaining: number;
  full: boolean;
}

/** Review 暴露在插件实例上的门面 */
export interface ReviewApi {
  version?: number;
  addCards(cards: ReviewCardPayload[]): Promise<ReviewAddSummary>;
  hasNote?(path: string): Promise<boolean>;
  statusOf?(paths: string[]): Promise<Array<{ path: string; planned: boolean; nextReviewDate?: string | null }>>;
  quota?(): Promise<ReviewQuota>;
  /** v3 起支持：把 bz-review 主界面嵌入外部宿主（书架「复习」页） */
  embedInto?(host: HTMLElement, actionsHost: HTMLElement, onClose: () => void): () => void;
  /** v4：reader 老勾选值迁移 + 读 review 的「新卡默认方式」 */
  setDefaultCardMethod?(mode: string): Promise<void>;
  defaultCardMethod?(): Promise<string | null>;
  /** v4：打开独立复习页并定位到某张卡 */
  focusCard?(key: string): Promise<void>;
}

/**
 * 「装了且支持嵌入」的判据：版本 >= 3 且门面真的带 embedInto。
 *
 * 三处共用同一个判断——设置开关显不显示、书架页签列不列、点击放不放行。
 * 少一处就会出「开关在但页签点不动」这种自相矛盾的界面。
 * `version` 缺省按 0 算：老版本没写版本号，不能因为带了个同名方法就放行。
 */
export function reviewEmbedReady(api: ReviewApi | null): boolean {
  return !!api && (api.version ?? 0) >= 3 && typeof api.embedInto === 'function';
}

/**
 * 找 Review 的门面。
 *
 * 三道守卫缺一不可：插件没装（`plugins[id]` 是 undefined）、装了但没加载完、
 * 老版本没有 `reviewApi`。任何一种都返回 null，由调用方说人话。
 */
export function findReviewApi(app: App): ReviewApi | null {
  const holder = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } })?.plugins?.plugins;
  const plugin = holder?.[REVIEW_PLUGIN_ID] as { reviewApi?: unknown } | undefined;
  const api = plugin?.reviewApi as ReviewApi | undefined;
  if (!api || typeof api.addCards !== 'function') return null;
  return api;
}

/* ─────────── 钥匙 ─────────── */

/** 划线卡的钥匙：`reader:<bookId>:<highlightId>`（与 Review 的约定一致） */
export function markCardKey(bookId: string, markId: string): string {
  return `reader:${String(bookId || '').trim()}:${String(markId || '').trim()}`;
}

/**
 * 正文卡（AI 从章节里挑出来的句子）的钥匙。
 *
 * 没有划线 id 可用，所以拿「书 + 章节 + 句子」算一个稳定短哈希：同一句话
 * 无论挑几次、从哪个入口进来，钥匙都一样，重复加入会被 Review 当成已存在。
 * 只用 32 位 FNV-1a——钥匙只需要「同一库里不撞」，不需要抗碰撞。
 */
export function aiCardKey(bookId: string, chapterTitle: string, text: string): string {
  /* 空白全去掉再算：中文排版里换行/空格只影响观感，同一句话不该因为
     「模型返回时多了个换行」就变成另一张卡。钥匙只要稳定，不需要可读。 */
  const raw = `${String(bookId || '')}\u0001${String(chapterTitle || '')}\u0001${String(text || '').replace(/\s+/g, '')}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `reader:${String(bookId || '').trim()}:ai:${(h >>> 0).toString(36)}`;
}

/* ─────────── 章节分组与字数 ─────────── */

/** 一章的划线概况（「按划线」方式的选择列表） */
export interface MarkChapterGroup {
  /** 章节名（划线自带的那份；没写章节的归到「未命名章节」） */
  title: string;
  /** 章节序号（同名的不同章靠它区分） */
  index: number;
  count: number;
  /** 这些划线的总字数（含想法）——决定发给模型要花多少 */
  chars: number;
}

/** 一条划线在选择列表里需要的最小信息 */
export interface MarkLite {
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  text: string;
  comment: string;
}

/**
 * 把一本的划线按章分组。
 *
 * 用划线自带的 `chapterIndex` / `chapterTitle` 而不是书的目录：用户可能只
 * 划了三章，目录里却有三十章，按目录列会摆出二十七个「0 条」的空行。
 * 同名章节按 `chapterIndex` 分开——有些书每章都叫「注释」。
 */
export function markChapterGroups(marks: readonly MarkLite[]): MarkChapterGroup[] {
  const order: string[] = [];
  const at = new Map<string, MarkChapterGroup>();
  for (const m of marks) {
    const index = Number.isFinite(m.chapterIndex) ? m.chapterIndex : 0;
    const title = String(m.chapterTitle || '').trim();
    const key = `${index}\u0001${title}`;
    let g = at.get(key);
    if (!g) {
      g = { title, index, count: 0, chars: 0 };
      at.set(key, g);
      order.push(key);
    }
    g.count += 1;
    g.chars += Array.from(String(m.text || '')).length + Array.from(String(m.comment || '')).length;
  }
  return order.map((k) => at.get(k)!);
}

/** 选中的章节里一共有多少条划线 / 多少字 */
export function pickedMarkStats(marks: readonly MarkLite[], picked: readonly string[]): { count: number; chars: number } {
  const set = new Set(picked);
  let count = 0;
  let chars = 0;
  for (const m of marks) {
    const index = Number.isFinite(m.chapterIndex) ? m.chapterIndex : 0;
    if (!set.has(`${index}\u0001${String(m.chapterTitle || '').trim()}`)) continue;
    count += 1;
    chars += Array.from(String(m.text || '')).length + Array.from(String(m.comment || '')).length;
  }
  return { count, chars };
}

/** 选中章节的划线（保持原顺序） */
export function pickedMarks(marks: readonly MarkLite[], picked: readonly string[]): MarkLite[] {
  const set = new Set(picked);
  return marks.filter((m) => {
    const index = Number.isFinite(m.chapterIndex) ? m.chapterIndex : 0;
    return set.has(`${index}\u0001${String(m.chapterTitle || '').trim()}`);
  });
}

/* ─────────── 批量规模 ─────────── */

/** 单次发给模型的字数上限：超过就分批（2 万字约 1.5 万 token 输入） */
export const AI_BATCH_CHARS = 20000;
/** 超过这个字数给严重警告（用户可能没意识到在烧钱） */
export const AI_WARN_CHARS = 20000;
/** 超过这个字数直接拦住，不让发 */
export const AI_BLOCK_CHARS = 50000;

/** 按字数把待处理的条目切成批（每批不超过上限，单条超长也自成一派） */
export function batchByChars<T>(items: readonly T[], charsOf: (item: T) => number, limit: number = AI_BATCH_CHARS): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let curChars = 0;
  for (const it of items) {
    const n = Math.max(0, Math.round(Number(charsOf(it)) || 0));
    if (cur.length && curChars + n > limit) {
      out.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(it);
    curChars += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

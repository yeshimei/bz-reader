/* ============================================================
 * bz-reader · AI 对话记录的落盘（data/ai-log.ts）
 *
 * 书架「对话」页读的是 `data/ai-session` 的内存列表；这一层负责把它和
 * `<数据目录>/ai-sessions.json` 对上。README 里那句「问答只活在侧栏里」
 * 从 2026-11-16 起作废：每问完一轮就写一次，启动时读回来。
 *
 * 文件结构固定为：
 *   { "version": 1, "sessions": AiSession[] }
 *
 * 三条纪律，与 data/store 的「宁可少一点，也不能打挂书架」同一个口径：
 *
 *   1. **读坏 = 空列表**：JSON 解析失败、版本不认识、会话缺字段，一律
 *      当成没有记录；书架照常打开，不能因为一份聊天记录起不来。
 *   2. **写坏 = 一条 warn**：磁盘满 / 权限不对不该让刚拿到的 AI 答案消失。
 *      内存里已经记上了，下一次写盘成功时自然补上。
 *   3. **只在问答结束写**：回答是一次性到的（不是流式逐字），所以不存在
 *      「每个字都写」的问题；归档 / 删除各写一次。写入串行排队，
 *      两个请求同时答完也不会互相覆盖。
 *
 * 200 条上限按 `when` 倒序截断：对话页是回看用的，留最近半年的量足够，
 * 再老的记录留在库里只会让每次启动多读几百 KB。
 * ============================================================ */
import type { App } from 'obsidian';
import {
  archiveAiSession,
  aiSessions,
  isAiSessionKind,
  removeAiSession,
  seedAiSessions,
  type AiSession,
  type AiSessionKind,
  type AiSessionTurn,
} from './ai-session';
import { storageDirOf } from '../core/plugin-path';

export const AI_LOG_FILE = 'ai-sessions.json';
export const AI_LOG_VERSION = 1;
/** 只留最近 200 条（按 when 倒序） */
export const AI_LOG_LIMIT = 200;
/** 划词引文最多记 120 字：卡片上本来就只露一行，再长只是白占文件 */
export const AI_LOG_QUOTE_MAX = 120;

export interface AiLogFile {
  version: number;
  sessions: AiSession[];
}

/** `<数据目录>/ai-sessions.json`（vault 相对路径），与书架 JSON 同目录 */
export function aiLogPath(app?: App): string {
  return `${storageDirOf(app)}/${AI_LOG_FILE}`;
}

/** 按字符截断（`Array.from` 不会把 emoji / 生僻字从中间切开），超长补省略号 */
export function clipQuote(text: unknown, max = AI_LOG_QUOTE_MAX): string {
  /* 只认字符串与有限数字：外来 JSON 里冒出对象/数组时宁可当空，
     也别把 `[object Object]` 当成引文写进账本 */
  const raw = typeof text === 'string' ? text : typeof text === 'number' && Number.isFinite(text) ? String(text) : '';
  const flat = raw
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

/**
 * 会话 id：`id-<时间戳>-<随机 4 位>`。
 *
 * 可读是重点：用户在导出的 Markdown 里、控制台里看到它，至少能认出
 * 「这是哪一天问的」。随机段只负责同一毫秒里不撞车，不承担唯一性。
 */
export function makeAiSessionId(when = Date.now(), rand: () => number = Math.random): string {
  const n = Math.floor(rand() * 36 ** 4) % 36 ** 4;
  return `id-${Math.floor(when)}-${n.toString(36).padStart(4, '0')}`;
}

function normalizeTurn(raw: unknown): AiSessionTurn | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.me !== 'boolean' || typeof o.text !== 'string') return null;
  const text = o.text.trim();
  return text ? { me: o.me, text } : null;
}

/**
 * 单条会话收口。
 *
 * 坏记录返回 null（调用方跳过），不抛：一条缺了 kind 的老记录不该让
 * 其余几百条一起作废。`bookTitle` 允许空串——书名缺失是书的问题，
 * 不是记录损坏；`bookId` 必须存在，没有它这条记录挂不回任何一本书。
 */
export function normalizeAiSession(raw: unknown): AiSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const bookId = typeof o.bookId === 'string' ? o.bookId.trim() : '';
  const when = Number(o.when);
  if (!id || !bookId || !isAiSessionKind(o.kind)) return null;
  if (!Number.isFinite(when) || when <= 0) return null;
  if (typeof o.bookTitle !== 'string') return null;
  if (!Array.isArray(o.turns)) return null;

  const turns = o.turns.map(normalizeTurn).filter((x): x is AiSessionTurn => !!x);
  if (!turns.length) return null;

  const s: AiSession = {
    id,
    bookId,
    bookTitle: o.bookTitle.trim(),
    kind: o.kind,
    when: Math.floor(when),
    turns,
  };
  const author = typeof o.author === 'string' ? o.author.trim() : '';
  if (author) s.author = author;
  const quote = typeof o.quote === 'string' ? o.quote.trim() : '';
  if (quote) s.quote = quote;
  /* 2026-11-16：对话绑到划线上。老文件没有这两个字段，照读不误 */
  const markId = typeof o.markId === 'string' ? o.markId.trim() : '';
  if (markId) s.markId = markId;
  const cfi = typeof o.cfi === 'string' ? o.cfi.trim() : '';
  if (cfi) s.cfi = cfi;
  const archivedAt = Number(o.archivedAt);
  if (Number.isFinite(archivedAt) && archivedAt > 0) s.archivedAt = Math.floor(archivedAt);
  return s;
}

/** 时间倒序 + 截到上限（不原地改传入数组） */
export function capAiSessions(list: readonly AiSession[], limit = AI_LOG_LIMIT): AiSession[] {
  const max = Math.max(0, Math.floor(limit) || 0);
  return [...list].sort((a, b) => b.when - a.when).slice(0, max);
}

interface ParsedAiLog {
  sessions: AiSession[];
  /** 结构本身是否可读；空文件（0 字节 / 只有空白）算损坏 */
  ok: boolean;
}

function readAiLogFile(text: string): ParsedAiLog {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { sessions: [], ok: false };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { sessions: [], ok: false };
  const file = raw as Record<string, unknown>;
  if (Number(file.version) !== AI_LOG_VERSION) return { sessions: [], ok: false };
  if (!Array.isArray(file.sessions)) return { sessions: [], ok: false };

  const out: AiSession[] = [];
  const seen = new Set<string>();
  for (const item of file.sessions) {
    const s = normalizeAiSession(item);
    /* 同一个 id 出现两次（手改过 / 两次启动交错写）只认第一条 */
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return { sessions: capAiSessions(out), ok: true };
}

/** 解析整份文件；坏 JSON / 结构缺失 / 版本不认识一律返回空列表，不抛 */
export function parseAiLog(text: string): AiSession[] {
  return readAiLogFile(text).sessions;
}

/**
 * 启动时读回对话记录，并灌进 `data/ai-session` 的内存列表。
 *
 * 没有文件、读失败、内容坏了都只是「这次没有记录」——书架必须照常打开。
 */
export async function loadAiLog(app: App | null | undefined): Promise<AiSession[]> {
  let text = '';
  try {
    const adapter = app?.vault?.adapter;
    if (!adapter) throw new Error('vault adapter unavailable');
    const path = aiLogPath(app);
    if (!(await adapter.exists(path))) {
      seedAiSessions([]);
      return [];
    }
    text = await adapter.read(path);
  } catch {
    seedAiSessions([]);
    return [];
  }

  const parsed = readAiLogFile(text);
  if (!parsed.ok) {
    console.warn('[bz-reader] ai-sessions.json is unreadable; starting with an empty chat log.');
  }
  seedAiSessions(parsed.sessions);
  return aiSessions();
}

/** 写入串行队列：两个回答同时落地时，后一份快照覆盖前一份，不会交错写 */
let writeChain: Promise<unknown> = Promise.resolve();

async function writeAiLogFile(app: App | null | undefined, payload: string): Promise<boolean> {
  const adapter = app?.vault?.adapter;
  /* 迷你测试桩 / 极端降级环境没有 write：不是写失败，只是没地方可写 */
  if (!adapter || typeof adapter.write !== 'function') return false;
  const path = aiLogPath(app);
  const tmp = `${path}.tmp`;
  try {
    const dir = storageDirOf(app);
    if (typeof adapter.mkdir === 'function') await adapter.mkdir(dir).catch(() => undefined);
    /* 先写 tmp 再改名：写一半崩掉时留下的是 tmp，正本仍是上一份完整记录。
       移动端 rename 不覆盖目标时会失败，退回直接写（与 data/store 同口径）。 */
    await adapter.write(tmp, payload);
    if (typeof adapter.rename === 'function') {
      try {
        await adapter.rename(tmp, path);
        return true;
      } catch {
        /* 落到下面的直接写 */
      }
    }
    await adapter.write(path, payload);
    if (typeof adapter.remove === 'function') await adapter.remove(tmp).catch(() => undefined);
    return true;
  } catch (e) {
    /* 只 warn 一次、不向上抛：写盘失败不该让用户刚拿到的答案也跟着丢 */
    console.warn('[bz-reader] failed to write ai-sessions.json:', e);
    if (typeof adapter.remove === 'function') await adapter.remove(tmp).catch(() => undefined);
    return false;
  }
}

/**
 * 把当前内存列表写盘（或写一份指定快照）。
 *
 * 调用点只有三处：问答结束、归档、删除。不是逐字写，也不是每次重绘写。
 */
export function saveAiLog(
  app: App | null | undefined,
  list: readonly AiSession[] = aiSessions(),
): Promise<boolean> {
  const payload = `${JSON.stringify(
    { version: AI_LOG_VERSION, sessions: capAiSessions(list) } satisfies AiLogFile,
    null,
    2,
  )}\n`;
  const run = writeChain.then(
    () => writeAiLogFile(app, payload),
    () => writeAiLogFile(app, payload),
  );
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** 划词 AI 的「这一轮」到「会话 id」的映射；只活在本次运行里 */
const turnGroups = new Map<string, string>();

/** 离开划词 AI 浮框时清掉：下次划同一段，应该重新开一条会话 */
export function resetAiTurnGroups(): void {
  turnGroups.clear();
}

function uniqueSessionId(when: number, used: ReadonlySet<string>): string {
  for (let i = 0; i < 100; i += 1) {
    const id = makeAiSessionId(when);
    if (!used.has(id)) return id;
  }
  /* 随机源被钉死 / 极端撞车：按毫秒偏移再试，格式仍是 id-<时间戳>-<4 位> */
  for (let i = 1; i <= 1296; i += 1) {
    const id = makeAiSessionId(when + i);
    if (!used.has(id)) return id;
  }
  return makeAiSessionId(when, () => 0);
}

export interface RecordAiTurnInput {
  bookId: string;
  bookTitle: string;
  author?: string;
  kind: AiSessionKind;
  /** 划词原文；全书问答不传（kind=book 时也强制忽略） */
  quote?: string;
  /**
   * 同一轮对话的分组键（划词浮框用卡片键）。
   *
   * 有它且这一组已经有会话 → 把这一问一答追加进 turns；没有 → 新建一条。
   * 全书问答不传：侧栏的每一问就是一条独立记录。
   */
  group?: string;
  /**
   * 绑在这条划线上（2026-11-16）。
   *
   * 有它时，即使分组键在本进程里丢了（重启 / 换了那张卡），也能按划线
   * 找回同一条会话继续追加：用户看到的是一段连续对话，而不是每次重启
   * 都新开一条。
   */
  markId?: string;
  /** 同一处的定位串，跟着划线一起记，回看时能落回原文 */
  cfi?: string;
  /**
   * 新建这条会话时想用的 id（侧栏用）。
   *
   * 侧栏在提问前就把会话 id 记进内存（下一问要按它追加），如果落盘这层
   * 另外生成一串，两串就永远对不上——重启之后每一问都会新开一条。
   */
  sessionId?: string;
  ask: string;
  answer: string;
  /** 会话时间；追加时不改（仍是这一轮第一次问答的时间） */
  when?: number;
}

/**
 * 记录一轮问答。
 *
 * 内存先落（书架页签的计数立刻变），再排队写盘。没有书号 / 问或答为空
 * 时不记：对话页上一条没有答案的记录，比没有更让人困惑。
 */
export async function recordAiTurn(
  app: App | null | undefined,
  input: RecordAiTurnInput,
): Promise<string | null> {
  const ask = String(input.ask ?? '').trim();
  const answer = String(input.answer ?? '').trim();
  const bookId = String(input.bookId ?? '').trim();
  if (!ask || !answer || !bookId) return null;

  const when =
    Number.isFinite(input.when) && Number(input.when) > 0 ? Number(input.when) : Date.now();
  const markId = String(input.markId ?? '').trim();
  const groupKey = input.group ? `${bookId}\u0000${input.group}` : '';
  const list = aiSessions();
  const groupedId = groupKey ? turnGroups.get(groupKey) : undefined;
  let session = groupedId ? list.find((s) => s.id === groupedId) : undefined;
  /* 侧栏直接把会话 id 当分组键传进来：重启之后进程内的映射没了，
     但 id 本身还在文件里，认 id 就够了 */
  if (!session && input.group) session = list.find((s) => s.id === input.group);
  if (!session && input.sessionId) session = list.find((s) => s.id === input.sessionId);
  /* 分组键不在了（重启 / 换卡）：按划线找回这条会话，别另开一条 */
  if (!session && markId) {
    session = list.find((s) => s.markId === markId && s.kind === input.kind && s.bookId === bookId);
    if (session && groupKey) turnGroups.set(groupKey, session.id);
  }

  if (session) {
    session.turns.push({ me: true, text: ask }, { me: false, text: answer });
  } else {
    const used = new Set(list.map((s) => s.id));
    /* 调用方给了 id（侧栏先记下「这一轮叫什么」）就用它：不然下一次提问
       带着自己那串 id 回来，跟文件里生成的那串对不上，重启后又会新开一条。 */
    const want = String(input.sessionId ?? '').trim();
    const id = want && !used.has(want) ? want : uniqueSessionId(when, used);
    session = {
      id,
      bookId,
      bookTitle: String(input.bookTitle ?? '').trim(),
      kind: input.kind,
      when: Math.floor(when),
      turns: [
        { me: true, text: ask },
        { me: false, text: answer },
      ],
    };
    const author = String(input.author ?? '').trim();
    if (author) session.author = author;
    if (markId) session.markId = markId;
    const cfi = String(input.cfi ?? '').trim();
    if (cfi) session.cfi = cfi;
    if (input.kind !== 'book') {
      const quote = clipQuote(input.quote);
      if (quote) session.quote = quote;
    }
    list.push(session);
    if (groupKey) turnGroups.set(groupKey, id);
  }

  seedAiSessions(capAiSessions(list));
  await saveAiLog(app);
  return session.id;
}

/**
 * 归档并落盘。
 *
 * 包在 `archiveAiSession` 外面的原因：内存列表是书架页的唯一真相，
 * 落盘顺序必须「先改内存、再写盘」——写盘失败时界面仍然是对的。
 */
export async function archiveAiSessionAndSave(
  app: App | null | undefined,
  id: string,
  at = Date.now(),
): Promise<boolean> {
  if (!archiveAiSession(id, at)) return false;
  await saveAiLog(app);
  return true;
}

export async function removeAiSessionAndSave(
  app: App | null | undefined,
  id: string,
): Promise<boolean> {
  if (!removeAiSession(id)) return false;
  await saveAiLog(app);
  return true;
}

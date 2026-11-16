/* ============================================================
 * bz-reader · AI 对话记录（data/ai-session.ts）
 *
 * 书架「对话」页读的是这一份。落盘真源在 `data/ai-log.ts` 的
 * `ai-sessions.json`：启动时由它把会话灌进来，归档 / 删除 / 追问后由它
 * 回写并再 `seedAiSessions` 同步；这里只是内存副本，别在这一层读写文件。
 *
 * 为什么类型单独一份：页面、导出、测试都只认这几个字段，不认侧栏 / 阅读器
 * 内部的消息形状。适配层在这一份类型上收口，页面不用动。
 * ============================================================ */
import { t, type MsgKey } from '../i18n';
import type { AiSource } from './ai-evidence';

/** 五种对话类型。与原型 chips 一一对应 */
export const AI_SESSION_KINDS = ['explain', 'translate', 'summarize', 'follow', 'book'] as const;
export type AiSessionKind = (typeof AI_SESSION_KINDS)[number];

export function isAiSessionKind(v: unknown): v is AiSessionKind {
  return typeof v === 'string' && (AI_SESSION_KINDS as readonly string[]).includes(v);
}

export interface AiSessionTurn {
  me: boolean;
  text: string;
  /**
   * 这一轮回答的来源（2026-11-17）。
   *
   * 以前只活在侧栏内存里：切回旧对话、重启 Obsidian，答案下面那排可点的
   * 「来源」就没了，只剩一段没法核对的文字。
   */
  sources?: AiSource[];
  /**
   * 半截答案：流式中途失败 / 被用户停止。
   *
   * 不标出来的话，回看时会把半句话当成完整答案；标了就还在原来的位置，
   * 只是多一行说明。
   */
  truncated?: boolean;
}

export interface AiSession {
  id: string;
  bookId: string;
  bookTitle: string;
  author?: string;
  kind: AiSessionKind;
  /** 时间戳（毫秒） */
  when: number;
  /** 划的那一段；全书问答没有引文 */
  quote?: string;
  /**
   * 这段对话绑在哪条划线上（2026-11-16）。
   *
   * 有了它，再点同一条划线就知道「这一份历史是那条线的」——
   * 否则只能靠原文去猜，同一段话划两次就串成一份。
   */
  markId?: string;
  /** 同一处的定位串（EPUB 的 CFI / PDF 的 `pdf/p`）；没有划线的老记录为空 */
  cfi?: string;
  turns: AiSessionTurn[];
  archivedAt?: number;
}

const KIND_KEY: Record<AiSessionKind, MsgKey> = {
  explain: 'shelf.ai.kind.explain',
  translate: 'shelf.ai.kind.translate',
  summarize: 'shelf.ai.kind.summarize',
  follow: 'shelf.ai.kind.follow',
  book: 'shelf.ai.kind.book',
};

/** 会话类型的中文标签（导出块与卡片共用一份，避免两处写法漂移） */
export function aiKindLabel(kind: AiSessionKind): string {
  return t(KIND_KEY[kind] ?? KIND_KEY.explain);
}

let list: AiSession[] = [];

function clone(s: AiSession): AiSession {
  return {
    ...s,
    turns: s.turns.map((x) => ({
      me: x.me,
      text: x.text,
      ...(x.sources ? { sources: x.sources.map((y) => ({ ...y })) } : {}),
      ...(x.truncated ? { truncated: true } : {}),
    })),
  };
}

/** 当前全部会话（副本：调用方改不到内部列表，要改走下面三个写函数） */
export function aiSessions(): AiSession[] {
  return list.map(clone);
}

/**
 * 只问条数（页签徽记用）。
 *
 * 不走 aiSessions().length：那个会把每条会话连同 turns 一起复制一份，
 * 而书架每次重绘（包括阅读器翻页广播）都要这个数字。
 */
export function aiSessionCount(): number {
  return list.length;
}

/** 调试 / 测试用：直接换一整份列表。真实数据接入后由适配层调它。 */
export function seedAiSessions(next: AiSession[]): void {
  list = next.map(clone);
}

export function aiSessionById(id: string): AiSession | undefined {
  const hit = list.find((s) => s.id === id);
  return hit ? clone(hit) : undefined;
}

/** 归档一轮对话。已经归档过的不改时间，返回 false。 */
export function archiveAiSession(id: string, at = Date.now()): boolean {
  const s = list.find((x) => x.id === id);
  if (!s || s.archivedAt) return false;
  s.archivedAt = at;
  return true;
}

export function removeAiSession(id: string): boolean {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/**
 * 删掉一条会话的最后一轮（一问一答）。
 *
 * 「重答」用（2026-11-17）：界面重来一次，记录里也不该留下旧的那份，
 * 否则历史里会出现同一问连着两答，回看时分不清哪个算数。
 * 末尾如果只剩一条提问（上次答到一半就断了），一并去掉。
 */
export function dropLastAiTurn(id: string): boolean {
  const s = list.find((x) => x.id === id);
  if (!s || !s.turns.length) return false;
  const before = s.turns.length;
  /* 末尾是回答就先删回答；紧挨着的提问一并去掉。
     顺序不能反：先清提问的话，`[问, 答]` 会删掉提问、留下一条没有答案的
     孤儿提问，重答后历史里就成了「问 / 问 / 答」。答到一半断在提问（末尾
     是 me）也走这里——那种情况下回答本来就没落下来，只删那条提问。 */
  if (s.turns.length && !s.turns[s.turns.length - 1]?.me) s.turns.pop();
  while (s.turns.length && s.turns[s.turns.length - 1]?.me) s.turns.pop();
  return s.turns.length !== before;
}

/**
 * 删掉一条会话里「问句 == ask」的那一对（2026-11-17，浮框删单轮用）。
 *
 * 浮框的一个键下能攒好几轮追问，`dropLastAiTurn` 只能删最后一对。这里按
 * 问句文本从后往前找——同一句问过两遍时删最近那次，符合「删刚发的这轮」。
 * 找不到返回 false，调用方据此不动界面。
 */
export function dropAiTurnByAsk(id: string, ask: string): boolean {
  const s = list.find((x) => x.id === id);
  const q = String(ask ?? '').trim();
  if (!s || !q) return false;
  for (let i = s.turns.length - 1; i >= 1; i -= 1) {
    const cur = s.turns[i];
    if (!cur?.me || String(cur.text ?? '').trim() !== q) continue;
    /* i 是提问，i+1 是它的回答；两样一起删 */
    s.turns.splice(i, 2);
    return true;
  }
  return false;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 导出块标题里的时间：`2026-11-16 14:32`（与 data/export.ts 的戳同格式） */
function stamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 一轮对话 → 一块 Markdown。
 *
 * 顺序就是读的顺序：引文 → 问 → 答 → 追问 → 答。没有引文（全书问答）
 * 就不写空引用块；一轮都没有的对话返回空串——调用方据此跳过，
 * 不往笔记里留一个只有标题的空块。
 */
export function sessionMarkdown(s: AiSession): string {
  const turns = s.turns.filter((x) => x.text.trim());
  if (!turns.length) return '';

  const lines: string[] = [];
  lines.push(t('shelf.ai.md.title', { when: stamp(s.when), kind: aiKindLabel(s.kind) }));
  lines.push('');

  const quote = String(s.quote ?? '').trim();
  if (quote) {
    /* 多行引文每行都要带 `>`，否则第二行会掉出引用块 */
    lines.push(`> ${quote.replace(/\n+/g, '\n> ')}`);
    lines.push('');
  }

  for (const turn of turns) {
    const text = turn.text.trim();
    lines.push(t(turn.me ? 'shelf.ai.md.me' : 'shelf.ai.md.ai', { text }));
    lines.push('');
  }
  return lines.join('\n').trim();
}

/** 多轮 → 一份 Markdown（块之间空两行）；全空时返回空串 */
export function sessionsMarkdown(next: readonly AiSession[]): string {
  return next
    .map((s) => sessionMarkdown(s))
    .filter(Boolean)
    .join('\n\n');
}

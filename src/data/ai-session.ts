/* ============================================================
 * bz-reader · AI 对话记录（data/ai-session.ts）
 *
 * 书架「对话」页读的是这一份。**本轮不接真实存储**：列表先放在内存里，
 * 等侧栏 / 划词卡那两个并行分支合并后，再把真实对话写进 seedAiSessions。
 *
 * 为什么类型单独一份：页面、导出、测试都只认这几个字段，不认侧栏 / 阅读器
 * 内部的消息形状。等真实数据接进来时，适配层在这份类型上收口，页面不用动。
 * ============================================================ */
import { t, type MsgKey } from '../i18n';

/** 五种对话类型。与原型 chips 一一对应 */
export const AI_SESSION_KINDS = ['explain', 'translate', 'summarize', 'follow', 'book'] as const;
export type AiSessionKind = (typeof AI_SESSION_KINDS)[number];

export function isAiSessionKind(v: unknown): v is AiSessionKind {
  return typeof v === 'string' && (AI_SESSION_KINDS as readonly string[]).includes(v);
}

export interface AiSessionTurn {
  me: boolean;
  text: string;
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
  return { ...s, turns: s.turns.map((x) => ({ me: x.me, text: x.text })) };
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

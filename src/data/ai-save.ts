/* ============================================================
 * bz-reader · AI 答案落库（data/ai-save.ts）
 *
 * 2026-11-10：AI 的答案原来只能「复制」，或者被追加成一段没有出处的
 * `## AI 回答`。这一层只做三件事，都是纯函数，不碰 vault：
 *
 *   1. **导出块**：带任务、日期、出处引用与末尾标记，用户回头能看出
 *      「这是 AI 写的、问的是哪一段」；
 *   2. **想法**：把答案追加到某条划线的想法后面，不覆盖用户自己写的字；
 *   3. **复习卡**：把答案拼进卡片的「AI 提示」段，位置放在末尾标记之前。
 *
 * 三条都幂等：同一段答案重复点，不会在笔记里出现两遍。
 * ============================================================ */
import { t, type MsgKey } from '../i18n';
import { REVIEW_CARD_MARK } from './review-card';

/** 末尾标记：导出文件里认「这段是插件写的」 */
export const AI_MARK = '<!-- bz-reader:ai -->';

export type AiSaveTask = 'explain' | 'translate' | 'summarize' | 'follow';

/** 任务名沿用卡上那几档的说法，多一档追问：同一件事不该有两种叫法 */
const TASK_KEY: Record<AiSaveTask, MsgKey> = {
  explain: 'ai.mode.explain',
  translate: 'ai.mode.translate',
  summarize: 'ai.mode.summarize',
  follow: 'ai.mode.follow',
};

export interface AiAnswerBlockInput {
  task: AiSaveTask;
  /** 划词原文（可选）：只留一小截当出处 */
  quote?: string;
  answer: string;
  /** YYYY-MM-DD */
  day: string;
}

/**
 * 出处只留一行。
 *
 * 60 字是「扫一眼认得出是哪句」与「不把笔记撑长」之间的位置；再长，
 * 导出文件里每段 AI 回答都顶着一整段原文。
 */
export function quoteLine(text: string, max = 60): string {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : flat;
}

/** 一段可以追加进导出文件的 AI 回答；空答案返回空串（调用方据此不写盘） */
export function aiAnswerBlock(input: AiAnswerBlockInput): string {
  const answer = String(input.answer ?? '').trim();
  if (!answer) return '';
  const tag = t(TASK_KEY[input.task] ?? 'ai.mode.explain');
  const quote = quoteLine(input.quote ?? '');
  const lines = [`## ${t('ai.save.heading')} · ${tag} · ${input.day}`];
  if (quote) lines.push(`> 「${quote}」`);
  lines.push('', answer, '', AI_MARK);
  return lines.join('\n');
}

/**
 * 把答案追加成一条想法。
 *
 * `AI：` 前缀是给用户的信号：这段不是他自己写的，回头别当成自己的观点。
 * 已有想法时只追加不改写——用户写的那几个字比模型的一整段更贵。
 */
export function appendAiIdea(comment: string | undefined, answer: string): string {
  const prev = String(comment ?? '').trim();
  const body = String(answer ?? '').trim();
  if (!body) return prev;
  const block = `${t('ai.save.idea')}${body}`;
  if (!prev) return block;
  if (prev.includes(block)) return prev;
  return `${prev}\n\n${block}`;
}

/**
 * 把答案拼进复习卡的「AI 提示」段。
 *
 * 放在末尾标记之前：标记必须在最后一行，重新生成卡片时靠它认
 * 「这篇能覆盖」，提示段在它后面就会被一起冲掉。
 */
export function appendAiReview(card: string, answer: string): string {
  const src = String(card ?? '');
  const body = String(answer ?? '').trim();
  if (!body) return src;
  const block = `**${t('ai.save.review')}**\n\n${body}`;
  if (src.includes(block)) return src;
  const at = src.indexOf(REVIEW_CARD_MARK);
  if (at < 0) return `${src.trimEnd()}\n\n${block}\n`;
  return `${src.slice(0, at).trimEnd()}\n\n${block}\n\n${src.slice(at)}`;
}

/* ─────────── 对话存档（2026-11-11） ─────────── */

/** 存档段落的末尾标记：下次再存时认得出这是插件写的 */
export const AI_LOG_MARK = '<!-- bz-reader:ai-log -->';

export interface AiLogLine {
  /** true = 用户问的 */
  me: boolean;
  text: string;
  /** 这一条答完之后附的来源（侧栏里能点开的那几条） */
  sources?: Array<{ title?: string; note?: string }>;
}

/**
 * 把侧栏的一轮对话整理成一段 Markdown。
 *
 * 与「存为笔记」的区别：那是**一条答案**，这里是**整场对话**——用户
 * 关掉侧栏之后还能回去看当时问过什么、依据是哪几章。
 *
 * 空对话返回空串：调用方据此不写盘、也不弹「已存档」。
 */
export function aiConversationMarkdown(input: {
  bookTitle?: string;
  day: string;
  turns: readonly AiLogLine[];
}): string {
  const turns = (input.turns ?? []).filter((turn) => String(turn?.text ?? '').trim());
  if (!turns.length) return '';

  const book = String(input.bookTitle ?? '').trim();
  const day = String(input.day ?? '').trim();
  const head = `## ${t('ai.log.title')}${book ? ` · ${book}` : ''}${day ? ` · ${day}` : ''}`;
  const lines = [head, ''];

  for (const turn of turns) {
    const who = turn.me ? t('ai.log.me') : t('ai.log.ai');
    const body = String(turn.text).trim().replace(/\n{3,}/g, '\n\n');
    lines.push(`**${who}**：${body}`, '');
    const src = (turn.sources ?? [])
      .map((s) => [String(s?.title ?? '').trim(), String(s?.note ?? '').trim()].filter(Boolean).join(' · '))
      .filter(Boolean);
    if (src.length) lines.push(`> ${t('ai.log.sources')}${src.join('；')}`, '');
  }

  lines.push(AI_LOG_MARK);
  return lines.join('\n');
}

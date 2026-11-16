/* ============================================================
 * bz-reader · AI 答案落库（data/ai-save.ts）
 *
 * 2026-11-10：AI 的答案原来只能「复制」，或者被追加成一段没有出处的
 * `## AI 回答`。这一层只做两件事，都是纯函数，不碰 vault：
 *
 *   1. **导出块**：带任务、日期、出处引用与末尾标记，用户回头能看出
 *      「这是 AI 写的、问的是哪一段」；
 *   2. **想法**：把答案追加到某条划线的想法后面，不覆盖用户自己写的字。
 *
 * 两条都幂等：同一段答案重复点，不会在笔记里出现两遍。
 * ============================================================ */
import { t, type MsgKey } from '../i18n';

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

/* ─────────── 对话存档（2026-11-11） ─────────── */

/** 存档段落的末尾标记：下次再存时认得出这是插件写的 */
export const AI_LOG_MARK = '<!-- bz-reader:ai-log -->';

/**
 * 存档段落的开头标记（2026-11-17）。
 *
 * 老格式只有末尾标记，同一场对话点两次归档就是两份一模一样的段落；
 * 带上会话编号之后，再归档能原地换掉那一段。编号来自侧栏的 `RT.aiChatId`
 * （就是 `ai-sessions.json` 里的会话 id），重启、切历史都认得。
 */
const AI_LOG_START = '<!-- bz-reader:ai-log:';
const START_RE = /^<!-- bz-reader:ai-log:([^\s]+) -->$/;

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
  /** 会话编号：同一场对话再归档时靠它认回原段落 */
  chatId?: string;
}): string {
  const turns = (input.turns ?? []).filter((turn) => String(turn?.text ?? '').trim());
  if (!turns.length) return '';

  const book = String(input.bookTitle ?? '').trim();
  const day = String(input.day ?? '').trim();
  const head = `## ${t('ai.log.title')}${book ? ` · ${book}` : ''}${day ? ` · ${day}` : ''}`;
  const id = String(input.chatId ?? '').trim();
  const lines = [head, ...(id ? [`${AI_LOG_START}${id} -->`] : []), ''];

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

/* ─────────── 归档增量（2026-11-17） ─────────── */

interface LogBlockSpan {
  /** 块区间（字符下标）：从 `## ` 标题行到末尾标记行末 */
  start: number;
  end: number;
  /** 会话编号；老格式（没有开头标记）为空串 */
  id: string;
  /** 用于「内容是否相同」的比较：去掉标题、开头标记与末尾标记，压平空白 */
  body: string;
}

function blockBody(text: string): string {
  return String(text ?? '')
    .split('\n')
    .filter((line) => {
      const s = line.trim();
      return !START_RE.test(s) && s !== AI_LOG_MARK && !/^##\s/.test(s);
    })
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 把文件里已有的存档段落找出来。
 *
 * 新格式靠开头标记认块边界，标题只影响替换区间；老格式没有开头标记，
 * 只能从末尾标记往回找最近的 `## ` 行。**老格式只在正文完全相同时才会
 * 被替换**（调用方先比 body 再动），所以即使猜错起点也只是不合并，
 * 不会把用户的正文截掉一段。
 */
function parseLogBlocks(doc: string): LogBlockSpan[] {
  if (!doc) return [];
  const lines = doc.split('\n');
  const offsets: number[] = [];
  let off = 0;
  for (const line of lines) {
    offsets.push(off);
    off += line.length + 1;
  }

  const out: LogBlockSpan[] = [];
  /** 上一个块结束之后的第一行：往前找块头时不能越过它 */
  let from = 0;
  for (let end = 0; end < lines.length; end += 1) {
    if (lines[end].trim() !== AI_LOG_MARK) continue;
    let head = -1;
    let id = '';
    for (let i = end - 1; i >= from; i -= 1) {
      const m = START_RE.exec(lines[i].trim());
      if (!m) continue;
      id = m[1].trim();
      head = i;
      /* 标题在开头标记的上一行；不是标题就以标记行为起点 */
      if (head - 1 >= from && /^##\s/.test(lines[head - 1])) head -= 1;
      break;
    }
    if (head < 0) {
      for (let i = end - 1; i >= from; i -= 1) {
        if (/^##\s/.test(lines[i])) {
          head = i;
          break;
        }
      }
    }
    if (head >= 0) {
      out.push({
        start: offsets[head],
        end: offsets[end] + lines[end].length,
        id,
        body: blockBody(lines.slice(head + 1, end).join('\n')),
      });
    }
    from = end + 1;
  }
  return out;
}

/**
 * 把一段对话写进笔记：同一场对话只留一份，别的一场对话照常追加。
 *
 * 三种命中顺序：
 *   1. 会话编号相同 → 原地替换（多了新轮次、重答过，都以最新为准）；
 *   2. 正文完全相同（老格式留下的重复段）→ 替换第一份，其余相同的删掉；
 *   3. 都没有 → 追加到文件末尾。
 *
 * 用户手写的内容、另一场对话都不动。
 */
export function upsertAiLogBlock(text: string, block: string, chatId = ''): string {
  const doc = String(text ?? '');
  const incoming = String(block ?? '').trim();
  if (!incoming) return doc;

  const incomingId = String(chatId ?? '').trim();
  const incomingBody = blockBody(incoming);
  const blocks = parseLogBlocks(doc);

  let target = incomingId ? blocks.find((b) => b.id === incomingId) : undefined;
  if (!target && incomingBody) target = blocks.find((b) => b.body === incomingBody);
  if (!target) {
    return doc.trim() ? `${doc.trimEnd()}\n\n${incoming}\n` : `${incoming}\n`;
  }

  /* 同内容的重复块（老版本点两次归档留下的）一并去掉；不同内容的块不动 */
  const drop = incomingBody
    ? blocks.filter((b) => b !== target && b.body === incomingBody)
    : [];
  const edits = [...drop, target].sort((a, b) => b.start - a.start);
  let out = doc;
  for (const b of edits) {
    out = `${out.slice(0, b.start)}${b === target ? incoming : ''}${out.slice(b.end)}`;
  }
  return out.replace(/\n{3,}/g, '\n\n');
}

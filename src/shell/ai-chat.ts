/* ============================================================
 * bz-reader · 侧栏「问这本书」的对话（shell/ai-chat.ts）
 *
 * 2026-11-16 之前，侧栏这份对话只活在 `RT.aiLog` 里：重启 Obsidian、
 * 或者换一本书再切回来，就什么都不剩了。落盘那层（data/ai-log）其实
 * 一直在写，只是没人读回来——这一层就是「读回来」的那一半。
 *
 * 口径：
 *   · 一条会话 = 一次连续对话。点「新建」才起新的，期间连着问都归这条；
 *   · 换书就换对话：A 书问到一半去开 B 书，回来看到的还是 A 书那条；
 *   · 恢复只认 `kind='book'`（侧栏这条链路），划词卡的会话不进侧栏。
 * ============================================================ */
import { aiSessionById, aiSessions, type AiSession } from '../data/ai-session';
import { t } from '../i18n';
import { RT, type AiLogItem } from './runtime';

/** 历史列表的一行 */
export interface AiHistRow {
  id: string;
  /** 首问前 24 字，列表里认得出是哪一次 */
  head: string;
  /** 轮数（一问一答算一轮） */
  n: number;
  when: string;
  /** 和侧栏现在这条是不是同一条 */
  here: boolean;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `11-16 14:32`：列表里不需要年份，今年内的记录都够用 */
export function aiHistWhen(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 会话 → 列表行（纯函数，列表顺序即传入顺序） */
export function aiHistRows(list: readonly AiSession[], currentId: string): AiHistRow[] {
  return list
    .filter((s) => s.kind === 'book' && s.turns.length > 0)
    .map((s) => {
      const first = s.turns.find((x) => x.me) ?? s.turns[0];
      const head = String(first?.text ?? '').replace(/\s+/g, ' ').trim();
      return {
        id: s.id,
        head: head.length > 24 ? `${Array.from(head).slice(0, 23).join('')}…` : head,
        n: Math.max(1, Math.ceil(s.turns.filter((x) => x.me).length)),
        when: aiHistWhen(s.when),
        here: s.id === currentId,
      };
    });
}

/** 这本书的对话，新的在前 */
export function aiChatsOf(bookId: string): AiSession[] {
  if (!bookId) return [];
  return aiSessions()
    .filter((s) => s.bookId === bookId && s.kind === 'book')
    .sort((a, b) => b.when - a.when);
}

/**
 * 会话 → 侧栏气泡。
 *
 * 2026-11-17 起依据也落盘了：恢复出来的回答下面照常有可点的来源行；
 * 半截答案（流式中断 / 被停止）带一行说明，不冒充完整回答。
 */
export function sessionToLog(s: AiSession): AiLogItem[] {
  return s.turns
    .filter((x) => String(x.text ?? '').trim())
    /* 与 pushAi 同一个上限（20 条）：侧栏气泡不是聊天记录，
       一条几百轮的老会话整份塞进来只会卡住重绘 */
    .slice(-20)
    .map((x) => ({
      me: x.me,
      /* 恢复出来的对话不知道当时用的是哪个模型，AI 那条用统一标签 */
      tag: x.me ? t('side.ai.me') : t('side.ai.tag.book'),
      text: x.text,
      ...(x.sources?.length ? { sources: x.sources.map((y) => ({ ...y })) } : {}),
      ...(x.truncated ? { warn: t('side.ai.truncated') } : {}),
    }));
}

/**
 * 把一条会话读进侧栏。
 *
 * 找不到就什么都不做，返回 false——调用方据此决定要不要提示。
 */
export function loadAiChat(sessionId: string): boolean {
  const s = aiSessionById(sessionId);
  if (!s) return false;
  RT.aiLog = sessionToLog(s);
  RT.aiChatId = s.id;
  RT.aiChatBook = s.bookId;
  RT.aiHistOpen = false;
  return true;
}

/**
 * 换到这本书：把最近一条对话读回来。
 *
 * 只在「这本书还没聊过」时动：同一本书里切页签、翻页都会走到这里，
 * 每次都重读会把用户刚问的那一轮吞掉。
 */
export function restoreAiChat(bookId: string): boolean {
  if (RT.aiChatBook === bookId) return false;
  RT.aiChatBook = bookId;
  RT.aiLog = [];
  RT.aiChatId = '';
  if (!bookId) return false;
  const latest = aiChatsOf(bookId)[0];
  return latest ? loadAiChat(latest.id) : false;
}

/**
 * 新建对话：清空视图，下一次提问另起一条。
 *
 * 不做任何落盘动作——旧的那条还在 `ai-sessions.json` 里，历史列表里
 * 找得回来。这也是「清除」和「新建」的区别：新建只是换个空页面。
 */
export function newAiChat(bookId: string): void {
  RT.aiLog = [];
  RT.aiChatId = '';
  RT.aiChatBook = bookId;
  RT.aiHistOpen = false;
  RT.aiDraft = '';
  RT.aiCtx = [];
}

/* ============================================================
 * bz-reader · 提问的依据（data/ai-evidence.ts）
 *
 * 2026-11-07 起，侧栏 AI 不再让用户选「看这一屏 / 连知识库 / 全书」。
 * 一次提问的依据是固定的两段：
 *
 *   1. **这本书自己的块**（必须有）：从全书画像里检索最相关的几块；
 *   2. **bz 知识库的笔记**（可选）：只在设置里打开「连接至 BZ AI 知识库」、
 *      且 bz 可用时才有。没有它照样回答，只是少一层补充。
 *
 * 这里只放与界面无关的纯计算：怎么拼、怎么截、来源怎么标、谁先谁后。
 * 取数据的过程（读画像、算向量、调 bz）在 shell/actions.ts。
 *
 * 一条口径不变：**拼进上下文的字要有上限**。检索可能命中八条笔记，
 * 每条上千字，全塞进去既超窗口也在替用户烧钱。
 * ============================================================ */
import { t } from '../i18n';
import type { BzNoteHit } from './bz-bridge';

/** 来源：带 path 的打开笔记，带 bookId 的打开书；两样都没有的只当说明 */
export interface AiSource {
  title: string;
  /** 库内相对路径（Markdown 笔记） */
  path?: string;
  /** 书号：点开后落到这本书 */
  bookId?: string;
  /** 副标题：命中片段或「第 N 块」 */
  note?: string;
}

/** 一次提问的依据 */
export interface AiEvidence {
  context: string;
  sources: AiSource[];
}

/** 拼进上下文的字数上限：约 4k token 中文，留够回答与历史的余量 */
export const AI_CONTEXT_LIMIT = 9000;

/** 来源最多列几条：来源是佐证，不是第二份结果列表 */
export const AI_SOURCES_MAX = 8;

/** 最后一段至少留多少字才值得拼（更少就是半句话，更容易把模型带偏） */
const MIN_APPEND = 40;

function clip(text: string, max: number): string {
  const s = String(text ?? '').trim();
  if (max <= 0) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * 检索命中 → 给模型看的上下文。
 *
 * 顺序就是相关度顺序（bz 按 score 排好了），不做二次排序：检索分在
 * 不同查询之间不可比，但同一次返回里的先后是有意义的。
 */
export function hitsToContext(hits: readonly BzNoteHit[], limit = AI_CONTEXT_LIMIT): string {
  const parts: string[] = [];
  let used = 0;
  for (const h of hits) {
    const body = String(h.chunk ?? '').trim();
    if (!body) continue;
    const title = String(h.title || h.path || '').trim() || t('common.untitled');
    const head = `【${title}】\n`;
    /* 段之间那两个换行也算字：只算正文就总会超出去几十个字符 */
    const sep = parts.length ? 2 : 0;
    /* 留一个格的余量：最后一条能塞多少塞多少，塞不下就整条不要——
       半句话比没有更容易把模型带偏。 */
    if (used + sep + head.length + body.length > limit) {
      const room = limit - used - sep - head.length - 1; /* 1 留给「…」 */
      if (room > MIN_APPEND) parts.push(head + body.slice(0, room) + '…');
      break;
    }
    parts.push(head + body);
    used += sep + head.length + body.length;
  }
  return parts.join('\n\n');
}

/**
 * 全书这一档的来源。
 *
 * 命中的是「块」，但给用户看的必须是他认的东西：章名 + 第几块。
 * 带上 bookId，点一下能把书打开；没有这一条，来源就只是几行死文字。
 */
export function sourcesOfBlocks(
  bookId: string,
  blocks: ReadonlyArray<{ chapter?: string; index: number }>,
  take = 5,
): AiSource[] {
  const out: AiSource[] = [];
  for (const b of blocks) {
    if (out.length >= take) break;
    const chapter = String(b.chapter ?? '').trim();
    out.push({
      title: chapter || t('side.ai.source.chapter'),
      bookId: bookId || undefined,
      note: t('side.ai.source.block', { n: String(Number(b.index) + 1) }),
    });
  }
  return out;
}

export function sourcesOfHits(hits: readonly BzNoteHit[], take = 5): AiSource[] {
  const out: AiSource[] = [];
  for (const h of hits) {
    if (out.length >= take) break;
    const path = String(h.path ?? '').trim();
    const title = String(h.title ?? '').trim() || path;
    if (!title) continue;
    out.push({ title, path: path || undefined, note: String(h.chunk ?? '').trim().slice(0, 40) });
  }
  return out;
}

function valid(e: AiEvidence | null | undefined): e is AiEvidence {
  return !!e && !!String(e.context ?? '').trim();
}

/** 来源去重：同一本书的同一章、同一篇笔记，不该在依据里出现两遍 */
function dedupeSources(list: readonly AiSource[], max = AI_SOURCES_MAX): AiSource[] {
  const seen = new Set<string>();
  const out: AiSource[] = [];
  for (const s of list) {
    const key = s.path ? `p:${s.path}` : s.bookId ? `b:${s.bookId}|${s.title}` : `t:${s.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 书 + 笔记 → 一份依据。
 *
 * 书在前：用户问的是这本书，笔记是补充。总额度按 AI_CONTEXT_LIMIT 分配，
 * 书先用，笔记吃剩下的；剩下的不够一小段就整段不要——宁可少一层补充，
 * 也不要给模型半句笔记。
 */
export function mergeEvidence(
  book: AiEvidence | null | undefined,
  notes: AiEvidence | null | undefined,
  limit = AI_CONTEXT_LIMIT,
): AiEvidence | null {
  const hasBook = valid(book);
  const hasNotes = valid(notes);
  if (!hasBook && !hasNotes) return null;
  /* 上限为 0 之类的极端调用：只可能来自测试或更紧的模型，一律当「没有依据」 */
  if (limit <= 0) return null;

  if (!hasNotes) {
    const ctx = clip(book!.context, limit);
    return ctx ? { context: ctx, sources: dedupeSources(book!.sources ?? []) } : null;
  }
  if (!hasBook) {
    const ctx = clip(notes!.context, limit);
    return ctx ? { context: ctx, sources: dedupeSources(notes!.sources ?? []) } : null;
  }

  const head = clip(book!.context, limit);
  const room = limit - head.length - 2;
  const tail = room > MIN_APPEND ? clip(notes!.context, room) : '';
  return {
    context: tail ? `${head}\n\n${tail}` : head,
    sources: dedupeSources([...(book!.sources ?? []), ...(tail ? (notes!.sources ?? []) : [])]),
  };
}

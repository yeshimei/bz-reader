/* ============================================================
 * bz-reader · AI 回答依据的三种档位（data/ai-scope.ts）
 *
 * 「当前这一屏 / 连接 AI 知识库 / 全书」三选一，互斥、记住上次选择。
 * 这里只放与界面无关的那部分：档位名、检索结果怎么拼成上下文、
 * 来源怎么列。真正的检索与提问在 shell/actions.ts。
 *
 * 一条口径：**拼进上下文的字要有上限**。知识库一段检索可能命中八条笔记，
 * 每条几百上千字，全塞进去既超出模型窗口，也是在替用户烧钱。
 * ============================================================ */
import { t, type MsgKey } from '../i18n';
import type { BzNoteHit } from './bz-bridge';

export type AiScope = 'screen' | 'brain' | 'book';

export const AI_SCOPES: readonly AiScope[] = ['screen', 'brain', 'book'];

export const DEFAULT_AI_SCOPE: AiScope = 'screen';

export function isAiScope(v: unknown): v is AiScope {
  return v === 'screen' || v === 'brain' || v === 'book';
}

const LABEL_KEY: Record<AiScope, MsgKey> = {
  screen: 'side.ai.scope.screen',
  brain: 'side.ai.scope.brain',
  book: 'side.ai.scope.book',
};

export function aiScopeLabel(scope: AiScope): string {
  return t(LABEL_KEY[scope] ?? LABEL_KEY.screen);
}

/** 来源：带 path 的打开笔记，带 bookId 的打开书；两样都没有的只当说明 */
export interface AiSource {
  title: string;
  /** 库内相对路径（Markdown 笔记） */
  path?: string;
  /** 书号：点开后落到这本书（决策 17「打开对应笔记或书」） */
  bookId?: string;
  /** 副标题：命中片段或「第 N 块」 */
  note?: string;
}

/** 拼进上下文的字数上限：约 4k token 中文，留够回答与历史的余量 */
export const AI_CONTEXT_LIMIT = 6000;

/**
 * 「当前这一屏」在上下文里能占的字数。
 *
 * 决策 8 要求知识库 / 全书两档仍带这一屏，但依据才是这两档的主角——
 * 把这一屏放开不限，一页几千字的正文会把检索出来的证据全挤掉，
 * 这两档就退化成「带了一点点笔记的这一屏问答」。
 */
export const PAGE_CONTEXT_KEEP = 1200;

function clip(text: string, max: number): string {
  const s = String(text ?? '').trim();
  if (max <= 0) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * 依据 + 当前这一屏（决策 8）。
 *
 * 顺序是刻意的：这一屏在前。用户指着屏幕上某句话问「这是什么意思」时，
 * 那句话才是问题本身，检索出来的笔记是补充。以前这里被整体覆盖成依据，
 * 结果切到全书之后，模型看不到用户正在看的那一段。
 */
export function joinScopeContext(evidence: string, page: string, limit = AI_CONTEXT_LIMIT): string {
  const head = `【${t('side.ai.scope.screen')}】\n`;
  const total = Math.max(0, Math.floor(limit) || 0);
  if (!total) return '';
  /* 这一屏的定额不能顶穿上限：limit 被调小时（更紧的模型、测试），定额跟着收。 */
  const pageText = clip(page, Math.min(PAGE_CONTEXT_KEEP, Math.max(0, total - head.length - 2)));
  /* 依据也要截：这一屏为空时以前整段原样返回，9000 字也照发。 */
  const source = clip(evidence, total);
  if (!pageText) return source;
  if (!source) return pageText;
  const room = Math.max(0, total - pageText.length - head.length - 2);
  if (room < 40) return pageText;
  return `${head}${pageText}\n\n${clip(source, room)}`;
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
      if (room > 40) parts.push(head + body.slice(0, room) + '…');
      break;
    }
    parts.push(head + body);
    used += sep + head.length + body.length;
  }
  return parts.join('\n\n');
}

/**
 * 全书这一档的来源（决策 17）。
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

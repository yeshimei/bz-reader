/* ============================================================
 * bz-reader · 问这摞书（data/shelf-ask.ts）
 *
 * 「问这本书」用的是这本的画像；「问这摞书」把几本的块混进同一份依据。
 * 三条硬要求：
 *
 *   1. **只问选中的**：不偷偷扩成全库——用户勾了什么就是什么；
 *   2. **每条依据都带出处**：书名 · 章节。少了它，模型说「某本书认为」
 *      时用户没法核对，「这几本有什么不同说法」这类问题也就答不了；
 *   3. **只认建完的向量画像、模型一致**：换过模型的旧向量与查询向量不在
 *      一个空间，混进来排序就是错的，而且错得没有声音。
 *
 * 检索与跨书语义搜索共用一套（book-search）：同样的嵌入、同样的打分，
 * 差别只在「选谁参战」与「结果怎么拼」。
 * ============================================================ */
import type { App } from 'obsidian';
import { bzEmbedder } from './bz-bridge';
import { can } from './entitlement';
import { loadPortraits, rankBlocks } from './book-ai';
import { pickSemanticHits, type SemanticHit } from './book-search';
import { AI_CONTEXT_LIMIT } from './ai-evidence';
import type { PortraitFile } from './portrait';
import { t } from '../i18n';

/** 与跨书语义搜索同一种命中；分开命名是为了调用处读得懂 */
export type ShelfHit = SemanticHit;

export interface ShelfAskResult {
  hits: ShelfHit[];
  /** 不能问的原因（null = 正常） */
  problem: string | null;
  /** 实际参战的书本数 */
  books: number;
}

/** 每本最多带几段：几本书各说两三句，比一本刷满十段有用 */
const PER_BOOK = 3;

/** 参与问答的块数上限 */
const TOTAL_ASK_HITS = 12;

/**
 * 选中书 → 能参战的画像。
 *
 * 四条同时成立：被选中、向量方案、建完了、模型与当前一致。模型这一条
 * 与 book-search 同口径——理由也一样，宁可少几本，也不给静默的错排序。
 */
export function pickAskPortraits(
  list: readonly PortraitFile[],
  ids: ReadonlySet<string>,
  model: string,
): PortraitFile[] {
  const m = String(model ?? '').trim();
  if (!m || !ids || ids.size === 0) return [];
  return (list ?? []).filter(
    (p) =>
      !!p &&
      ids.has(p.bookId) &&
      p.plan === 'vector' &&
      p.done === true &&
      p.model === m &&
      (p.blocks ?? []).length > 0,
  );
}

/**
 * 跨书依据。
 *
 * 每条前面加【书名 · 章节】——这是模型唯一能知道「谁说的」的线索。超长时
 * 截断并标省略号：宁可少一段，也不要把一份半截话喂回去当依据。
 */
export function mergeShelfEvidence(hits: readonly ShelfHit[], limit = AI_CONTEXT_LIMIT): string {
  const cap = Math.max(200, Math.floor(limit) || AI_CONTEXT_LIMIT);
  const parts: string[] = [];
  let used = 0;
  for (const hit of hits ?? []) {
    const body = String(hit?.chunk ?? '').trim();
    if (!body) continue;
    const title = String(hit.title ?? '').trim() || t('common.untitled');
    const chapter = String(hit.chapter ?? '').trim();
    const head = `【${title}${chapter ? ` · ${chapter}` : ''}】`;
    const block = `${head}\n${body}`;
    if (used + block.length + 2 > cap) {
      /* 第一段就超长：留开头一截（不是空手而归）；否则直接收口 */
      if (!parts.length) {
        const room = cap - head.length - 3;
        if (room > 20) parts.push(`${head}\n${body.slice(0, room)}…`);
      } else {
        parts.push('…');
      }
      break;
    }
    parts.push(block);
    used += block.length + 2;
  }
  return parts.join('\n\n');
}

/**
 * 来源行：同一本书的同一章只留一条。
 *
 * 去重键是 `书 id + 章节`——两段来自同一章时，用户要的是「这章提过」，
 * 不是两行一模一样的出处。
 */
export function shelfSources(
  hits: readonly ShelfHit[],
  take = 8,
): Array<{ bookId: string; title: string; chapter: string; note: string }> {
  const out: Array<{ bookId: string; title: string; chapter: string; note: string }> = [];
  const seen = new Set<string>();
  for (const hit of hits ?? []) {
    if (!hit) continue;
    const bookId = String(hit.bookId ?? '');
    const chapter = String(hit.chapter ?? '').trim();
    const key = `${bookId}|${chapter}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      bookId,
      title: String(hit.title ?? '').trim() || t('common.untitled'),
      chapter,
      note: String(hit.chunk ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40),
    });
    if (out.length >= take) break;
  }
  return out;
}

/**
 * 检索：一次查询向量，逐本画像打分，再按书收口。
 *
 * 没配 bz / 没建画像 / 嵌入服务挂了，三种原因分开返回——用户要的是
 * 「怎么才能用」，不是一句笼统的「没找到」。
 */
export async function askShelf(
  app: App | null | undefined,
  query: string,
  bookIds: readonly string[],
  topK = TOTAL_ASK_HITS,
): Promise<ShelfAskResult> {
  const q = String(query ?? '').trim();
  if (!q) return { hits: [], problem: null, books: 0 };
  if (!can('ai')) return { hits: [], problem: t('search.semantic.pro'), books: 0 };

  const emb = bzEmbedder(app);
  if (!emb.ai) return { hits: [], problem: emb.problem, books: 0 };

  const ids = new Set((bookIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean));
  if (!ids.size) return { hits: [], problem: t('shelf.ask.needPick'), books: 0 };

  let list: PortraitFile[];
  try {
    list = pickAskPortraits(await loadPortraits(app), ids, emb.model);
  } catch {
    return { hits: [], problem: t('shelf.ask.noIndex'), books: 0 };
  }
  if (!list.length) return { hits: [], problem: t('shelf.ask.noIndex'), books: 0 };

  let vec: number[];
  try {
    vec = await emb.ai.embedQuery(q);
  } catch {
    return { hits: [], problem: t('search.semantic.embedFail'), books: list.length };
  }
  if (!vec?.length) return { hits: [], problem: t('search.semantic.embedFail'), books: list.length };

  const ranked = rankBlocks(vec, list, Math.max(1, Math.floor(topK) || TOTAL_ASK_HITS), emb.model);
  return {
    hits: pickSemanticHits(ranked.map((h) => ({ ...h })), PER_BOOK, TOTAL_ASK_HITS),
    problem: null,
    books: list.length,
  };
}

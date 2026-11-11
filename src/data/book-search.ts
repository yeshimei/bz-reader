/* ============================================================
 * bz-reader · 跨书语义搜索（data/book-search.ts）
 *
 * 2026-11-10：全库搜索一直是「逐本开引擎扫全文」——只认字面，问「哪本书
 * 讲过知行合一」得先想到原文里那个词。画像已经建好了（每本一块向量），
 * 这一层把它变成一次真正的语义检索：
 *
 *   1. 查询向量由 bz 算（与建画像同一个模型，向量才在同一个空间）；
 *   2. 只搜「建完的向量画像」——压缩画像没有向量、换过模型的向量不可比，
 *      两条都要挡在门外，否则界面正常、结果全错；
 *   3. 结果按书收口：同一本书最多几条，用户要的是「哪几本书讲过」。
 *
 * 与 book-ai 的分工：那边是「借给 bz 用」（bz 提问时书块当依据），
 * 这边是「自己用」——书架上的按意思搜，入口是命令面板。
 * ============================================================ */
import type { App } from 'obsidian';
import { bzEmbedder } from './bz-bridge';
import { can } from './entitlement';
import { loadPortraits, rankBlocks } from './book-ai';
import { PORTRAIT_TOP_K, type PortraitFile } from './portrait';
import { t, type MsgKey } from '../i18n';

export interface SemanticHit {
  bookId: string;
  /** 书名（空串由界面兜底成「未命名」） */
  title: string;
  chapter: string;
  /** 命中的那一段原文（画像里存的块） */
  chunk: string;
  score: number;
}

export interface SemanticResult {
  hits: SemanticHit[];
  /** 不能搜的原因（null = 正常） */
  problem: string | null;
  /** 参与检索的书本数 */
  books: number;
}

/** 同一本书最多露几条：结果是「哪几本书讲过」，不是把一本书翻个底朝天 */
export const SEMANTIC_PER_BOOK = 3;

/** 一次最多给几条：再多就变成第二个全文搜索了 */
export const SEMANTIC_TOTAL = 20;

/**
 * 哪些画像能参与检索。
 *
 * 三条都要：建完了、是向量方案、模型名与当前一致。第三条最容易被忽略——
 * 换过模型的旧向量与查询向量不在一个空间，算出来的分数看着像回事，
 * 但排序是错的。宁可一本都不返回，也不要给一个静默的错误答案。
 */
export function searchablePortraits(list: readonly PortraitFile[], model: string): PortraitFile[] {
  const m = String(model ?? '').trim();
  if (!m) return [];
  return (list ?? []).filter((p) => !!p && p.plan === 'vector' && p.done === true && p.model === m && (p.blocks ?? []).length > 0);
}

/**
 * 只留指定书号的画像。
 *
 * 书内搜索要「只搜这一本」，但画像文件是按库铺开的；没有这一道，界面说
 * 「本书」、结果却从别的书里冒出来。`bookIds` 为空 = 不限制（全库）。
 */
export function restrictPortraits(
  list: readonly PortraitFile[],
  bookIds?: readonly string[] | null,
): PortraitFile[] {
  if (!bookIds) return [...(list ?? [])];
  const ids = new Set((bookIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean));
  if (!ids.size) return [];
  return (list ?? []).filter((p) => !!p && ids.has(String(p.bookId ?? '')));
}

/**
 * 结果收口：按书限量、总量封顶。
 *
 * 入参已按分数降序（rankBlocks 排好），这里只做截断，不重排——跨查询的
 * 分数不可比，但同一次返回里的先后是有意义的。
 */
export function pickSemanticHits(
  hits: readonly SemanticHit[],
  perBook = SEMANTIC_PER_BOOK,
  total = SEMANTIC_TOTAL,
): SemanticHit[] {
  const capBook = Math.max(1, Math.floor(perBook) || SEMANTIC_PER_BOOK);
  const capTotal = Math.max(1, Math.floor(total) || SEMANTIC_TOTAL);
  const seen = new Map<string, number>();
  const out: SemanticHit[] = [];
  for (const hit of hits ?? []) {
    if (!hit) continue;
    const id = String(hit.bookId ?? '');
    const n = seen.get(id) ?? 0;
    if (n >= capBook) continue;
    seen.set(id, n + 1);
    out.push(hit);
    if (out.length >= capTotal) break;
  }
  return out;
}

/** 一句话进检索：借 bz 算查询向量，再逐本画像打分 */
export async function semanticSearch(
  app: App | null | undefined,
  query: string,
  topK = PORTRAIT_TOP_K * 4,
  bookIds?: readonly string[] | null,
  /**
   * 没激活时要说的那句话。默认是「按意思搜」，主题书单这类借道进来的
   * 入口换成自己的，否则用户点「生成书单」却被告知「按意思搜是高级功能」。
   */
  proKey: MsgKey = 'search.semantic.pro',
): Promise<SemanticResult> {
  const q = String(query ?? '').trim();
  if (!q) return { hits: [], problem: null, books: 0 };
  if (!can('ai')) return { hits: [], problem: t(proKey), books: 0 };

  const emb = bzEmbedder(app);
  if (!emb.ai) return { hits: [], problem: emb.problem, books: 0 };

  let list: PortraitFile[];
  try {
    list = restrictPortraits(searchablePortraits(await loadPortraits(app), emb.model), bookIds);
  } catch {
    return { hits: [], problem: t('search.semantic.noIndex'), books: 0 };
  }
  if (!list.length) return { hits: [], problem: t('search.semantic.noIndex'), books: 0 };

  let vec: number[];
  try {
    vec = await emb.ai.embedQuery(q);
  } catch {
    /* 嵌入服务挂了：这不是「没找到」，要说清楚是服务的问题 */
    return { hits: [], problem: t('search.semantic.embedFail'), books: list.length };
  }
  if (!vec?.length) return { hits: [], problem: t('search.semantic.embedFail'), books: list.length };

  const ranked = rankBlocks(vec, list, Math.max(1, Math.floor(topK) || PORTRAIT_TOP_K), emb.model);
  return {
    hits: pickSemanticHits(ranked.map((h) => ({ ...h }))),
    problem: null,
    books: list.length,
  };
}

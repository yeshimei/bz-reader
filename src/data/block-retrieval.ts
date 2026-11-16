/* ============================================================
 * bz-reader · 全书检索（data/block-retrieval.ts）
 *
 * 以前这一层只有一条向量通道：算查询向量 → 余弦取前六块 → 命中章带回章首。
 * 真机暴露的问题很具体——「方鸿渐回国坐的船叫什么名字」取前六块全是
 * 「方鸿渐」出现最多的日常段落，写着「白拉日隆子爵号」的第一章开头
 * 余弦只有 0.428，排不进前六，模型只能答「书里没有提到」。
 *
 * 现在两条通道并行，各自只做自己擅长的事：
 *
 *   向量：意思像不像（换个说法也找得到）
 *   字面：这个词在不在（专名、数字、引文一字不差）
 *
 * 融合只融名次（RRF），因为两边的分数量纲不可比；收口用「保底 3 条 +
 * 相对门槛 + 按章去重」，最后仍走老的 chapterAwarePicks 做章首补偿——
 * 章首是定义句所在的位置，这条经验是拿真机问题换来的，不丢。
 *
 * 邻居扩展放在候选池里做：命中块的 ±1 块以 0.85 倍分进池，和别的候选
 * 一起竞争名额。这样不额外占预算，跨块断开的论证也能接上。
 * ============================================================ */
import { bm25Rank, type Bm25DocInput } from './bm25';
import { adaptiveCutoff, rrfFuse } from './hybrid-rank';
import { normalizeQuery, queryTerms, quotedSpans, tokenize } from './text-terms';import {
  PORTRAIT_PICK_LIMIT,
  PORTRAIT_TOP_K,
  chapterAwarePicks,
  cosine,
  decodeVector,
  topBlocksByVector,
  type PortraitBlock,
  type PortraitFile,
} from './portrait';

/** 一条依据是怎么被选中的（调试与测试用，不进界面） */
export type PickWhy = 'vector' | 'lexical' | 'both' | 'neighbor' | 'head';

export interface BlockPick {
  block: PortraitBlock;
  /** 在 `p.blocks` 里的下标：邻块扩展与「第几块」都靠它 */
  index: number;
  /** 融合后的名次分（RRF），只用于排序，不跨查询比较 */
  score: number;
  /** 向量余弦（没走这条路就是 0） */
  cosine: number;
  /** 字面 BM25（没走这条路就是 0） */
  lexical: number;
  why: PickWhy;
}

export interface RetrieveOptions {
  /** 最终交给模型的块数（默认 6，见 PORTRAIT_PICK_LIMIT 的预算说明） */
  limit?: number;
  /** 每条通道先取多少候选：三倍于最终条数，章首补偿才有得挑 */
  wide?: number;
}

/** 正文切词缓存：同一块在一个会话里会被问很多次，二字组不必每次重切 */
const bodyTokens = new WeakMap<PortraitBlock, string[]>();

function tokensOf(block: PortraitBlock): string[] {
  const hit = bodyTokens.get(block);
  if (hit) return hit;
  const text = String(block.text || block.summary || block.digest || '');
  const out = tokenize(text);
  bodyTokens.set(block, out);
  return out;
}

/** 这一块的正文（老画像没有 text，退回摘要；两者都没有就是空串） */
function bodyOf(block: PortraitBlock): string {
  return String(block.text || block.summary || block.digest || '').trim();
}

/**
 * 字面通道要过的门槛。
 *
 * 中文里任意两个二字组都能撞上（「一个」「时候」），只命中一个词的块
 * 在书里遍地都是。所以：**至少命中两个查询词**，或者**引号里的原话
 * 一字不差地出现在这一段**。后者是用户明确指名道姓，一个词也认。
 */
const MIN_MATCHED_TERMS = 2;

function lexicalDocs(p: PortraitFile): Bm25DocInput[] {
  return (p.blocks ?? []).map((block, index) => ({
    key: String(index),
    fields: [
      /* 章名单独一个字段：问「第三章讲了什么」时，章名命中比正文擦边更有用 */
      { text: String(block.chapter ?? ''), weight: 2.5 },
      { text: '', weight: 1, tokens: tokensOf(block) },
    ],
  }));
}

/**
 * 字面候选。
 *
 * 返回的是**已排好序**的下标列表（分数在 `scores` 里），供 RRF 使用；
 * 没通过门槛的块在这里就被丢掉，不会进入融合。
 */
export function lexicalPicks(
  p: PortraitFile,
  q: string,
  k = PORTRAIT_TOP_K * 3,
): Array<{ index: number; score: number; matched: number; exact: boolean }> {
  const terms = queryTerms(q);
  if (!terms.length) return [];
  const spans = quotedSpans(q);
  const hits = bm25Rank(lexicalDocs(p), terms, { tokenize: tokenize });
  const take = Math.max(1, Math.floor(Number(k) || PORTRAIT_TOP_K * 3));
  const out: Array<{ index: number; score: number; matched: number; exact: boolean }> = [];
  for (const hit of hits) {
    const index = Number(hit.key);
    if (!Number.isFinite(index) || index < 0) continue;
    const block = p.blocks[index];
    if (!block) continue;
    const body = normalizeQuery(bodyOf(block));
    const exact = spans.some((span) => normalizeQuery(span).length >= 2 && body.includes(normalizeQuery(span)));
    if (!exact && hit.matched < MIN_MATCHED_TERMS) continue;
    out.push({ index, score: hit.score, matched: hit.matched, exact });
  }
  /* 引号命中排在纯分数前面：用户点了名的那句话，比十个擦边词更该进依据 */
  out.sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.index - b.index);
  return out.slice(0, take);
}

/** 向量候选：复用 portrait 的阈值（绝对 0.2 + 相对 0.6），这里只补下标与分数 */
export function vectorPicks(
  p: PortraitFile,
  qvec: readonly number[],
  k = PORTRAIT_TOP_K * 3,
): Array<{ index: number; score: number; cosine: number }> {
  if (!qvec?.length) return [];
  return topBlocksByVector(p, qvec, k).map((hit) => ({
    index: hit.index,
    score: hit.score,
    cosine: hit.score,
  }));
}

function chapterOf(p: PortraitFile, index: number): string {
  return String(p.blocks[index]?.chapter ?? '');
}

/**
 * 候选池的邻居扩展。
 *
 * 只有排在前 `TOP_FOR_NEIGHBORS` 的候选才带邻居：尾部候选本来就弱，
 * 再给它加两块等于把噪声翻三倍。邻居只在同一章内扩——跨章的前后块
 * 讲的是另一件事，接上去反而误导。分数记 0.85 倍：比父块低一档，
 * 竞争不过真正的命中，但比擦边候选高。
 */
const TOP_FOR_NEIGHBORS = 3;
const NEIGHBOR_RATIO = 0.85;

export function withNeighbors(
  p: PortraitFile,
  pool: ReadonlyArray<BlockPick>,
  cap = PORTRAIT_PICK_LIMIT,
): BlockPick[] {
  const out = [...(pool ?? [])];
  const have = new Set(out.map((item) => item.index));
  const tops = [...out].sort((a, b) => b.score - a.score).slice(0, TOP_FOR_NEIGHBORS);
  for (const pick of tops) {
    if (out.length >= cap * 2) break;
    for (const step of [-1, 1]) {
      const index = pick.index + step;
      if (index < 0 || index >= p.blocks.length || have.has(index)) continue;
      if (chapterOf(p, index) !== chapterOf(p, pick.index)) continue;
      have.add(index);
      out.push({
        block: p.blocks[index],
        index,
        score: pick.score * NEIGHBOR_RATIO,
        cosine: 0,
        lexical: 0,
        why: 'neighbor',
      });
    }
  }
  return out;
}

/**
 * 一次检索：向量 + 字面 → RRF → 自适应收口 → 章首补偿。
 *
 * 返回空表示「这本书里确实没有相关段落」，上层据此说「没找到」，
 * 不要让模型对着噪声硬答。
 */
export function retrieveBlocks(
  p: PortraitFile,
  q: string,
  qvec: readonly number[],
  opts: RetrieveOptions = {},
): BlockPick[] {
  const limit = Math.max(1, Math.floor(Number(opts.limit) || PORTRAIT_PICK_LIMIT));
  const wide = Math.max(limit * 3, Math.floor(Number(opts.wide) || 0) || PORTRAIT_TOP_K * 3);
  if (!p?.blocks?.length) return [];

  const vec = vectorPicks(p, qvec, wide);
  const lex = lexicalPicks(p, q, wide);
  if (!vec.length && !lex.length) return [];

  const fused = rrfFuse([vec.map((v) => String(v.index)), lex.map((l) => String(l.index))]);
  const pool: BlockPick[] = [];
  const vecBy = new Map(vec.map((v) => [v.index, v]));
  const lexBy = new Map(lex.map((l) => [l.index, l]));
  for (const [key, score] of fused) {
    const index = Number(key);
    const block = p.blocks[index];
    if (!block) continue;
    const v = vecBy.get(index);
    const l = lexBy.get(index);
    pool.push({
      block,
      index,
      score,
      cosine: v?.cosine ?? 0,
      lexical: l?.score ?? 0,
      why: v && l ? 'both' : v ? 'vector' : 'lexical',
    });
  }

  const expanded = withNeighbors(p, pool, limit);
  /* 收口：保底 3 条、按章去重（六块依据不该全落在同一章）、上限就是预算 */
  const cut = adaptiveCutoff(
    expanded,
    (item) => item.score,
    (item) => String(item.index),
    (item) => chapterOf(p, item.index),
    { floor: Math.min(3, limit), ceiling: limit, ensureDiversity: true },
  );
  /* 章首补偿：命中的章带回它自己的第一块（定义句多半在开头）。
     chapterAwarePicks 会从整本书里取章首，取到的那块可能不在候选池里——
     这时补一条 why = head，分数沿用该章最高分。 */
  const picked = chapterAwarePicks(p, cut, limit);
  const meta = new Map(expanded.map((item) => [item.index, item]));
  const out: BlockPick[] = picked.map((item): BlockPick => {
    const known = meta.get(item.index);
    if (known) return { ...known, score: item.score };
    return { block: item.block, index: item.index, score: item.score, cosine: 0, lexical: 0, why: 'head' };
  });

  /* 引号原话是「用户点了名」，必须进依据——哪怕向量完全不认它、
     哪怕它排在第六名之后。Copilot 对 [[笔记]] 与 #标签 也是这么处理的：
     过滤结果绕开 top-K，直接进上下文。挤掉的是最弱的那块（章首不挤）。 */
  const have = new Set(out.map((item) => item.index));
  for (const hit of lex.filter((x) => x.exact)) {
    if (have.has(hit.index)) continue;
    if (out.length >= limit) {
      let drop = -1;
      for (let i = out.length - 1; i >= 0; i -= 1) {
        if (out[i].why !== 'head') {
          drop = i;
          break;
        }
      }
      if (drop < 0) drop = out.length - 1;
      have.delete(out[drop].index);
      out.splice(drop, 1);
    }
    const known = meta.get(hit.index);
    out.push({
      block: p.blocks[hit.index],
      index: hit.index,
      score: known?.score ?? 0,
      cosine: known?.cosine ?? 0,
      lexical: hit.score,
      why: known?.why ?? 'lexical',
    });
    have.add(hit.index);
  }
  return out.sort((a, b) => b.score - a.score || a.index - b.index);
}

/* ─────────── 跨书：书架上的「按意思搜」 ─────────── */

export interface BookBlockHit {
  bookId: string;
  title: string;
  chapter: string;
  chunk: string;
  score: number;
  /** 在画像里的下标 */
  index: number;
}

/**
 * 跨书混合检索。
 *
 * 与单本同构，只是「组」从章换成书：先让每本书最相关的那块露脸，
 * 再按融合分补——用户问「哪本书讲过知行合一」时，要的是几本书各一条，
 * 不是把一本书翻个底朝天（那一层由 pickSemanticHits 再收一次）。
 *
 * 字面通道在这里尤其重要：书名的专名、外国人名、年份，向量经常糊过去。
 */
export function searchBooksHybrid(
  list: readonly PortraitFile[],
  q: string,
  qvec: readonly number[],
  model: string,
  topK = PORTRAIT_TOP_K * 4,
): BookBlockHit[] {
  const books = (list ?? []).filter((p) => p?.plan === 'vector' && (!model || p.model === model));
  if (!books.length) return [];

  const keyOf = (bookId: string, index: number): string => `${bookId}\u0000${index}`;
  const byKey = new Map<string, { p: PortraitFile; index: number; cos: number }>();
  const docs: Bm25DocInput[] = [];
  const terms = queryTerms(q);

  for (const p of books) {
    (p.blocks ?? []).forEach((block, index) => {
      const body = bodyOf(block);
      if (!body) return;
      const key = keyOf(p.bookId, index);
      let cos = 0;
      if (qvec?.length) {
        const v = decodeVector(block.vec);
        if (v.length && v.length === qvec.length) cos = cosine(qvec, v);
      }
      byKey.set(key, { p, index, cos });
      docs.push({
        key,
        fields: [
          { text: String(block.chapter ?? ''), weight: 2.5 },
          { text: String(p.bookTitle ?? ''), weight: 2 },
          { text: '', weight: 1, tokens: tokensOf(block) },
        ],
      });
    });
  }
  if (!byKey.size) return [];

  const vecRank = [...byKey.entries()]
    .filter(([, v]) => v.cos > 0)
    .sort((a, b) => b[1].cos - a[1].cos)
    .map(([key]) => key);
  const lexRank = terms.length
    ? bm25Rank(docs, terms, { tokenize })
        .filter((hit) => hit.matched >= MIN_MATCHED_TERMS)
        .map((hit) => hit.key)
    : [];

  const fused = rrfFuse([vecRank, lexRank]);
  const hits: BookBlockHit[] = [];
  for (const [key, score] of fused) {
    const rec = byKey.get(key);
    if (!rec) continue;
    const block = rec.p.blocks[rec.index];
    const chunk = bodyOf(block);
    if (!chunk) continue;
    hits.push({
      bookId: rec.p.bookId,
      title: rec.p.bookTitle || '',
      chapter: String(block.chapter ?? ''),
      chunk,
      score,
      index: rec.index,
    });
  }
  /* 按书去重：同一本书先只留最高分那条，别的书先露脸；再由上层按书限量 */
  const take = Math.max(1, Math.floor(Number(topK) || PORTRAIT_TOP_K * 4));
  return adaptiveCutoff(
    hits,
    (item) => item.score,
    (item) => keyOf(item.bookId, item.index),
    (item) => item.bookId,
    { floor: Math.min(3, take), ceiling: take, relativeThreshold: 0.2, ensureDiversity: true },
  );
}

/* ============================================================
 * bz-reader · 字面打分（data/bm25.ts）
 *
 * 向量通道的盲区是「专名、数字、引文」：余弦比的是整体语义像不像，
 * 一个准确写着「白拉日隆子爵号」的段落，可能输给十个都在聊方鸿渐的段落。
 * 字面通道补的就是这一块。
 *
 * 打分用 BM25+（k1 = 1.2 / b = 0.75 / δ = 0.5），与 MiniSearch 的默认值
 * 一致——Copilot for Obsidian 的 Search v3 用它建临时索引，Anthropic 的
 * 「向量 + BM25」混合检索也用它。三个参数都不用调，改了反而不在同一把尺子上。
 *
 * 三处与教科书不同的地方：
 *   · **字段加权**：章名单独一个字段，权重高于正文（2.5 : 1）。问「第三章
 *     讲了什么」时，章名命中比正文擦边更有用；
 *   · **多字段分数相加**，不是把章名拼进正文再算——拼进去会让长块占便宜；
 *   · **只返回命中过的块**：BM25 对不相干的文档给 0，这里直接不返回，
 *     让上层用「命中几个词」再筛一道。
 * ============================================================ */
import { tokenize } from './text-terms';

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

/**
 * BM25+ 的 δ。
 *
 * 普通 BM25 有个老毛病：文档越长，长度归一化把分数压得越低，一个短块里
 * 命中一次可能低于长块里命中三次。δ 给每个命中词一个底分，正是为了
 * 让「短而准」的块不被长块淹没——书里的定义句往往就是短段。
 */
export const BM25_DELTA = 0.5;

export interface Bm25FieldText {
  text: string;
  /** 字段权重：章名 2.5、正文 1（见 block-retrieval 的调用处） */
  weight: number;
  /** 已经切好的词（可选）：正文块反复参与检索，二字组不必每次重切 */
  tokens?: string[];
}

export interface Bm25DocInput {
  key: string;
  fields: Bm25FieldText[];
}

export interface Bm25Hit {
  key: string;
  score: number;
  /** 命中了几个（去重后的）查询词：上层用它区分「真命中」与「擦边」 */
  matched: number;
}

export interface Bm25Options {
  k1?: number;
  b?: number;
  delta?: number;
  /** 切词器（测试可注入；默认与正文索引同一套二字组） */
  tokenize?: (text: string) => string[];
}

interface PreparedDoc {
  key: string;
  fields: Array<{ tokens: string[]; weight: number }>;
}

/** 词频：小数组线性数比建 Map 快，字段通常只有一个查询词几次 */
function tf(tokens: readonly string[], term: string): number {
  let n = 0;
  for (const token of tokens) if (token === term) n += 1;
  return n;
}

/**
 * BM25+ 排序。
 *
 * 入参是「已经切好字段的文档」，出参按分数降序、同分按 key 升序——
 * 同分时的顺序必须稳定，否则同一个问题两次检索给出两份不同的依据，
 * 引文校验与回归测试都会变得不可复现。
 */
export function bm25Rank(
  docs: readonly Bm25DocInput[],
  terms: readonly string[],
  opts: Bm25Options = {},
): Bm25Hit[] {
  const k1 = Math.max(0, Number(opts.k1 ?? BM25_K1) || 0) || BM25_K1;
  const b = Math.min(1, Math.max(0, Number(opts.b ?? BM25_B)));
  const delta = Math.max(0, Number(opts.delta ?? BM25_DELTA) || 0);
  const cut = opts.tokenize ?? tokenize;
  const query = [...new Set((terms ?? []).map((t) => String(t ?? '').trim()).filter(Boolean))];
  if (!docs.length || !query.length) return [];

  const prepared: PreparedDoc[] = docs.map((doc) => ({
    key: doc.key,
    fields: (doc.fields ?? []).map((f) => ({
      tokens: f.tokens ?? cut(String(f.text ?? '')),
      weight: Math.max(0, Number(f.weight) || 0),
    })),
  }));

  /* 字段数按最宽的那份对齐：章名只有一段、正文有多个字段时不能错位 */
  const width = prepared.reduce((n, d) => Math.max(n, d.fields.length), 0);
  const avg: number[] = [];
  for (let i = 0; i < width; i += 1) {
    let sum = 0;
    let n = 0;
    for (const doc of prepared) {
      const f = doc.fields[i];
      if (!f) continue;
      sum += f.tokens.length;
      n += 1;
    }
    avg[i] = n ? Math.max(1, sum / n) : 1;
  }

  /* 文档频率：一个词只要在任一字段出现就算命中这份文档 */
  const df = new Map<string, number>();
  for (const doc of prepared) {
    const seen = new Set<string>();
    for (const f of doc.fields) for (const token of f.tokens) seen.add(token);
    for (const term of query) if (seen.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const N = prepared.length;
  const out: Bm25Hit[] = [];
  for (const doc of prepared) {
    let score = 0;
    let matched = 0;
    for (const term of query) {
      const d = df.get(term) ?? 0;
      if (!d) continue;
      let weighted = 0;
      for (let i = 0; i < doc.fields.length; i += 1) {
        const f = doc.fields[i];
        const n = tf(f.tokens, term);
        if (!n) continue;
        const len = f.tokens.length || 1;
        const norm = 1 - b + b * (len / (avg[i] || 1));
        weighted += f.weight * ((n * (k1 + 1)) / (n + k1 * norm));
      }
      if (!weighted) continue;
      matched += 1;
      /* 概率型 idf：小书里几乎每个块都出现的词（「方鸿渐」）分数自然压低 */
      const idf = Math.log(1 + (N - d + 0.5) / (d + 0.5));
      score += idf * (weighted + delta);
    }
    if (score > 0) out.push({ key: doc.key, score, matched });
  }

  out.sort((x, y) => y.score - x.score || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return out;
}

/* ============================================================
 * bz-reader · 检索用的词（data/text-terms.ts）
 *
 * 全书问答一直是**纯向量**：问「方鸿渐坐的船叫什么」时，前六块全是
 * 「方鸿渐」出现最多的日常段落，真正写着船名的开头排在第七名之后。
 * 这不是嵌入模型不行，是余弦只认「整体像不像」，不认「这个词在不在这儿」。
 *
 * 社区的做法（Copilot for Obsidian 的 Search v3）是另一条通道：
 *   · 中文按**二字组**切开（Continuous CJK 没有空格，整段当一个词等于没切）；
 *   · 西文按 `[a-z0-9_]+` 切；
 *   · 问句里的专名、数字、引号里的原话，单独当「必须命中的词」。
 * 这里只放切词本身，打分在 data/bm25，融合在 data/hybrid-rank。
 * ============================================================ */

/** 中文（含日文假名、韩文）连续段：二字组的原料 */
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/g;

/** 西文词与数字：`gpt-4o` 会被切成 `gpt` / `4o`，够用 */
const ASCII_WORD = /[a-z0-9_]+/g;

/** 引号里的原话：用户明确要求「这句话在书里哪儿」 */
const QUOTED = /[「『“"《]([^」』”"》]{2,60})[」』”"》]/g;

/**
 * 问句里的虚词二字组。
 *
 * 不挡它们，BM25 会把「这本书里**什么**是……」「**怎么**看」的每个块都抬一遍，
 * 等于给所有候选加同一个常数——排序没变，噪声变多。
 * 只列疑问 / 指代 / 连接这三类，不动任何实词（「不是」「没有」这种可能
 * 是正文里的观点词，挡掉会漏）。
 */
const STOP_BIGRAMS = new Set([
  '什么', '怎么', '怎样', '如何', '为何', '为什', '哪些', '哪个', '哪儿', '哪里',
  '是否', '多少', '一下', '这个', '那个', '这些', '那些', '这样', '那样', '这么',
  '那么', '我们', '他们', '它们', '你们', '以及', '还有', '但是', '因为', '所以',
  '如果', '就是', '可以', '一个', '一种', '这本', '那本', '本书', '书中', '作者',
]);

/**
 * 单字虚词。
 *
 * 单字连续段（「与」「的」）在正文里必须保留——否则「他」这种一字的句子
 * 切不出词；但查询词表里留着它，等于给每个块加同一个常数。只挡虚词。
 */
const STOP_CHARS = new Set([
  '的', '了', '与', '和', '在', '是', '他', '她', '它', '我', '你', '这', '那',
  '也', '就', '都', '而', '及', '把', '被', '给', '对', '从', '到', '有', '个',
  '们', '吗', '呢', '吧', '啊', '呀', '着', '过', '地', '得', '之', '其',
]);

/** 统一大小写与空白：查询词与正文必须过同一道归一化，否则永远匹配不上 */
export function normalizeQuery(text: string): string {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 正文 / 查询的切词。
 *
 * 中文用二字组（`知行合一` → `知行` `行合` `合一`），这是无词典分词里
 * 召回最稳的做法：不需要知道词边界，任意两字相邻就是一个可检索单元。
 * 单字连续段（「他」）保留单字，否则一个字的问题切不出任何词。
 */
export function tokenize(text: string): string[] {
  const s = normalizeQuery(text);
  if (!s) return [];
  const out: string[] = [];
  for (const word of s.match(ASCII_WORD) ?? []) out.push(word);
  for (const run of s.match(CJK_RUN) ?? []) {
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) out.push(run.slice(i, i + 2));
  }
  return out;
}

/** 去重且保序：查询词表要稳定，测试与排序才可复现 */
function uniq(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const v = String(item ?? '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** 引号里被明确点名的原话（已归一化；一段最多留 60 字） */
export function quotedSpans(text: string): string[] {
  const s = normalizeQuery(text);
  const out: string[] = [];
  for (const m of s.matchAll(QUOTED)) {
    const span = String(m[1] ?? '').trim();
    if (span.length >= 2) out.push(span);
  }
  return uniq(out);
}

/**
 * 查询词表：BM25 的打分依据。
 *
 * 与 `tokenize` 的差别只有一条：把纯虚词的二字组去掉。正文切词不去，
 * 否则「什么」在正文里就不算了，索引与查询的口径会不一致。
 */
export function queryTerms(text: string): string[] {
  const all = tokenize(text);
  const terms = all.filter((t) => {
    if (t.length === 2 && STOP_BIGRAMS.has(t)) return false;
    if (t.length === 1 && STOP_CHARS.has(t)) return false;
    return true;
  });
  /* 全是虚词（「这是怎么回事」）时退回全量：宁可多带两个噪声词，也不要空词表 */
  return uniq(terms.length ? terms : all);
}

/**
 * 这一段命中了几个查询词（去重）。
 *
 * 纯字面通道的门槛：只命中一个二字组的块在中文书里遍地都是
 * （「一个」「时候」），必须两个以上才算「这段真的在讲这个问题」。
 */
export function countMatchedTerms(tokens: readonly string[], terms: readonly string[]): number {
  if (!tokens.length || !terms.length) return 0;
  const bag = new Set(tokens);
  let n = 0;
  for (const term of terms) if (bag.has(term)) n += 1;
  return n;
}

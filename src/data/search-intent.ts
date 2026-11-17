/* ============================================================
 * bz-reader · 按意思搜的意图改写（data/search-intent.ts）
 *
 * 2026-11-17：按意思搜以前把读者那句口语直接拿去算向量——「哪本书讲过
 * 知行合一」里的「哪本书」「讲过」是问句壳，不是检索意图，会把向量往
 * 噪声那边拉。这里在 embedding 之前加一层 chat 模型，先把口语压成一行
 * 紧凑的检索词，再交给 bz 算向量。
 *
 * 两条边界：
 *   1. 字面通道仍用**原话**（见 book-search.ts）——专名、年份、引文靠它
 *      捞回，AI 改写丢掉的那些字不能连字面通道一起丢；
 *   2. AI 挂了 / 超时 / 没配好就静默退回原话——多一次调用是增强，不是
 *      搜索的前置条件，不能让「按意思搜」整体不可用。
 *
 * 只放纯函数与可注入的 ask，真请求由调用方用 aiPostChat 接上；node 里
 * 测这一层不用造网络。
 * ============================================================ */
import type { AiMessage } from './ai';

/** 改写后的检索词上限：太长反而稀释向量，够把一句口语压成几个词就行 */
export const QUERY_INTENT_LIMIT = 60;

const INTENT_SYSTEM =
  '你是检索助手。读者会用一句口语描述想找的书，比如「哪本书讲过知行合一」。' +
  '把它改写成一行紧凑的检索词：保留书名、人名、地名、年份、专有名词和核心概念，' +
  '去掉「哪本书」「讲过」「有没有」「帮我找」这类问句壳。' +
  '不做解释、不补充、不打分，只输出检索词本身，不要任何前缀。';

/** 模型偶尔会带个「检索词：」的帽子，剥掉再送进向量 */
const PREFIX_RE = /^\s*(?:检索词|关键词|查询词|query)\s*[:：]\s*/i;
/** 模型爱给检索词套引号，中英文都剥 */
const WRAP_RE = /^[「『"'“]+|[」』"'”]+$/g;

/** 拼出给模型的一问：system 定规则，user 放原话 */
export function buildQueryIntentMessages(query: string): AiMessage[] {
  return [
    { role: 'system', content: INTENT_SYSTEM },
    { role: 'user', content: String(query ?? '').trim() },
  ];
}

/**
 * 从回复里取干净的检索词。
 *
 * 取第一行、剥前缀与包裹引号、限长；空回复回退原话。绝不把模型那一整段
 * 解释塞进向量——那比不改写还糟。
 */
export function parseQueryIntent(text: string, fallback: string): string {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  const first = raw.split('\n').find((line) => line.trim()) ?? '';
  const cleaned = first.trim().replace(PREFIX_RE, '').replace(WRAP_RE, '').trim();
  if (!cleaned) return String(fallback ?? '').trim();
  return cleaned.length > QUERY_INTENT_LIMIT ? cleaned.slice(0, QUERY_INTENT_LIMIT) : cleaned;
}

/** 调用方注入的 ask（真实现用 aiPostChat；测试注入假函数） */
export type IntentAsk = (messages: AiMessage[]) => Promise<string>;

/**
 * 把一句口语压成检索词。任何失败都退回原话，搜索照常走。
 */
export async function refineQuery(ask: IntentAsk, query: string): Promise<string> {
  const q = String(query ?? '').trim();
  if (!q) return q;
  try {
    const text = await ask(buildQueryIntentMessages(q));
    return parseQueryIntent(text, q);
  } catch {
    return q;
  }
}

/* ============================================================
 * bz-reader · 正文搜索命中（shell/text-search.ts）
 *
 * 引擎（foliate search）返回的命中形状与界面要的不完全一样：
 *   · `excerpt` 可能是字符串，也可能是 `{ pre, match, post }`（P3-23 的真实形状）；
 *   · 偶尔会给重复 CFI；
 *   · 没有 CFI 的命中点了也跳不过去。
 *
 * 这些归一放在纯函数里，视图只管画。不归一就会出现「结果里一条带
 * undefined」「点两条跳到同一处」这类只在特定书上复现的怪现象。
 * ============================================================ */

export interface TextHit {
  cfi: string;
  excerpt: string;
  chapterLabel: string;
  chapterIndex: number;
}

export interface RawTextHit {
  cfi?: string;
  excerpt?: string | { pre?: string; match?: string; post?: string };
  chapterLabel?: string;
  chapterIndex?: number;
}

/** 正文搜索一次最多留这么多条：再多由界面按 50 条一屏展开，不一次性画满 */
const MAX_HITS = 300;

function flatExcerpt(e: RawTextHit['excerpt']): string {
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return `${e.pre ?? ''}${e.match ?? ''}${e.post ?? ''}`;
  return '';
}

/**
 * 依据原文 → 书内搜索用的词（2026-11-17 重做）。
 *
 * 三条硬约束（两条是 2026-11-17 真机「依据跳转全错」的直接原因）：
 *   1. **不能把空白压成空格再搜**：引擎的搜索是把文本节点原样拼起来比的
 *      （`strs.join('')`），段落之间是换行；原文把 `\n` 换成 `' '` 之后，
 *      从第一个换行起就再也对不上，搜不到就退化成「全书第一次出现」。
 *   2. **取一行完整的原文**，不跨行拼：块里的换行可能被 normalize 过
 *      （连续空行合并），跨行拼出来的串不一定还是书里的连续子串。
 *   3. 行内空白原样保留（原文一个空格，书里也是一个空格）。
 *
 * 章节标题那种一两字的短行不当定位词（会命中全书几十处），跳过；
 * 全都短时退而取最长的那行——总比空着强。
 */
const MIN_LINE = 6;

export function jumpKey(snippet: string, max = 28): string {
  const clean = (s: string): string =>
    s
      .replace(/^[\s「『“"'（(【[]+/, '')
      .replace(/[\s」』”"'）)】\]]+$/, '')
      .replace(/…+/g, '')
      .trim();
  const lines = String(snippet ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(clean)
    .filter(Boolean);
  if (!lines.length) return '';
  const pick =
    lines.find((s) => Array.from(s).length >= MIN_LINE) ??
    lines.reduce((a, b) => (Array.from(b).length > Array.from(a).length ? b : a));
  const chars = Array.from(pick);
  return chars.length > max ? chars.slice(0, max).join('') : pick;
}

function chapterKey(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[「」『』“”"'’]/g, '')
    .trim();
}

/**
 * 依据跳转该落到哪一条命中。
 *
 * 同一句原文在整本书里常常出现好几次（尤其对白）。依据写着第几章，
 * 却跳「书里第一次出现」，就会落到别的章——这就是「点了依据去错地方」。
 *
 * 精确匹配排在最前：目录里「序」与「序言」、「第一章」与「第一章 方鸿渐」
 * 同时存在时，「包含」会把「序」认成「序言」。
 *
 * 2026-11-17 真机：目标章里一条都没有时**不再退回第一条**。回退等于
 * 「点附录、跳到第九章的注释」——用户看到的就是「依据乱跳」。返回
 * undefined 后调用方落到那一章开头，位置不精确但章是对的。
 * 只有**没有章名**（PDF / 老来源）时才用第一条。
 */
export function pickChapterHit(
  hits: readonly TextHit[],
  chapter: string,
): TextHit | undefined {
  if (!hits.length) return undefined;
  const want = chapterKey(chapter);
  if (!want) return hits[0];
  const exact = hits.find((h) => chapterKey(h.chapterLabel) === want);
  if (exact) return exact;
  return hits.find((h) => {
    const label = chapterKey(h.chapterLabel);
    return !!label && (label.includes(want) || want.includes(label));
  });
}

export function toTextHits(raw: readonly RawTextHit[], max = MAX_HITS): TextHit[] {
  const out: TextHit[] = [];
  const seen = new Set<string>();
  for (const h of raw) {
    const cfi = typeof h.cfi === 'string' ? h.cfi : '';
    if (!cfi || seen.has(cfi)) continue;
    seen.add(cfi);
    out.push({
      cfi,
      excerpt: flatExcerpt(h.excerpt),
      chapterLabel: typeof h.chapterLabel === 'string' ? h.chapterLabel : '',
      chapterIndex: typeof h.chapterIndex === 'number' ? h.chapterIndex : 0,
    });
    if (out.length >= max) break;
  }
  return out;
}

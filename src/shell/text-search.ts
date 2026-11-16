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
 * 依据原文 → 书内搜索用的词（2026-11-16）。
 *
 * 以前是「原文前 24 字」，两个后果：
 *   · 截断常常停在半句上，句末的标点、下句开头的引号对不上，搜不到；
 *   · 原文里带省略号 / 引号时整串都搜不到，于是「点了依据没反应」。
 * 现在先取第一句完整的话，去掉首尾的引号与省略号，再按上限截。
 */
export function jumpKey(snippet: string, max = 28): string {
  const flat = String(snippet ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s「『“"'（(【[]+/, '')
    .replace(/[\s」』”"'）)】\]]+$/, '')
    .replace(/…+/g, '')
    .trim();
  if (!flat) return '';
  const end = flat.search(/[。！？!?；;]/);
  const sentence = end >= 8 ? flat.slice(0, end + 1) : flat;
  const chars = Array.from(sentence);
  return chars.length > max ? chars.slice(0, max).join('') : sentence;
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
 * 章名对不上（老记录、PDF 页码改名）才退回第一条。
 */
export function pickChapterHit(
  hits: readonly TextHit[],
  chapter: string,
): TextHit | undefined {
  if (!hits.length) return undefined;
  const want = chapterKey(chapter);
  if (!want) return hits[0];
  const hit = hits.find((h) => {
    const label = chapterKey(h.chapterLabel);
    return !!label && (label === want || label.includes(want) || want.includes(label));
  });
  return hit ?? hits[0];
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

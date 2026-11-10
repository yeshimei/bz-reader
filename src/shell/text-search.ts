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

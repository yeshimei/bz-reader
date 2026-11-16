/* ============================================================
 * bz-reader · 两路结果的融合与收口（data/hybrid-rank.ts）
 *
 * 两条通道各给一份排序：向量（像不像）与字面（有没有这个词）。
 * 它们的分数量纲完全不同——余弦是 0–1，BM25 是无上界的对数分，
 * 直接相加就是「谁的单位大听谁的」。所以先融合名次，不融合分数。
 *
 * 融合用 RRF（Reciprocal Rank Fusion）：每个候选的得分 = Σ 1/(k + 名次)。
 * k 取 60，与检索领域的通行取值一致。它的好处是**不需要归一化**，
 * 也不怕某一路给出很夸张的分数；坏处是丢掉了分数差，所以两路各自的
 * 绝对门槛仍要保留（见 portrait 的 PORTRAIT_MIN_SCORE 与 block-retrieval
 * 的「至少命中两个词」）。
 *
 * 收口用 Copilot for Obsidian 的 adaptiveCutoff：先保底 floor 条，
 * 再按「最高分的 30%」划线，最后按组（书里是「章」）去重取多样。
 * floor 3 / ceiling 30 / relativeThreshold 0.3 直接照抄；绝对门槛不能照抄——
 * Copilot 那边是 MiniSearch 的绝对分（0.01），这里的分数是 RRF，量级只有
 * 0.016 上下，用 0.01 会把绝大多数候选挡在门外，所以改成 0.0001（只挡 0）。
 * ============================================================ */

/** RRF 的平滑常数：越小越看重头部，60 是通行值 */
export const RRF_K = 60;

/** 保底条数：再差也要给模型三块，否则一个措辞没对上就整题拒答 */
export const ADAPTIVE_FLOOR = 3;

/** 上限：再多就是「把整章塞进去」，本地模型反而答得更差 */
export const ADAPTIVE_CEILING = 30;

/** 相对门槛：低于最高分 30% 的候选，只有在保底没凑满时才收 */
export const ADAPTIVE_REL = 0.3;

/** 绝对门槛：分数低于这个值一律不收（RRF 分数量级 ~0.016，这里只挡 0 与负分） */
export const ADAPTIVE_MIN = 0.0001;

/**
 * 名次融合。
 *
 * `lists` 里每一份是**已排好序**的 key 列表（第一份是向量，第二份是字面）。
 * 名次从 1 起算（`1/(k+1)` 给第一名），这是 RRF 的通行写法。
 * 同一路里重复的 key 只认最靠前的那次名次——重复本身是上游的 bug，
 * 不该在这里变成双倍加分。
 */
export function rrfFuse(lists: ReadonlyArray<ReadonlyArray<string>>, k = RRF_K): Map<string, number> {
  const fused = new Map<string, number>();
  const kk = Math.max(1, Math.floor(Number(k) || RRF_K));
  for (const list of lists ?? []) {
    const seen = new Set<string>();
    let rank = 0;
    for (const raw of list ?? []) {
      const key = String(raw ?? '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rank += 1;
      fused.set(key, (fused.get(key) ?? 0) + 1 / (kk + rank));
    }
  }
  return fused;
}

/** 融合后按分数降序；同分按 key 升序，保证同一个问题两次检索给出同一份依据 */
export function sortedByScore<T>(
  items: readonly T[],
  scoreOf: (item: T) => number,
  keyOf: (item: T) => string,
): T[] {
  return [...(items ?? [])].sort(
    (a, b) => scoreOf(b) - scoreOf(a) || (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0),
  );
}

export interface AdaptiveCutoffOptions {
  floor?: number;
  ceiling?: number;
  relativeThreshold?: number;
  absoluteMinScore?: number;
  /** 是否按组去重（书里是「章」）；false = 纯按分数截断 */
  ensureDiversity?: boolean;
}

/**
 * 自适应截断（照搬 Copilot 的 adaptiveCutoff）。
 *
 * 三条规则按顺序生效：
 *   1. 分数不到「最高分 × 相对门槛」且已过保底 → 后面的全部不要（已排序，
 *      所以可以直接停）；
 *   2. 去重模式：同一个组（章）先只留最高分那条，别的组先露脸；
 *      剩余的回到第二轮按分数补——**多样性优先于分数**，这样六块依据
 *      不会全落在同一章里；
 *   3. 天花板封顶。
 */
export function adaptiveCutoff<T>(
  items: readonly T[],
  scoreOf: (item: T) => number,
  keyOf: (item: T) => string,
  groupOf: (item: T) => string,
  opts: AdaptiveCutoffOptions = {},
): T[] {
  const floor = Math.max(0, Math.floor(Number(opts.floor ?? ADAPTIVE_FLOOR)));
  const ceiling = Math.max(1, Math.floor(Number(opts.ceiling ?? ADAPTIVE_CEILING)));
  const rel = Math.max(0, Number(opts.relativeThreshold ?? ADAPTIVE_REL));
  const absMin = Math.max(0, Number(opts.absoluteMinScore ?? ADAPTIVE_MIN));
  const diverse = opts.ensureDiversity !== false;
  if (!items?.length) return [];

  const sorted = sortedByScore(items, scoreOf, keyOf);
  const threshold = Math.max(scoreOf(sorted[0]) * rel, absMin);

  const selected: T[] = [];
  if (!diverse) {
    for (const item of sorted) {
      if (selected.length >= ceiling) break;
      if (selected.length >= floor && scoreOf(item) < threshold) break;
      selected.push(item);
    }
    return selected;
  }

  const seen = new Set<string>();
  const rest: T[] = [];
  for (const item of sorted) {
    const group = groupOf(item);
    if (!seen.has(group) && (selected.length < floor || scoreOf(item) >= threshold)) {
      seen.add(group);
      selected.push(item);
      if (selected.length >= ceiling) return sortedByScore(selected, scoreOf, keyOf);
      continue;
    }
    rest.push(item);
  }
  for (const item of rest) {
    if (selected.length >= ceiling) break;
    if (selected.length >= floor && scoreOf(item) < threshold) break;
    selected.push(item);
  }
  return sortedByScore(selected, scoreOf, keyOf);
}

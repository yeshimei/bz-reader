/* ============================================================
 * bz-reader · 查询向量缓存（data/query-vec-cache.ts）
 *
 * 同一句话问两遍不重算一次嵌入。看起来是小事，实际发生得很频繁：
 * 「这本讲了什么」问完再问一遍、措辞微调后重问、来回对比同一段。
 * 每次 embedQuery 都是一次真实调用——本地服务也要几百毫秒，
 * 云端按字计费。
 *
 * 口径：
 *   · 键是「模型名 + 查询文本」：换了嵌入模型，旧向量作废（与画像的判废
 *     同一套逻辑，模型不同距离没有意义）；
 *   · 容量按条数封顶，先进先出，命中即挪到队尾（Map 的迭代顺序）；
 *   · 只缓存成功且非空的向量，失败不占位。
 * ============================================================ */

/** 默认容量：50 条约等于几十 KB，够覆盖一次连续对话里的往返提问 */
export const QUERY_VEC_CACHE_MAX = 50;

export interface QueryVecCache {
  get(model: string, query: string): number[] | null;
  set(model: string, query: string, vec: readonly number[]): void;
  clear(): void;
  size(): number;
}

function keyOf(model: string, query: string): string {
  /* \u0000 不会出现在查询文本里，用它当分隔符，避免「换模型后撞键」 */
  return `${model}\u0000${query}`;
}

export function createQueryVecCache(max = QUERY_VEC_CACHE_MAX): QueryVecCache {
  const cap = Math.max(1, Math.floor(max) || QUERY_VEC_CACHE_MAX);
  const map = new Map<string, number[]>();
  return {
    get(model, query) {
      const key = keyOf(model, query);
      const hit = map.get(key);
      if (!hit) return null;
      /* 命中即提到队尾：下次淘汰的是真正最久没用的那一条 */
      map.delete(key);
      map.set(key, hit);
      return hit;
    },
    set(model, query, vec) {
      if (!vec?.length) return;
      const key = keyOf(model, query);
      map.delete(key);
      map.set(key, [...vec]);
      while (map.size > cap) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    clear() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}

/** 进程内单例：侧栏问答与追问补检索共用一份 */
export const queryVecCache = createQueryVecCache();

/**
 * 剪藏成书：生成计划（纯函数，node 可测）。
 *
 * 门面给的是「全部源 + 全部文章」，这里按用户勾选与排序整理成书的结构：
 * - 只要选中的源；空源不出现在目录里；
 * - 默认带未读订阅文章，关掉就只收已剪藏的；
 * - 源内可按最新/最早排序，源之间按源清单顺序（订阅列表即编排序）。
 */
import type { ClipChapterState } from '../../engine/clipbook';

/** 计划用文章：正文留空，生成/渲染时按需取 */
export interface ClipPlanArticle {
  key: string;
  title: string;
  url: string;
  author: string;
  date: string;
  body: string;
  saved: boolean;
  state: ClipChapterState;
  notePath?: string | null;
}

export interface PlanArticle extends ClipPlanArticle {
  sourceId: string;
  sourceName: string;
  ts: number;
}

export interface PlanSource {
  id: string;
  name: string;
}

export type ClipOrder = 'newest' | 'oldest';

export interface ClipPlanSource {
  id: string;
  name: string;
  articles: ClipPlanArticle[];
}

export interface ClipPlanOptions {
  /** 选中的源 id；空数组 = 全部 */
  sources?: string[];
  /** 是否收未保存的订阅文章（默认 true） */
  includeUnsaved?: boolean;
  order?: ClipOrder;
}

export interface ClipPlan {
  sources: ClipPlanSource[];
  articleCount: number;
  sourceCount: number;
  /** 被过滤掉的篇数（让面板能说「另有 N 篇未收」） */
  filtered: number;
}

export function planClipBook(
  sources: PlanSource[],
  articles: PlanArticle[],
  opts: ClipPlanOptions = {},
): ClipPlan {
  const picked = opts.sources && opts.sources.length ? new Set(opts.sources) : null;
  const includeUnsaved = opts.includeUnsaved !== false;
  const order = opts.order === 'oldest' ? 'oldest' : 'newest';

  const kept = articles.filter((a) => {
    if (picked && !picked.has(a.sourceId)) return false;
    if (!includeUnsaved && a.state !== 'saved') return false;
    return true;
  });
  const filtered = articles.length - kept.length;

  const out: ClipPlanSource[] = [];
  for (const src of sources) {
    if (picked && !picked.has(src.id)) continue;
    const list = kept
      .filter((a) => a.sourceId === src.id)
      .slice()
      .sort((x, y) => (order === 'newest' ? y.ts - x.ts : x.ts - y.ts));
    if (!list.length) continue;
    out.push({
      id: src.id,
      name: src.name,
      articles: list.map(({ sourceId: _s, sourceName: _n, ts: _t, state, ...a }) => ({ ...a, state })),
    });
  }

  return {
    sources: out,
    articleCount: out.reduce((n, s) => n + s.articles.length, 0),
    sourceCount: out.length,
    filtered,
  };
}

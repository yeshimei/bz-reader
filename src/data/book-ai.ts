/* ============================================================
 * bz-reader · 给 bz 的书籍出口（data/book-ai.ts）
 *
 * 与 data/bz-bridge.ts 对称：那边是 bz 借能力给我们，这边是我们借给 bz。
 * 只做两件事，都只在「连接至 BZ AI 知识库」打开时才成立：
 *
 *   1. **统计**：第二大脑要显示「有几本书、多少块」；
 *   2. **检索**：在第二大脑里提问时，书的块要能作为补充依据出现。
 *
 * 三条取舍：
 *   · **只读、不改任何文件**：bz 侧调坏了大不了返回空，书的画像不动；
 *   · **问题向量由这里算**：bz 不知道我们配的是哪个嵌入模型，也不能拿
 *     它自己的模型去算——两套向量不在一个空间里，相似度毫无意义；
 *   · **失败一律收敛成空结果**：第二大脑的核心是笔记，不能因为书这边
 *     出问题就让整个提问挂掉。
 * ============================================================ */
import type { App } from 'obsidian';
import { aiEmbedQuery } from './ai';
import { can } from './entitlement';
import { PORTRAIT_TOP_K, cosine, decodeVector, listPortraits, readPortrait, type PortraitFile } from './portrait';
import type { ReaderSettings } from './settings';

export interface BookAiHit {
  bookId: string;
  /** 书名（第二大脑里当来源标题） */
  title: string;
  chapter: string;
  chunk: string;
  score: number;
}

export interface BookAiStats {
  /** 有几本书建好了可检索的依据 */
  books: number;
  /** 这些书的块数合计 */
  blocks: number;
  /** 正文总字数（按块计） */
  chars: number;
  /** 最近一次建／重建的时间（ms；没有就是 null） */
  lastAt: number | null;
  /** 用过的模型名（去重；换模型会让旧向量作废，界面可据此提示） */
  models: string[];
}

export interface BookAiApi {
  /** 共享开关是否打开（关着时 bz 侧不该显示任何书籍统计） */
  isShared(): boolean;
  stats(): Promise<BookAiStats>;
  search(query: string, topK?: number): Promise<BookAiHit[]>;
}

export interface BookAiDeps {
  app: App | null | undefined;
  settings: () => ReaderSettings;
}

/** 画像文件按 mtime 缓存：一份几十万字，每次提问都重读会把界面拖住 */
const cache = new Map<string, { mtime: number; portrait: PortraitFile }>();

/** 只认「已完成」且形状可用的画像：建到一半的书不该被当成依据 */
function usable(p: PortraitFile | null | undefined): p is PortraitFile {
  return !!p && p.done === true && p.blocks.length > 0;
}

async function loadPortraits(app: App | null | undefined): Promise<PortraitFile[]> {
  const files = await listPortraits(app);
  const out: PortraitFile[] = [];
  for (const f of files) {
    const hit = cache.get(f.bookId);
    if (hit && hit.mtime === f.mtime) {
      if (usable(hit.portrait)) out.push(hit.portrait);
      continue;
    }
    const p = await readPortrait(app, f.bookId);
    if (p) cache.set(f.bookId, { mtime: f.mtime, portrait: p });
    if (usable(p)) out.push(p);
  }
  /* 缓存里可能留着已删的书：以 listPortraits 的结果为准 */
  const live = new Set(files.map((f) => f.bookId));
  for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id);
  return out;
}

function emptyStats(): BookAiStats {
  return { books: 0, blocks: 0, chars: 0, lastAt: null, models: [] };
}

/** 统计聚合（纯函数：只吃已经读完的画像，方便被测试钉住） */
export function summarizePortraits(list: readonly PortraitFile[]): BookAiStats {
  if (!list.length) return emptyStats();
  let blocks = 0;
  let chars = 0;
  let lastAt = 0;
  const models = new Set<string>();
  for (const p of list) {
    blocks += p.blocks.length;
    for (const b of p.blocks) chars += Number(b.chars) || 0;
    if (p.updatedAt) lastAt = Math.max(lastAt, p.updatedAt);
    if (p.model) models.add(p.model);
  }
  return { books: list.length, blocks, chars, lastAt: lastAt || null, models: [...models] };
}

/**
 * 跨书排序（纯函数）。
 *
 * 相似度只在「同一个查询向量 + 同一个模型空间」里可比：维度对不上的块
 * 直接跳过，不拿不同模型的向量硬算一个看起来像分数的东西。
 */
export function rankBlocks(qvec: readonly number[], list: readonly PortraitFile[], topK: number): BookAiHit[] {
  const hits: BookAiHit[] = [];
  for (const p of list) {
    if (p.plan !== 'vector') continue;
    for (const block of p.blocks) {
      const text = String(block.text ?? '').trim();
      if (!text) continue;
      const v = decodeVector(block.vec);
      if (!v.length || v.length !== qvec.length) continue;
      hits.push({
        bookId: p.bookId,
        title: p.bookTitle || '',
        chapter: block.chapter || '',
        chunk: text,
        score: cosine(qvec, v),
      });
    }
  }
  const take = Math.max(1, Math.min(30, Math.floor(topK) || PORTRAIT_TOP_K));
  return hits.sort((a, b) => b.score - a.score).slice(0, take);
}

export function createBookAi(deps: BookAiDeps): BookAiApi {
  const shared = (): boolean => {
    if (!can('ai')) return false;
    return deps.settings().aiKnowledge === true;
  };

  return {
    isShared: shared,

    async stats(): Promise<BookAiStats> {
      if (!shared()) return emptyStats();
      try {
        return summarizePortraits(await loadPortraits(deps.app));
      } catch {
        return emptyStats();
      }
    },

    async search(query: string, topK = PORTRAIT_TOP_K): Promise<BookAiHit[]> {
      const q = String(query ?? '').trim();
      if (!q || !shared()) return [];
      const settings = deps.settings();
      let list: PortraitFile[];
      try {
        list = (await loadPortraits(deps.app)).filter((p) => p.plan === 'vector');
      } catch {
        return [];
      }
      if (!list.length) return [];

      let vec: number[];
      try {
        vec = await aiEmbedQuery(settings, q);
      } catch {
        /* 嵌入服务挂了：书这边没有依据可给，但笔记那边照常 */
        return [];
      }
      return rankBlocks(vec, list, topK);
    },
  };
}

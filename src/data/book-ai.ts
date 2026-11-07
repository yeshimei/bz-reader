/* ============================================================
 * bz-reader · 给 bz 的书籍出口（data/book-ai.ts）
 *
 * 与 data/bz-bridge.ts 对称：那边是 bz 借能力给我们，这边是我们借给 bz。
 * 只做两件事；2026-11-07 起是**自动识别**（bz 在、授权在就成立），不再有开关：
 *
 *   1. **统计**：第二大脑要显示「有几本书、多少块」；
 *   2. **检索**：在第二大脑里提问时，书的块要能作为补充依据出现。
 *
 * 三条取舍：
 *   · **只读、不改任何文件**：bz 侧调坏了大不了返回空，书的画像不动；
 *   · **问题向量走 bz 自己的嵌入**：书的向量就是借它的模型算的，同一个空间，
 *     相似度才有意义（以前两边各算各的，那是「自建向量」时代的做法）；
 *   · **失败一律收敛成空结果**：第二大脑的核心是笔记，不能因为书这边
 *     出问题就让整个提问挂掉。
 * ============================================================ */
import type { App } from 'obsidian';
import { bzEmbedder } from './bz-bridge';
import { can } from './entitlement';
import { PORTRAIT_TOP_K, cosine, decodeVector, listPortraits, readPortrait, type PortraitFile, type PortraitPlan } from './portrait';

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

/**
 * 单本书的清单行（2026-11-08）。
 *
 * 第二大脑的统计面板要把书和笔记摆在一起：来源分布里每本书一行、
 * 最近向量化里按时间和笔记混排。汇总数字不够用，那边要书名与各自的时间。
 */
export interface BookAiBook {
  bookId: string;
  /** 书名（缺失时是空串，由界面兜底成「未命名」——不在这里编名字） */
  title: string;
  /** 可检索的块数 */
  blocks: number;
  /** 正文总字数（按块计） */
  chars: number;
  /** 最近一次建／重建的时间（ms） */
  updatedAt: number;
  /** 产出向量的模型名（vector 方案）；空串 = 没有记录 */
  model: string;
  /** 画像方案：vector 才能检索，compress 只能看要点 */
  plan: PortraitPlan;
}

export interface BookAiApi {
  /** 共享开关是否打开（关着时 bz 侧不该显示任何书籍统计） */
  isShared(): boolean;
  stats(): Promise<BookAiStats>;
  /**
   * 书籍清单（可选方法：老版 bz 不读，新版 bz 没有它就退回汇总行）。
   * 只给「已建好、可检索」的书，按最近更新时间降序。
   */
  books(): Promise<BookAiBook[]>;
  search(query: string, topK?: number): Promise<BookAiHit[]>;
}

export interface BookAiDeps {
  app: App | null | undefined;
}

/** 画像文件按 mtime + size 缓存：一份几十万字，每次提问都重读会把界面拖住 */
const cache = new Map<string, { mtime: number; size: number; portrait: PortraitFile }>();

/** 只认「已完成」且形状可用的画像：建到一半的书不该被当成依据 */
function usable(p: PortraitFile | null | undefined): p is PortraitFile {
  return !!p && p.done === true && p.blocks.length > 0;
}

async function loadPortraits(app: App | null | undefined): Promise<PortraitFile[]> {
  const files = await listPortraits(app);
  const out: PortraitFile[] = [];
  for (const f of files) {
    const hit = cache.get(f.bookId);
    /* 键里带 size：同一秒内重建两次时 mtime 可能一样，内容却已经换了 */
    if (hit && hit.mtime === f.mtime && hit.size === f.size) {
      if (usable(hit.portrait)) out.push(hit.portrait);
      continue;
    }
    const p = await readPortrait(app, f.bookId);
    if (p) cache.set(f.bookId, { mtime: f.mtime, size: f.size, portrait: p });
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
 * 清单聚合（纯函数：只吃已经读完的画像）。
 *
 * 排序：最近更新时间降序；同一时刻按书名——同一次批量重建的几本书
 * 不该随目录枚举顺序在面板里乱跳。时间缺失（0）排最后。
 */
export function summarizeBooks(list: readonly PortraitFile[]): BookAiBook[] {
  return list
    .map((p) => ({
      bookId: p.bookId,
      title: String(p.bookTitle ?? '').trim(),
      blocks: p.blocks.length,
      chars: p.blocks.reduce((n, b) => n + (Number(b.chars) || 0), 0),
      updatedAt: Number(p.updatedAt) || 0,
      model: String(p.model ?? ''),
      plan: p.plan,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}

/**
 * 跨书排序（纯函数）。
 *
 * 相似度只在「同一个查询向量 + 同一个模型空间」里可比：维度对不上、
 * 或者模型名对不上的块直接跳过，不拿不同模型的向量硬算一个看起来像
 * 分数的东西。传了 `model` 就按名字挡（同维度的两个模型拦不住维度守卫）。
 */
export function rankBlocks(
  qvec: readonly number[],
  list: readonly PortraitFile[],
  topK: number,
  model?: string,
): BookAiHit[] {
  const hits: BookAiHit[] = [];
  for (const p of list) {
    if (p.plan !== 'vector') continue;
    if (model && p.model !== model) continue;
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
  /* 自动识别：授权在 + bz 的检索门面在，就算连上了。
     两样逐项降级由 bz-bridge 判，这边不重复实现一套「在不在」的判断。 */
  const shared = (): boolean => can('ai') && !!bzEmbedder(deps.app).ai;

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

    async books(): Promise<BookAiBook[]> {
      if (!shared()) return [];
      try {
        return summarizeBooks(await loadPortraits(deps.app));
      } catch {
        /* 读画像失败只是少一层清单：第二大脑那边退回汇总行，不报错 */
        return [];
      }
    },

    async search(query: string, topK = PORTRAIT_TOP_K): Promise<BookAiHit[]> {
      const q = String(query ?? '').trim();
      if (!q || !shared()) return [];
      let list: PortraitFile[];
      try {
        list = (await loadPortraits(deps.app)).filter((p) => p.plan === 'vector');
      } catch {
        return [];
      }
      if (!list.length) return [];

      /* 查询向量也由 bz 算：两套模型算出来的向量不在一个空间，不能混 */
      let vec: number[];
      let model = '';
      try {
        const embedder = bzEmbedder(deps.app);
        if (!embedder.ai) return [];
        model = embedder.model;
        vec = await embedder.ai.embedQuery(q);
      } catch {
        /* 嵌入服务挂了：书这边没有依据可给，但笔记那边照常 */
        return [];
      }
      return rankBlocks(vec, list, topK, model);
    },
  };
}

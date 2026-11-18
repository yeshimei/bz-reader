/* ============================================================
 * bz-reader · 把「挑好的章节」变成复习卡（shell/review-run.ts）
 *
 * 只管执行，不管界面：给定「哪几章、用哪种挑法、每章最多几张」，跑完返回
 * 一份可翻译的结果。AI 调用与正文读取都是注入的——测试里换成假的，就能
 * 把「一批失败不影响后面」「解析失败保底全留」这些口径钉死。
 *
 * 三条口径：
 *   1. **一批失败不影响后面**。整本几十章，模型偶尔一次超时很正常；失败
 *      计数，继续下一批，最后一起告诉用户。
 *   2. **解析失败保底全留**。模型没按 JSON 回，不等于这一批不值得记——
 *      宁可多留，也不让用户勾了半天的内容凭空消失。
 *   3. **挑完才落库**。所有批次跑完再一次性 addCards，中途放弃不会留下
 *      半本书的卡片。
 * ============================================================ */
import type { ReaderBook } from '../data/schema';
import {
  aiCardKey,
  batchByChars,
  markCardKey,
  type MarkLite,
  type ReviewApi,
  type ReviewCardPayload,
} from '../data/review-bridge';
import { buildChapterCardPrompt, buildMarkPickPrompt, parseChapterCards, parsePickedIds } from '../data/review-ai';
import { protocolUrl, snippet } from '../data/deeplink-core';

/** 一章（执行时只需要序号、标题、和这一章的划线） */
export interface RunChapter {
  /** section 下标（按章节模式取正文用；按划线模式只用来分组） */
  index: number;
  title: string;
  marks: MarkLite[];
}

export interface RunPlan {
  /** marks = 从划线里挑；chapters = 从正文里挑 */
  mode: 'marks' | 'chapters';
  chapters: RunChapter[];
  /** 每章最多几张（0 = 不限制，由内容决定） */
  limit: number;
}

export interface RunDeps {
  book: ReaderBook;
  api: ReviewApi;
  /** 调模型，返回原始文本；失败抛错 */
  ask: (prompt: string) => Promise<string>;
  /** 取某一章的正文（按章节模式用）；取不到返回空串 */
  chapterText: (index: number) => Promise<string>;
}

export interface RunResult {
  /** 真正加进计划的条数 */
  added: number;
  /** 本来就在计划里的条数 */
  exists: number;
  /** 免费版额度到顶被拒的条数 */
  rejected: number;
  /** 失败的批数 */
  failed: number;
  /** 空正文被跳过的章节数 */
  empty: number;
  /** 这次一共生成了几张卡（含没加进去的） */
  cards: number;
}

export interface RunHooks {
  /** 进度：done / total（批数） */
  onProgress?: (done: number, total: number) => void;
}

/** 一条划线的字数（含想法）：决定分批和「要发多少字」 */
export function markChars(m: MarkLite): number {
  return Array.from(String(m.text ?? '')).length + Array.from(String(m.comment ?? '')).length;
}

/** 一批划线的总字数 */
export function marksChars(marks: readonly MarkLite[]): number {
  let n = 0;
  for (const m of marks) n += markChars(m);
  return n;
}

/**
 * 把一章正文按段落切成几块，每块不超过 `limit` 字。
 *
 * 按段落切而不是按字数硬切：硬切会把一句话劈成两半，模型挑出来的「原文」
 * 就对不上正文，后面那道校验会把它丢掉。单段就超长的（极少见）才硬切。
 */
export function splitBody(text: string, limit: number): string[] {
  const cap = Math.max(500, Math.round(Number(limit) || 0));
  const body = String(text ?? '').trim();
  if (!body) return [];
  if (body.length <= cap) return [body];
  const paras = body.split(/\n{2,}/);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (p.length > cap) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      for (let i = 0; i < p.length; i += cap) out.push(p.slice(i, i + cap));
      continue;
    }
    if (cur && cur.length + p.length + 2 > cap) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

/** 划线 → Review 卡片 */
function markToPayload(book: ReaderBook, m: MarkLite): ReviewCardPayload {
  const payload: ReviewCardPayload = {
    key: markCardKey(book.id, m.id),
    bookTitle: book.meta.title || '',
    text: m.text,
    /* 带一条跳回书里的链接：Review 侧「回到原文」按钮靠它才能显示。
       协议只支持按原文片段定位到那一句，不还原高亮色——别在文案里说成高亮定位。 */
    backlink: protocolUrl({
      bookId: book.id,
      text: snippet(m.text),
      chapter: m.chapterTitle || undefined,
    }),
  };
  if (m.chapterTitle) payload.chapterTitle = m.chapterTitle;
  if (m.comment) payload.comment = m.comment;
  return payload;
}

/**
 * 跑完一整次「加入复习」。
 *
 * 不抛错：所有失败都收进返回值（`failed` / `empty`）。调用方只看数字就能
 * 说人话，不用去猜是哪一步炸的。
 */
export async function runReviewAdd(deps: RunDeps, plan: RunPlan, hooks: RunHooks = {}): Promise<RunResult> {
  const { book, api, ask, chapterText } = deps;
  const result: RunResult = { added: 0, exists: 0, rejected: 0, failed: 0, empty: 0, cards: 0 };
  const bookTitle = book.meta.title || '';

  const cards: ReviewCardPayload[] = [];

  if (plan.mode === 'marks') {
    /* 按划线挑：先按字数把全部划线切批，再逐批问「哪几条值得记」。
       批是按字数切的，不是按章——一章划了一百条时，切批才不会把一次
       请求撑爆。 */
    const all = plan.chapters.flatMap((c) => c.marks);
    const batches = batchByChars(all, markChars);
    const total = batches.length;
    let done = 0;
    for (const batch of batches) {
      done += 1;
      hooks.onProgress?.(done, total);
      const chapterTitle = plan.chapters.find((c) => c.marks.includes(batch[0]))?.title ?? '';
      try {
        const reply = await ask(buildMarkPickPrompt(bookTitle, chapterTitle, batch.map((m) => ({ id: m.id, text: m.text, comment: m.comment }))));
        const ids = parsePickedIds(reply, batch.map((m) => m.id));
        /* 解析失败（null）保底全留；明确说「都不留」才真的一条不加 */
        const keep = new Set(ids === null ? batch.map((m) => m.id) : ids);
        for (const m of batch) if (keep.has(m.id)) cards.push(markToPayload(book, m));
      } catch {
        result.failed += 1;
      }
    }
  } else {
    /* 按章节挑：逐章取正文、再按段落切块、每块问一次。
       一章一块是常态，只有超长章节才会切。 */
    const jobs: Array<{ chapter: RunChapter; body: string }> = [];
    for (const c of plan.chapters) {
      let body = '';
      try {
        body = await chapterText(c.index);
      } catch {
        body = '';
      }
      if (!String(body ?? '').trim()) {
        result.empty += 1;
        continue;
      }
      jobs.push({ chapter: c, body });
    }
    const total = jobs.length;
    let done = 0;
    for (const job of jobs) {
      const blocks = splitBody(job.body, 20000);
      for (const block of blocks) {
        done += blocks.length === 1 ? 1 : 0;
        try {
          const reply = await ask(buildChapterCardPrompt(bookTitle, job.chapter.title, block, plan.limit));
          const picked = parseChapterCards(reply, block);
          for (const p of picked) {
            const payload: ReviewCardPayload = {
              key: aiCardKey(book.id, job.chapter.title, p.text),
              bookTitle,
              text: p.text,
              qa: { q: p.q, a: p.a || p.text },
              /* 章节卡没有划线 id，靠前 20 字 + 章节名跳回那一句 */
              backlink: protocolUrl({
                bookId: book.id,
                text: snippet(p.text),
                chapter: job.chapter.title || undefined,
              }),
            };
            if (job.chapter.title) payload.chapterTitle = job.chapter.title;
            cards.push(payload);
          }
        } catch {
          result.failed += 1;
        }
      }
      if (blocks.length > 1) {
        done += 1;
        hooks.onProgress?.(done, total);
      } else {
        hooks.onProgress?.(done, total);
      }
    }
  }

  result.cards = cards.length;
  if (!cards.length) return result;

  try {
    const res = await api.addCards(cards);
    result.added = res.added;
    result.exists = res.exists;
    result.rejected = res.rejected ?? 0;
  } catch {
    /* 落库失败：卡片一张都没进去，按「整批失败」报 */
    result.failed += 1;
  }
  return result;
}

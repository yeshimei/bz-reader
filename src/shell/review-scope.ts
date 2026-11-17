/* ============================================================
 * 右键「加入复习」的范围解析（shell/review-scope.ts）
 *
 * 三种内容来源，都归一成「待制卡的原文」CardSource[]：
 *   marks       每条划线一张（不调 AI）
 *   marksKey    AI 判断哪些划线值得长期记
 *   chaptersKey AI 读正文自己挑句子（每句一张卡）
 *
 * 制卡方式（全文回忆/抽认卡/做题）是下一步三选一的事，与这里正交。
 * ask / chapterText 注入，纯逻辑可测。
 * ============================================================ */
import { buildChapterCardPrompt, buildMarkPickPrompt, parseChapterCards, parsePickedIds } from '../data/review-ai';
import { aiCardKey, markCardKey } from '../data/review-bridge';
import type { CardSource } from '../data/review-modes';

export interface ScopeMark {
  id: string;
  chapterIndex?: number;
  chapterTitle?: string;
  text: string;
  comment?: string;
  bookTitle?: string;
}

export interface ScopeChapter {
  index: number;
  title: string;
}

export type Scope = 'marks' | 'marksKey' | 'chaptersKey';

export interface ScopeDeps {
  bookId: string;
  bookTitle: string;
  marks: readonly ScopeMark[];
  chapters: readonly ScopeChapter[];
  ask: (prompt: string) => Promise<string>;
  chapterText: (index: number) => Promise<string>;
}

/** 划线 → CardSource（钥匙带划线 id，稳定判重） */
function markSource(bookId: string, bookTitle: string, m: ScopeMark): CardSource {
  return {
    key: markCardKey(bookId, m.id),
    bookTitle: m.bookTitle || bookTitle,
    chapterTitle: m.chapterTitle,
    text: m.text,
    comment: m.comment,
  };
}

/**
 * 解析范围 → 待制卡的原文列表。
 *
 * AI 出错的口径沿用现有「加入复习」：挑重点解析不出来就保底全留；正文挑句
 * 子按章逐批处理，空正文跳过、原文校验不过的句子丢掉。
 */
export async function resolveScope(scope: Scope, deps: ScopeDeps): Promise<CardSource[]> {
  const { bookId, bookTitle, marks, chapters, ask, chapterText } = deps;
  const out: CardSource[] = [];

  if (scope === 'marks') {
    for (const m of marks) out.push(markSource(bookId, bookTitle, m));
    return out;
  }

  if (scope === 'marksKey') {
    const byChapter = new Map<string, ScopeMark[]>();
    for (const m of marks) {
      const k = `${m.chapterIndex ?? 0}\u0001${m.chapterTitle ?? ''}`;
      const arr = byChapter.get(k) ?? [];
      arr.push(m);
      byChapter.set(k, arr);
    }
    for (const [, list] of byChapter) {
      const ids = parsePickedIds(
        await ask(buildMarkPickPrompt(bookTitle, list[0].chapterTitle ?? '', list.map((m) => ({ id: m.id, text: m.text, comment: m.comment })))),
        list.map((m) => m.id),
      );
      const keep = new Set(ids === null ? list.map((m) => m.id) : ids);
      for (const m of list) if (keep.has(m.id)) out.push(markSource(bookId, bookTitle, m));
    }
    return out;
  }

  /* chaptersKey：逐章读正文、按段落交给 AI 挑句子 */
  for (const c of chapters) {
    const body = String(await chapterText(c.index) ?? '').trim();
    if (!body) continue;
    const picked = parseChapterCards(await ask(buildChapterCardPrompt(bookTitle, c.title, body)), body);
    for (const p of picked) {
      out.push({
        key: aiCardKey(bookId, c.title, p.text),
        bookTitle,
        chapterTitle: c.title,
        text: p.text,
      });
    }
  }
  return out;
}

/* ============================================================
 * bz-reader · 三选一制卡的数据形状与纯口径（data/review-modes.ts）
 *
 * 三种复习方式（对应 bz Review 的 mode）：
 *   plain      全文回忆——不调 AI，题面就是原文，展开自评
 *   flashcard  抽认卡——AI 给正面提醒，背面是完整原文
 *   quiz       做题——AI 出不少于三道选择题，可删可补可重生成
 *
 * 这里只放纯数据/纯函数：不碰 DOM、不碰 AI、不碰 i18n。字数估算的文案
 * 由界面层拼，汇总句用 key + 参数交给 t()，所以本文件零中文、不触发
 * no-hardcoded-zh 门禁。AI 出题的 prompt 在 review-cards-ai.ts。
 * ============================================================ */

/** 制卡界面给用户的三种方式（Review 侧还有 cloze/context，这里只放开这三种） */
export type ReviewMode = 'plain' | 'flashcard' | 'quiz';

/** 制卡输入：一段内容 + 它在书里的出处 */
export interface CardSource {
  key: string;
  text: string;
  bookTitle: string;
  chapterTitle?: string;
  comment?: string;
}

/** 一道待确认的选择题（与 Review 的 QuizQuestion 对齐，用 q/correct 简写） */
export interface DraftQuestion {
  q: string;
  options: string[];
  correct: number[];
  explain?: string;
}

/** 一张待确认的卡：题面先给用户看，确认后才入库 */
export interface DraftCard {
  key: string;
  mode: ReviewMode;
  bookTitle: string;
  chapterTitle?: string;
  comment?: string;
  /** 正面题面：plain=原文，flashcard=AI 提醒，quiz=题干占位 */
  front: string;
  /** 背面：flashcard=完整原文；其余空 */
  back: string;
  /** 原文（永远留着，入库用） */
  text: string;
  /** 做题的题目列表 */
  questions: DraftQuestion[];
}

/** 造一张卡。空原文不造。 */
export function makeDraft(mode: ReviewMode, s: CardSource & { front?: string; questions?: DraftQuestion[] }): DraftCard | null {
  const text = String(s.text ?? '').trim();
  if (!text) return null;
  const d: DraftCard = {
    key: s.key,
    mode,
    bookTitle: s.bookTitle,
    text,
    front: '',
    back: '',
    questions: [],
  };
  if (s.chapterTitle) d.chapterTitle = s.chapterTitle;
  if (s.comment) d.comment = s.comment;
  if (mode === 'plain') d.front = text;
  if (mode === 'flashcard') {
    d.front = String(s.front ?? '').trim();
    d.back = text;
  }
  if (mode === 'quiz') d.questions = Array.isArray(s.questions) ? s.questions : [];
  return d;
}

/**
 * 一张确认后的卡 → Review 的入库格式。
 *
 * 抽认卡把正面提醒塞进 qa（背面是原文），做题带 questions，全文回忆只给
 * mode=plain。comment/chapterTitle 有才带，保持载荷精简。
 */
export function toCardPayload(d: DraftCard): {
  key: string;
  bookTitle: string;
  chapterTitle?: string;
  text: string;
  mode: ReviewMode;
  qa?: { q: string; a: string };
  questions?: DraftQuestion[];
} {
  const p: {
    key: string;
    bookTitle: string;
    chapterTitle?: string;
    text: string;
    mode: ReviewMode;
    qa?: { q: string; a: string };
    questions?: DraftQuestion[];
  } = { key: d.key, bookTitle: d.bookTitle, text: d.text, mode: d.mode };
  if (d.chapterTitle) p.chapterTitle = d.chapterTitle;
  if (d.mode === 'flashcard' && d.front) p.qa = { q: d.front, a: d.text };
  if (d.mode === 'quiz' && d.questions.length) p.questions = d.questions;
  return p;
}

/** 原文 + 想法的字数 */
export function sourceChars(s: Pick<CardSource, 'text' | 'comment'>): number {
  return Array.from(String(s.text ?? '')).length + Array.from(String(s.comment ?? '')).length;
}

/** 预计要发给 AI 的字数（增强1）。全文回忆不用 AI，恒为 0。 */
export function estimateSendChars(mode: ReviewMode, sources: readonly Pick<CardSource, 'text' | 'comment'>[]): number {
  if (mode === 'plain') return 0;
  return (sources ?? []).reduce((n, s) => n + sourceChars(s), 0);
}

/**
 * 三选一每一项的文案结构：标题在上、发送字数在下。
 *
 * 全文回忆不调 AI，没有第二行——也别再写「不用 AI」这种占位说明；
 * 另外两项只留字数提示，删掉原来那些啰嗦的描述。这里只给 i18n key，
 * 中文交给界面层的 t()，本文件保持零中文。
 */
export function modeOptionParts(mode: ReviewMode, chars: number): {
  titleKey: string;
  hintKey?: string;
  hintParams?: Record<string, string>;
} {
  const titleKey = mode === 'plain'
    ? 'review.mode.plain'
    : mode === 'flashcard'
      ? 'review.mode.flashcard'
      : 'review.mode.quiz';
  if (mode === 'plain') return { titleKey };
  return {
    titleKey,
    hintKey: 'review.mode.estChars',
    hintParams: { chars: Number(chars || 0).toLocaleString('en-US') },
  };
}

/**
 * 确认题面页每种方式要显示哪些段落。
 *
 * 抽认卡的原文已经在「背面原文」里出现，别再在题面上方重复贴一遍；
 * 全文回忆的题面本身就是原文，必须留。
 */
export function confirmCardView(d: Pick<DraftCard, 'mode'>): { showSource: boolean; showBack: boolean } {
  if (d.mode === 'plain') return { showSource: true, showBack: false };
  if (d.mode === 'flashcard') return { showSource: false, showBack: true };
  return { showSource: false, showBack: false };
}

/** 按题面去重追加（做题的补题 / 删题 / 重生成） */
export function mergeDraftQuestions(
  have: readonly DraftQuestion[],
  add: readonly DraftQuestion[],
): DraftQuestion[] {
  const out: DraftQuestion[] = [];
  const seen = new Set<string>();
  const flat = (s: string): string => String(s ?? '').replace(/\s+/g, '');
  for (const q of [...(have ?? []), ...(add ?? [])]) {
    if (!q || !String(q.q ?? '').trim()) continue;
    const k = flat(q.q);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

/** 一张卡在批量列表里的状态（增强2） */
export type CardState = 'new' | 'exists' | 'over';

/**
 * 给批量列表的每张卡标状态：已在计划→exists；否则按剩余额度，
 * 前若干个→new，超出→over。已在计划的不占额度。
 */
export function markCardStates(
  keys: readonly string[],
  existing: ReadonlySet<string>,
  remaining: number,
): CardState[] {
  let free = Math.max(0, remaining === Infinity ? Infinity : Math.round(remaining));
  return (keys ?? []).map((key) => {
    if (existing.has(key)) return 'exists';
    if (free > 0) {
      free -= 1;
      return 'new';
    }
    return 'over';
  });
}

/**
 * 把已经在复习计划里的内容剔掉（2026-11-19 用户口径：已加过的划线不再打一次）。
 *
 * Review 侧本来就会按钥匙去重，但界面还让人勾、还让 AI 为它出题——白等一次
 * 模型、白花一次钱，最后只得到一句「本来就在」。所以入口处先剔，剔掉几条
 * 也照实告诉用户，别让人以为漏了。
 */
export function dropPlanned(
  sources: readonly CardSource[],
  planned: ReadonlySet<string>,
): { kept: CardSource[]; skipped: number } {
  const kept: CardSource[] = [];
  let skipped = 0;
  for (const s of sources ?? []) {
    if (planned.has(s.key)) {
      skipped += 1;
      continue;
    }
    kept.push(s);
  }
  return { kept, skipped };
}

/** 批量入库结果的计数口径（跨 reader/review 通用） */
export interface ResultCounts {
  added: number;
  exists: number;
  rejected: number;
  failed: number;
}

/** 汇总句的一段：文案 key + 插值参数，界面层拿去 t(key, params) 拼装 */
export interface SummaryPart {
  key: string;
  params: Record<string, string>;
}

/**
 * 增强6：批量结果一句话收口——返回分段的 i18n key + 参数，界面拼成一句。
 *
 * 一段话把四件事说完——加了几条、几条本来就在、几条超额、几批失败。
 * 不在这里写中文：它是纯数据，文案全在 i18n，界面层 `parts.map(...).join()`。
 */
export function summaryParts(r: ResultCounts): SummaryPart[] {
  const added = Math.max(0, r.added | 0);
  const exists = Math.max(0, r.exists | 0);
  const rejected = Math.max(0, r.rejected | 0);
  const failed = Math.max(0, r.failed | 0);
  if (!added && !exists && !rejected && !failed) return [{ key: 'review.doneEmpty', params: {} }];
  if (!added && exists && !rejected && !failed) {
    return [{ key: 'review.doneAllExists', params: { exists: String(exists) } }];
  }
  const parts: SummaryPart[] = [];
  parts.push(added ? { key: 'review.done', params: { n: String(added) } } : { key: 'review.doneNone', params: {} });
  if (exists) parts.push({ key: 'review.doneExists2', params: { exists: String(exists) } });
  if (rejected) parts.push({ key: 'review.doneRejected', params: { n: String(rejected) } });
  if (failed) parts.push({ key: 'review.doneFailed', params: { n: String(failed) } });
  return parts;
}

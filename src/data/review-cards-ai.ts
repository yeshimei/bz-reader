/* ============================================================
 * bz-reader · 三选一制卡的 AI 出题（data/review-cards-ai.ts）
 *
 * 两种要调模型的卡：
 *   flashcard 抽认卡——只让 AI 给一句正面提醒，背面用完整原文（不给模型，
 *     免得它把原文改写走样）。
 *   quiz 做题——让 AI 出选择题，至少三道，用户可删可补可重新生成。
 *
 * 解析一律宽容：模型爱包一层代码块或加前言，取第一个 {...} 解析；只认
 * 结构完整的题，选项不足两个、正确下标越界的一律丢掉——复习时对不上
 * 的题比没有更糟。
 *
 * 这个文件里的中文全是发给模型的 prompt，不进界面——与 data/ai.ts、
 * data/review-ai.ts 同一性质；已登记进 tests/no-hardcoded-zh.test.ts。
 * ============================================================ */
import { makeDraft, type CardSource, type DraftCard, type ReviewMode } from './review-modes';

/** 抽认卡：让 AI 只给一句正面提醒问句 */
export function buildFlashcardPrompt(bookTitle: string, chapterTitle: string, text: string): string {
  const where = chapterTitle ? `《${bookTitle}》${chapterTitle}` : `《${bookTitle}》`;
  return [
    `下面这句话出自${where}：`,
    '',
    text,
    '',
    '请写一句简短的正面提醒文字，用来在复习时提示读者想起这句话。要求：',
    '1. 一般写成问句，一句话，不超过 30 个字；',
    '2. 不要照抄原文，要能独立读懂；',
    '3. 不要出现书名、章节名、「这句话」这类元信息。',
    '',
    '只输出一个 JSON 对象，不要解释、不要代码块：',
    '{"front": "提醒文字"}',
  ].join('\n');
}

/** 做题：让 AI 出不少于三道选择题；min 可指定补齐时的目标数 */
export function buildQuizPrompt(bookTitle: string, chapterTitle: string, text: string, min = 3): string {
  const where = chapterTitle ? `《${bookTitle}》${chapterTitle}` : `《${bookTitle}》`;
  const n = Math.max(1, Math.round(Number(min) || 3));
  return [
    `下面这句话出自${where}：`,
    '',
    text,
    '',
    `请据此出${n}道单选题，用来复习这句话里的知识点。要求：`,
    `1. 至少 ${n} 道；内容多可以多出，但不要为凑数出重复的题；`,
    '2. 每题 2~4 个选项，只有一个正确答案；',
    '3. correct 是正确答案在 options 里的下标（从 0 开始）；',
    '4. explain 一句话说明为什么，可引用原文；',
    '5. 不要出「这段出自哪本书」这类靠元信息就能猜的题。',
    '',
    '只输出一个 JSON 对象，不要解释、不要代码块：',
    '{"questions": [{"q": "题干", "options": ["选项A", "选项B"], "correct": [0], "explain": "解析"}]}',
    '',
    '内容：',
    String(text ?? ''),
  ].join('\n');
}

/** 只把模型真正写成字符串（或数字）的字段转出来，其余一律当空 */
function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** 容错取第一个 {...} 之间的 JSON */
function extractJson(reply: string): unknown {
  const text = String(reply ?? '');
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
}

/** 解析抽认卡的正面提醒；取不到返回 null */
export function parseFlashcard(reply: string): string | null {
  const obj = extractJson(reply);
  if (!obj || typeof obj !== 'object') return null;
  const front = asText((obj as { front?: unknown }).front).trim();
  return front || null;
}

/** 一道解析后的题 */
export interface ParsedQuestion {
  q: string;
  options: string[];
  correct: number[];
  explain?: string;
}

/** 解析做题回复：过滤缺字段、选项不足、下标越界、重复的题 */
export function parseQuizQuestions(reply: string): ParsedQuestion[] {
  const obj = extractJson(reply);
  if (!obj || typeof obj !== 'object') return [];
  const raw = (obj as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return [];
  const out: ParsedQuestion[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const q = asText(it.q).trim();
    const options = Array.isArray(it.options) ? it.options.map((o) => asText(o).trim()).filter(Boolean) : [];
    const correct = Array.isArray(it.correct)
      ? it.correct
          .map((c) => (typeof c === 'number' ? c : typeof c === 'string' ? Number(c) : NaN))
          .filter((n) => Number.isInteger(n))
      : [];
    if (!q || options.length < 2 || !correct.length) continue;
    if (correct.some((i) => i < 0 || i >= options.length)) continue;
    const key = q.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed: ParsedQuestion = { q, options, correct: [...new Set(correct)].sort((a, b) => a - b) };
    const explain = asText(it.explain).trim();
    if (explain) parsed.explain = explain;
    out.push(parsed);
  }
  return out;
}

/**
 * 把一组内容按方式变成待确认的卡（生成编排，ask 注入以便测试）。
 *
 * 逐条生成，一条失败不影响其他：抽认卡解析不出来就用原文当正面（宁可
 * 是「全文回忆」也不留空白卡），做题解析不出来就留空题让用户手动补或
 * 重新生成。全文回忆不调 AI。
 */
export async function generateDrafts(
  mode: ReviewMode,
  sources: readonly CardSource[],
  ask: (prompt: string) => Promise<string>,
): Promise<DraftCard[]> {
  const out: DraftCard[] = [];
  for (const s of sources ?? []) {
    if (mode === 'plain') {
      const d = makeDraft('plain', s);
      if (d) out.push(d);
      continue;
    }
    let reply = '';
    try {
      reply = await ask(
        mode === 'flashcard'
          ? buildFlashcardPrompt(s.bookTitle, s.chapterTitle ?? '', s.text)
          : buildQuizPrompt(s.bookTitle, s.chapterTitle ?? '', s.text),
      );
    } catch {
      reply = '';
    }
    if (mode === 'flashcard') {
      const front = parseFlashcard(reply) || s.text;
      const d = makeDraft('flashcard', { ...s, front });
      if (d) out.push(d);
    } else {
      const questions = parseQuizQuestions(reply);
      const d = makeDraft('quiz', { ...s, questions });
      if (d) out.push(d);
    }
  }
  return out;
}

/* ============================================================
 * bz-reader · 开章导读（data/chapter-guide.ts）
 *
 * 2026-11-11：刚翻开一章时，读者常常不知道「这一章要带着什么读」。
 * 这一层按章给一份很短的导读：两三句话 + 三个问题。
 *
 * 三条约束：
 *   1. **按章落盘**：导读存在画像文件的 `guides[章节名]` 里，同一章只花
 *      一次钱；换书版本时画像本身就是另一份，导读自然跟着作废；
 *   2. **不自动调用**：命令点了才生成（与 docs/ai-knowledge-decisions.md
 *      的「明确不做」对齐）；
 *   3. **短**：最多 2000 字。导读不是书评，太长反而没人看。
 *
 * 章名就是目录上那串字，不另造 id——与 TOC 的行一一对应，界面直接拿来用。
 * ============================================================ */
import type { PortraitFile } from './portrait';
import type { AiMessage } from './ai';

/** 单章导读上限：再长就不是「导读」了 */
const GUIDE_MAX = 2000;

/** 取某章导读；没有就空串（界面据此显示「未生成」） */
export function guideOf(p: PortraitFile | null | undefined, chapter: string): string {
  const key = String(chapter ?? '').trim();
  if (!p || !key) return '';
  return String(p.guides?.[key] ?? '').trim();
}

/**
 * 写一章导读，返回新画像（不改原对象）。
 *
 * 空章名 / 空正文直接原样返回：调用方据此知道「这次没写成」，不留空条目。
 */
export function withGuide(p: PortraitFile, chapter: string, text: string): PortraitFile {
  const key = String(chapter ?? '').trim();
  const body = String(text ?? '')
    .trim()
    .slice(0, GUIDE_MAX);
  if (!key || !body) return p;
  return { ...p, guides: { ...(p.guides ?? {}), [key]: body } };
}

/**
 * 这一章的摘要（有就带上，让导读贴着这一章而不是复述全书）。
 *
 * 只认同一章名下第一条有摘要的块：compress 画像的要点在 summary，
 * 老画像只有 digest。
 */
export function chapterDigestOf(p: PortraitFile | null | undefined, chapter: string): string {
  const key = String(chapter ?? '').trim();
  if (!p || !key) return '';
  for (const b of p.blocks ?? []) {
    if (String(b.chapter ?? '').trim() !== key) continue;
    const line = String(b.summary || b.digest || '').trim();
    if (line) return line;
  }
  return '';
}

/**
 * 给模型的消息。
 *
 * 信息只有章名时，允许从章名推断话题方向，但明令不许复述具体情节——
 * 否则模型会一本正经地讲一段书里没有的剧情，读者翻两页就发现不对。
 */
export function buildGuideMessages(input: { chapter: string; book?: string; digest?: string }): AiMessage[] {
  const chapter = String(input.chapter ?? '').trim();
  const book = String(input.book ?? '').trim();
  const digest = String(input.digest ?? '').trim();
  const system =
    '你是读书教练。根据给出的书名、章节名与（可选的）章摘要，写一份很短的导读：' +
    '先用两三句话说明这一章大概在讲什么，再给三个能带着读的问题。' +
    '只有章名时，只从章名推断话题方向，不要复述具体情节，也不要编造人物或细节。' +
    '用中文，总长不超过 200 字，按「这一章」「带着三个问题」两段输出。';
  const user = [book ? `【书名】${book}` : '', `【章节】${chapter}`, digest ? `【章摘要】\n${digest}` : '']
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

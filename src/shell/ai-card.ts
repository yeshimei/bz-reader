/* ============================================================
 * bz-reader · 划词 AI 卡的记账（shell/ai-card.ts）
 *
 * 卡上只有一件事会变：**这一段、这一档，问到哪儿了**。答案、失败原因、
 * 还在路上的标记，全都记在这里，渲染时从这里取。
 *
 * 为什么不能只写进 DOM：弹层任何一次重画都会整块换掉 DOM（点卡里任一颗
 * 按钮、切档、授权变化、内容键 +1）。答案只活在旧节点上的话，重画之后
 * 页面退回「正在请求…」，而「这条已经请求过」的记号还在——于是就永远停在
 * 那一行，看起来就是「AI 卡死了」。
 *
 * 键的构成是 `kind|task|text`：同一段文字换个问法（解释 / 翻译 / 摘要）
 * 是三条独立的问答，各记各的，切回去还是那一份；换一段文字自然也不串。
 * 关掉卡片整册清空——再次打开同一段应该重新问，而不是给一份看不懂来历的旧答案。
 * ============================================================ */
import type { AiTask, AiTurn } from '../data/ai';

export type AiCardStatus = 'busy' | 'done' | 'error';

/**
 * 一轮追问。
 *
 * 失败也留一条（`error` 非空、`a` 为空）：卡片重画之后用户至少能看到
 * 「刚才问的那句没答上来」，而不是一段凭空消失的对话。
 */
export interface AiFollowTurn {
  q: string;
  a: string;
  error?: string;
}

export interface AiCardEntry {
  status: AiCardStatus;
  /** 结果正文；`busy` 时是空串，失败时是给人看的那句原因 */
  text: string;
  /**
   * 追问轮次（2026-11-10）。
   *
   * 初次那问不进这里：它的答案就是 `text`。追问与初次共用同一个键，
   * 切档时整份跟着档走——解释档的追问不会出现在翻译档里。
   */
  turns?: AiFollowTurn[];
}

/**
 * 卡上的三档，顺序即页签顺序。
 *
 * 与 `AiTask` 同名不是巧合：`ask` 是全书问答用的，不属于这张卡。
 */
export const AI_CARD_MODES: readonly AiTask[] = ['explain', 'translate', 'summarize'];

/** 问答的记账键。同一段文字的不同档位是不同的一份 */
export function aiCardKey(kind: string, task: string, text: string): string {
  return `${kind}|${task}|${text}`;
}

/**
 * 把 `overlay.mode` 收敛成卡上的合法一档。
 *
 * 不认识的（别的弹层写进来的 mode、旧版本留下的值、压根没有）一律按解释：
 * 这是卡片的默认档，也是唯一一个「不选也能看懂」的档。
 */
export function aiModeOf(mode?: string | null): AiTask {
  const m = String(mode ?? '');
  return (AI_CARD_MODES as readonly string[]).includes(m) ? (m as AiTask) : 'explain';
}

const entries = new Map<string, AiCardEntry>();

export function aiCardGet(key: string): AiCardEntry | undefined {
  return entries.get(key);
}

/** 请求发出去了：先记「在路上」，重画时据此画占位文案，也不会重复发 */
export function aiCardBegin(key: string): void {
  entries.set(key, { status: 'busy', text: '' });
}

export function aiCardDone(key: string, text: string): void {
  entries.set(key, { status: 'done', text });
}

/** 失败也是一条要留在卡上的话：原因写在正文里，「重试」就在下面 */
export function aiCardFail(key: string, text: string): void {
  entries.set(key, { status: 'error', text });
}

/** 作废一条：换档把旧请求掐掉、重试前清掉失败记号，都走这里 */
export function aiCardDrop(key: string): void {
  entries.delete(key);
}

/** 离开 AI 卡时整册清空：下次打开重新问 */
export function aiCardReset(): void {
  entries.clear();
}

/* ─────────── 追问（2026-11-10） ─────────── */

/**
 * 开始一轮追问。
 *
 * 与 `aiCardBegin` 的区别是**不清旧账**：初次答案与之前的轮次都要留着，
 * 重画之后用户还能往上翻。追问失败也不抹掉它们。
 */
export function aiCardFollowBegin(key: string): void {
  const cur = entries.get(key);
  if (!cur) {
    entries.set(key, { status: 'busy', text: '', turns: [] });
    return;
  }
  entries.set(key, { ...cur, status: 'busy' });
}

/** 一轮追问拿到了答案：追加到轮次末尾，初次答案不动 */
export function aiCardFollowDone(key: string, q: string, a: string): void {
  const cur = entries.get(key) ?? { status: 'done' as const, text: '' };
  const turns = [...(cur.turns ?? []), { q, a }];
  entries.set(key, { ...cur, status: 'done', turns });
}

/** 一轮追问失败：问题与原因都留在轮次里，供「重试」和用户回看 */
export function aiCardFollowFail(key: string, q: string, text: string): void {
  const cur = entries.get(key) ?? { status: 'error' as const, text: '' };
  const turns = [...(cur.turns ?? []), { q, a: '', error: text }];
  /* 有初次答案时状态退回 done：卡片正文该继续显示答案，而不是被
     一句「追问失败」顶掉；没有初次答案才把错误亮在正文里。 */
  entries.set(key, { ...cur, status: cur.text ? 'done' : 'error', turns });
}

/**
 * 追问要带给模型的历史。
 *
 * 先放刚才那份答案（`assistant`），再按顺序放轮次。失败的轮次跳过——
 * 没答出来的问题喂回去，模型会把它当成「说过的话」接着圆。
 */
export function followHistory(text: string, turns: readonly AiFollowTurn[] = []): AiTurn[] {
  const out: AiTurn[] = [];
  const first = String(text ?? '').trim();
  if (first) out.push({ role: 'assistant', content: first });
  for (const turn of turns ?? []) {
    if (turn?.error) continue;
    const q = String(turn?.q ?? '').trim();
    const a = String(turn?.a ?? '').trim();
    if (q) out.push({ role: 'user', content: q });
    if (a) out.push({ role: 'assistant', content: a });
  }
  return out;
}

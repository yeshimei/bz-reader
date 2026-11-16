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
import type { AiSession } from '../data/ai-session';

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
  /**
   * 问题已发出、答案还在路上（2026-11-11）。
   *
   * 以前这一轮要等答案回来才进轮次，中间卡片一动不动——用户以为没点中。
   * 现在发出就先占一行，回来再换成答案（见 settleTurn）。
   */
  pending?: boolean;
}

export interface AiCardEntry {
  status: AiCardStatus;
  /** 结果正文；`busy` 时是空串，失败时是给人看的那句原因 */
  text: string;
  /**
   * 首条用户气泡的文案（2026-11-16）。
   *
   * 解释 / 翻译 / 总结是任务文案（「解释这一段」…），追问是用户自己打的
   * 第一句。它同时是归档时的「用户问」与追问历史里的第一条 user。
   */
  ask?: string;
  /** 首条消息的时刻（HH:mm，画在消息区顶上）。没有 = 还没开始 */
  at?: string;
  /** 归档时刻（HH:mm）；有值 = 这段对话已经落进阅读笔记 */
  archivedAt?: string;
  /**
   * 追问轮次（2026-11-10）。
   *
   * 初次那问不进这里：它的答案就是 `text`。追问与初次共用同一个键，
   * 切档时整份跟着档走——解释档的追问不会出现在翻译档里。
   */
  turns?: AiFollowTurn[];
}

/**
 * 卡片能承载的三档任务（解释 / 翻译 / 总结）。
 *
 * 菜单上的「追问」是第四条路，但它没有首问、不进这个列表；
 * `aiFloatTaskOf` 负责把 overlay.mode 收敛成四档。
 */
export const AI_CARD_MODES: readonly AiTask[] = ['explain', 'translate', 'summarize'];

/**
 * 问答的记账键。同一段文字的不同档位是不同的一份。
 *
 * `mark` 是这个 2026-11-16 加的：对话现在绑在划线上，同一段原文如果被
 * 划成两条线（用户可以先划一次、回头又划一次），两份历史不该共用一个键。
 */
export function aiCardKey(kind: string, task: string, text: string, mark = ''): string {
  return `${kind}|${task}|${mark}|${text}`;
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

/**
 * 追问输入框里还没发出去的字（2026-11-16）。
 *
 * 以前这块只在 DOM 里：点一下卡上别的地方（任何一次重画都会换掉输入框）、
 * 关掉卡片再打开、切个档再回来，打了一半的话就没了。
 * 单独放一张表而不是塞进 `AiCardEntry`：草稿不代表「这一问已经问过」，
 * 混进账本会让 `runAiForOverlay` 把它当成有结果的一份。
 */
const drafts = new Map<string, string>();

export function aiCardDraft(key: string): string {
  return drafts.get(key) ?? '';
}

export function aiCardSetDraft(key: string, text: string): void {
  if (!key) return;
  const v = String(text ?? '');
  if (v) drafts.set(key, v);
  else drafts.delete(key);
}

export function aiCardGet(key: string): AiCardEntry | undefined {
  return entries.get(key);
}

/**
 * 请求发出去了：先记「在路上」，重画时据此画等待气泡，也不会重复发。
 *
 * `ask` / `at` 由调用方给：解释 / 翻译 / 总结传任务文案，追问面板传用户
 * 刚打的那一句。归档状态在这里清掉——对话又长了一截，之前那份笔记
 * 不再代表眼前这段。
 */
export function aiCardBegin(key: string, ask?: string, at?: string): void {
  const entry: AiCardEntry = { status: 'busy', text: '' };
  const q = String(ask ?? '').trim();
  if (q) entry.ask = q;
  if (at) entry.at = at;
  entries.set(key, entry);
}

export function aiCardDone(key: string, text: string): void {
  const cur = entries.get(key);
  entries.set(key, { ...(cur ?? {}), status: 'done', text });
}

/** 失败也是一条要留在卡上的话：原因写在 AI 气泡里 */
export function aiCardFail(key: string, text: string): void {
  const cur = entries.get(key);
  entries.set(key, { ...(cur ?? {}), status: 'error', text });
}

/** 归档成功：记下时刻。之后底栏变「已归档 HH:mm」，按钮禁用 */
export function aiCardArchiveMark(key: string, at: string): void {
  const cur = entries.get(key);
  if (cur) entries.set(key, { ...cur, archivedAt: at });
}

/**
 * 灌一条已经存在的结果（2026-11-16）。
 *
 * 用在「点回一条以前问过的划线」：册子关掉就空了，但这段对话还在
 * `ai-sessions.json` 里。不灌回去的话，再点那条线只会看到一张空卡，
 * 然后重新花一次钱。
 */
export function aiCardSeed(key: string, entry: AiCardEntry): void {
  entries.set(key, { ...entry, turns: entry.turns ? [...entry.turns] : undefined });
}

/** 作废一条：换档把旧请求掐掉、重试前清掉失败记号，都走这里 */
export function aiCardDrop(key: string): void {
  entries.delete(key);
}

/** 离开 AI 卡时整册清空：下次打开重新问 */
export function aiCardReset(): void {
  entries.clear();
  drafts.clear();
}

/* ─────────── 追问（2026-11-10） ─────────── */

/**
 * 开始一轮追问。
 *
 * 与 `aiCardBegin` 的区别是**不清旧账**：初次答案与之前的轮次都要留着，
 * 重画之后用户还能往上翻。追问失败也不抹掉它们。
 *
 * 2026-11-11：问题**立刻**进轮次（`pending`）。发出即回声——不然用户点了
 * 「追问」只看到卡片纹丝不动，等十几秒才突然多出一整段。
 */
export function aiCardFollowBegin(key: string, q: string): void {
  const cur = entries.get(key);
  const turns = [...(cur?.turns ?? []), { q: String(q ?? ''), a: '', pending: true }];
  const next: AiCardEntry = { ...(cur ?? {}), status: 'busy', text: cur?.text ?? '', turns };
  /* 又追问了一轮：这段对话已经和归档时那份不一样了 */
  delete next.archivedAt;
  entries.set(key, next);
}

/**
 * 把最后一条「在路上」的换成结果。
 *
 * 按问题文本对上那一轮；对不上（理论上不该发生）就追加，宁可多一条也
 * 不能把答案丢掉。
 */
function settleTurn(
  turns: readonly AiFollowTurn[] | undefined,
  q: string,
  next: AiFollowTurn,
): AiFollowTurn[] {
  const list = [...(turns ?? [])];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const turn = list[i];
    if (turn.pending && turn.q === q) {
      list[i] = next;
      return list;
    }
  }
  list.push(next);
  return list;
}

/** 一轮追问拿到了答案：追加到轮次末尾，初次答案不动 */
export function aiCardFollowDone(key: string, q: string, a: string): void {
  const cur = entries.get(key) ?? { status: 'done' as const, text: '' };
  const turns = settleTurn(cur.turns, q, { q, a });
  entries.set(key, { ...cur, status: 'done', turns });
}

/** 一轮追问失败：问题与原因都留在轮次里，供「重试」和用户回看 */
export function aiCardFollowFail(key: string, q: string, text: string): void {
  const cur = entries.get(key) ?? { status: 'error' as const, text: '' };
  const turns = settleTurn(cur.turns, q, { q, a: '', error: text });
  /* 有初次答案时状态退回 done：卡片正文该继续显示答案，而不是被
     一句「追问失败」顶掉；没有初次答案才把错误亮在正文里。 */
  entries.set(key, { ...cur, status: cur.text ? 'done' : 'error', turns });
}

/**
 * 追问要带给模型的历史。
 *
 * 先放首问（`ask`，用户说的那句）与刚才那份答案（`assistant`），再按顺序
 * 放轮次。失败的轮次跳过——没答出来的问题喂回去，模型会把它当成
 * 「说过的话」接着圆。还在路上的（`pending`）同样跳过：它没有答案，
 * 带过去只是一句孤儿提问。
 *
 * `ask` 是 2026-11-16 加的：以前只带答案，模型不知道用户当初问的是什么，
 * 追问「那笼子呢」会答得没有着落。老调用点不传，行为不变。
 */
/**
 * 一条落盘的会话 → 卡片上的一份结果（2026-11-16）。
 *
 * 顺序就是对话顺序：第一问是用户那句（`ask`），第二句是首页答案
 * （`text`），之后每两轮一对追问。**首问的答案进 `text` 而不是 turns**，
 * 因为卡片正文画的就是它；塞进 turns 会画成「问答对」，第一屏反而空了。
 *
 * 结构不完整（只有一问、答案缺失）时按缺的补：宁可少一条，也不让
 * 卡片显示一段前后不接的话。
 */
export function sessionToCard(s: AiSession): AiCardEntry {
  const turns = (s.turns ?? []).filter((x) => x && String(x.text ?? '').trim());
  const ask = turns[0]?.me ? turns[0].text : '';
  const head = turns.length && !turns[0].me ? 0 : 1;
  const first = turns.length > head ? turns[head] : undefined;
  const rest: AiFollowTurn[] = [];
  for (let i = head + 1; i < turns.length; i += 1) {
    const q = turns[i];
    if (!q?.me) continue;
    const a = turns[i + 1];
    if (a && !a.me) {
      rest.push({ q: q.text, a: a.text });
      i += 1;
    } else {
      rest.push({ q: q.text, a: '' });
    }
  }
  const entry: AiCardEntry = {
    status: 'done',
    text: first?.text ?? '',
    turns: rest,
  };
  if (ask) entry.ask = ask;
  if (s.when) entry.at = cardClock(s.when);
  return entry;
}

/** 时间戳 → 卡片顶上的 HH:mm（不引 ai-menu，免得两个模块互相依赖） */
export function cardClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function followHistory(
  text: string,
  turns: readonly AiFollowTurn[] = [],
  ask = '',
): AiTurn[] {
  const out: AiTurn[] = [];
  const question = String(ask ?? '').trim();
  const first = String(text ?? '').trim();
  if (question) out.push({ role: 'user', content: question });
  if (first) out.push({ role: 'assistant', content: first });
  for (const turn of turns ?? []) {
    if (turn?.error || turn?.pending) continue;
    const q = String(turn?.q ?? '').trim();
    const a = String(turn?.a ?? '').trim();
    if (q) out.push({ role: 'user', content: q });
    if (a) out.push({ role: 'assistant', content: a });
  }
  return out;
}

/* ============================================================
 * bz-reader · 划词 AI 的菜单与浮框（shell/ai-menu.ts）
 *
 * 原型第 2 稿把「点 AI 直接解释」拆成了两步：
 *   1. 工具条上方平摊五项（解释 / 翻译 / 总结 / 追问 ｜ 插入到全书问答）；
 *   2. 点一项 → 这一行收起，**同一位置**换成 430×420 的锚定浮框。
 *
 * 这一层只放纯数据与纯函数：菜单项、首问文案、气泡列表、归档轮次，
 * 不碰 DOM、不发请求——渲染在 reader-cards，动作在 actions。
 *
 * 图标是 lucide 的五枚（名字写在 `icon` 上，路径照原型 1:1 拷下来）：
 * 宿主图标集换版时不会跑偏，菜单也不必等 `setIcon` 才能画。
 * 全书问答必须是 `panel-right-open`：它和工具条上的 AI（sparkles）不是一件事。
 * ============================================================ */
import type { AiFollowTurn } from './ai-card';
import type { AiLogLine } from '../data/ai-save';
import { t, type MsgKey } from '../i18n';
import { esc } from './render/html';

/** 浮框能承载的四档；`ask`（全书问答）走侧栏，不在这里 */
export type AiFloatTask = 'explain' | 'translate' | 'summarize' | 'follow';

/** 菜单里的五项：四档任务 + 一条「交给侧栏」的出口 */
export type AiMenuTask = AiFloatTask | 'book';

export interface AiMenuItem {
  task: AiMenuTask;
  /** 菜单上的字（当前界面语言现取） */
  labelKey: MsgKey;
  /** lucide 图标名：只作语义标记与测试锚点，路径在 `svg` 里 */
  icon: string;
  /** 首问文案；追问 / 全书问答没有首问 → 空浮框的判据 */
  promptKey?: MsgKey;
  /** 图标路径（`viewBox="0 0 24 24"` 里那一串） */
  svg: string;
}

/**
 * 五项的唯一定义，顺序即定稿。
 *
 * 前四项是一等动作（解释 / 翻译 / 总结 / 追问），最后一项是另一个去处
 * （把这段交给侧栏问整本），渲染时中间隔一道 1px 竖线。
 */
export const AI_MENU_ITEMS: readonly AiMenuItem[] = [
  {
    task: 'explain',
    labelKey: 'ai.mode.explain',
    icon: 'help-circle',
    promptKey: 'ai.first.explain',
    svg: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>',
  },
  {
    task: 'translate',
    labelKey: 'ai.mode.translate',
    icon: 'languages',
    promptKey: 'ai.first.translate',
    svg: '<path d="M3.5 5.5h8"/><path d="M7.5 3.5v2"/><path d="M5.5 8.5c1.2 3 3.6 5.3 6.5 6.3"/><path d="M10.5 5.5c-.5 2.8-2 5.2-4.5 6.8"/><path d="M13.5 20l3.6-8 3.6 8"/><path d="M15 17.2h4.2"/>',
  },
  {
    task: 'summarize',
    /* 菜单上写「总结」（原型文案）；存档标题仍用语言包里那一套 */
    labelKey: 'ai.menu.summarize',
    icon: 'list',
    promptKey: 'ai.first.summarize',
    svg: '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/>',
  },
  {
    task: 'follow',
    labelKey: 'ai.mode.follow',
    icon: 'corner-down-left',
    svg: '<path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 0 10h-3"/>',
  },
  {
    task: 'book',
    labelKey: 'ai.menu.book',
    icon: 'panel-right-open',
    svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/>',
  },
];

/** 分组：四档一等动作一组；插入全书问答单独一组（渲染时中间一条竖线） */
export const AI_MENU_GROUPS: readonly (readonly AiMenuItem[])[] = [
  AI_MENU_ITEMS.slice(0, 4),
  AI_MENU_ITEMS.slice(4),
];

/**
 * 工具条上方那一行（纯字符串）。
 *
 * 文字模式：标签 + 图标（图标由 CSS 藏起来）；图标模式：30×27 只露图标，
 * 标签留在 DOM 里给读屏与 title。两种长相共用 `AI_MENU_ITEMS` 这一份数据。
 */
export function aiMenuHtml(style: 'text' | 'icon'): string {
  const groups = AI_MENU_GROUPS.map((group) =>
    group
      .map((item) => {
        const label = t(item.labelKey);
        const cls = item.task === 'book' ? ' class="book"' : '';
        return `<button type="button"${cls} data-act="aimenupick" data-task="${esc(
          item.task,
        )}" aria-label="${esc(label)}" title="${esc(label)}"><span class="lab">${esc(
          label,
        )}</span><span class="bzs-aimenu-ico" data-icon-name="${esc(
          item.icon,
        )}" aria-hidden="true"><svg viewBox="0 0 24 24">${item.svg}</svg></span></button>`;
      })
      .join(''),
  ).join('<span class="bzs-aimenu-vdiv" data-role="aimenu-divider" aria-hidden="true"></span>');
  return `<div class="bzs-aimenu${style === 'icon' ? ' is-icon' : ''}" data-style="${style}" role="menu" aria-label="${esc(
    t('tool.ai'),
  )}">${groups}</div>`;
}

/** 浮框这一档：不认识 / 缺省的 mode 一律按解释 */
export function aiFloatTaskOf(mode?: string | null): AiFloatTask {
  const m = String(mode ?? '');
  return m === 'translate' || m === 'summarize' || m === 'follow' ? m : 'explain';
}

/** 工具条 / 菜单贴着的那个点（宿主视口坐标） */
export interface AiMenuAnchor {
  left: number;
  top: number;
  width?: number;
  height?: number;
}

/**
 * 菜单收起来之后退回哪一层（2026-11-16）。
 *
 * 再点一次 AI 是开合（2026-11-16 起不再悬停展开），收起时不该把整块
 * 抹掉：从划线进来的有 `markId`，原地退回那条工具条，手不用重新找位置；
 * 从选区进来的没有「工具条这一层」可退——选区本身还在，重新划一下就有，
 * 返回 null 由调用方整块关掉。
 */
export function aiMenuFallback(
  o: { markId?: string; bookId?: string; anchor?: AiMenuAnchor } | null | undefined,
): { kind: 'hltools'; markId: string; bookId?: string; anchor?: AiMenuAnchor } | null {
  if (!o?.markId) return null;
  return { kind: 'hltools', markId: o.markId, bookId: o.bookId, anchor: o.anchor };
}

/**
 * 首问文案。
 *
 * 解释 / 翻译 / 总结一打开就替用户把这一句发出去，气泡里得有个「问」；
 * 追问与全书问答没有首问——追问要的是空面板（0 条消息），
 * 这条空串就是渲染那一侧判「空态」的依据。
 */
export function aiFirstPrompt(task: AiFloatTask): string {
  /* 首问文案挂在这份菜单数据上（`promptKey`），不再另建一张映射：
     两处各写一遍时，加一项总会漏一边。追问与全书问答没有 promptKey，
     空串就是「空面板」的判据。 */
  const item = AI_MENU_ITEMS.find((x) => x.task === task);
  return item?.promptKey ? t(item.promptKey) : '';
}

/* ─────────── 浮框里的气泡 ─────────── */

export interface AiBubble {
  role: 'me' | 'ai';
  text: string;
  /** 答案还在路上：画三个跳动的点，不写文字 */
  pending?: boolean;
  /** 这一条是失败原因：用错误色 */
  error?: boolean;
}

export interface AiFloatState {
  mode: AiFloatTask;
  ask?: string;
  answer?: string;
  busy?: boolean;
  error?: string;
  turns?: readonly AiFollowTurn[];
}

/**
 * 一段对话摊平成气泡。
 *
 * 首问 + 首答来自账本（`ask` / `answer`），追问轮次接在后面；失败的轮次
 * 问题留着、答案位置换成原因——和「发出即回声」的旧口径一致。
 *
 * 追问空面板（没有 ask、没有 answer、没有轮次）返回空数组：
 * 渲染据此画「直接问，问题会带着上面那段原文。」。
 */
export function aiFloatMessages(input: AiFloatState): AiBubble[] {
  const out: AiBubble[] = [];
  const ask = String(input.ask ?? aiFirstPrompt(input.mode)).trim();
  const answer = String(input.answer ?? '').trim();
  if (ask) out.push({ role: 'me', text: ask });
  if (answer) out.push({ role: 'ai', text: answer });
  else if (input.error) out.push({ role: 'ai', text: input.error, error: true });
  else if (ask && input.busy) out.push({ role: 'ai', text: '', pending: true });

  for (const turn of input.turns ?? []) {
    const q = String(turn?.q ?? '').trim();
    const a = String(turn?.a ?? '').trim();
    if (q) out.push({ role: 'me', text: q });
    if (turn?.error) out.push({ role: 'ai', text: String(turn.error), error: true });
    else if (a) out.push({ role: 'ai', text: a });
    else if (q) out.push({ role: 'ai', text: '', pending: true });
  }
  return out;
}

/** 「复制」按钮要的一段纯文本：你 / AI 轮流，不带时间戳与标记 */
export function aiTranscript(messages: readonly AiBubble[]): string {
  return messages
    .filter((m) => String(m.text ?? '').trim())
    .map((m) => `${m.role === 'me' ? t('ai.follow.you') : 'AI'}：${String(m.text).trim()}`)
    .join('\n\n');
}

/** 归档时刻（HH:mm）：浮框底栏与按钮文案共用 */
export function clockOf(ts = Date.now()): string {
  const d = new Date(ts);
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 归档轮次：把浮框里的对话映射成「用户问 / AI 答」。
 *
 * 只收成对的问答：首问要有首答才算一条对话，失败的轮次不落盘——
 * 笔记里留一个没有答案的问题，读者回头只会以为文件坏了。
 * 空对话返回空数组，调用方据此不写盘、不弹「已归档」。
 */
export function aiArchiveTurns(
  mode: AiFloatTask,
  entry: { ask?: string; text?: string; turns?: readonly AiFollowTurn[] },
): AiLogLine[] {
  const out: AiLogLine[] = [];
  const ask = String(entry.ask ?? aiFirstPrompt(mode)).trim();
  const answer = String(entry.text ?? '').trim();
  if (ask && answer) {
    out.push({ me: true, text: ask }, { me: false, text: answer });
  }
  for (const turn of entry.turns ?? []) {
    const q = String(turn?.q ?? '').trim();
    const a = String(turn?.a ?? '').trim();
    if (!q || !a) continue;
    out.push({ me: true, text: q }, { me: false, text: a });
  }
  return out;
}

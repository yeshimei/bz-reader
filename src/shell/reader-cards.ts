/**
 * S10 定稿的五张阅读浮卡（纯函数，node 里可直接测）。
 *
 * 共同约定：
 *   · 都没有标题头、没有关闭按钮——点正文或按 Esc 收起；
 *   · 都不遮正文（是浮卡不是弹窗），卡片朝上长、叠在划词胶囊之上；
 *   · 只留真正要做的事，不重复选中的原文以外的元信息。
 *
 * 原型：`D:/Obsidian/.scratch-footnote/ui/showcase-read.html`（不进仓库）。
 * 尺寸与圆角按原型 1× 稿：脚注 470/12、书摘 480/12、AI 430/14、
 * 想法 470/12、确认条 470/10、划线气泡 430/10。
 */

import type { AiTask } from '../data/ai';
import type { KbLink } from '../data/schema';
import { t, type MsgKey } from '../i18n';
import { kbLinksHtml } from './kb-links';
import { AI_CARD_MODES, type AiFollowTurn } from './ai-card';
import { esc } from './render/html';

/** 三档页签上的字。`ask` / `follow` / `probe` / `quiz` 都不进页签，只列三档 */
const MODE_KEYS = {
  explain: 'ai.mode.explain',
  translate: 'ai.mode.translate',
  summarize: 'ai.mode.summarize',
} as const satisfies Record<Exclude<AiTask, 'ask' | 'follow' | 'probe' | 'quiz'>, MsgKey>;

/**
 * ① 脚注：左侧一枚「注」小印，其余全是注文。
 *
 * 不要标题「脚注」、也不要「跳到原文 / 关闭」：注就是正文的一句旁白，
 * 抬头和按钮把它变成了一份需要处理的文件。跨章脚注的回程入口在正文里。
 */
export function footnoteCardHtml(text: string): string {
  return `<div class="bzs-fncard"><div class="tx">${esc(text)}</div></div>`;
}

export interface QuoteCardInput {
  /** 选中的原文 */
  text: string;
  title?: string;
  author?: string;
  chapter?: string;
}

/**
 * ② 书摘：左引文右动作的双栏卡。
 *
 * 右栏是固定 108px 的一条：按钮竖着排，宽度写死，
 * 引文再长也不会把按钮挤成两行。
 */
export function quoteCardHtml(input: QuoteCardInput): string {
  const from = [input.title, input.author, input.chapter].filter(Boolean).join(' · ');
  const md = `「${input.text}」${from ? `\n— ${from}` : ''}`;
  /* 2026-11-10：书摘图片下放基础版，复制图片对所有人都可见。
     图片一律带 bz reader 徽章，不再按授权决定这颗按钮出不出现。 */
  const img = `<button class="bzs-btn" data-act="quotecopyimg">复制图片</button>`;
  return `<div class="bzs-quote-card">
    <div class="main"><p class="q">${esc(input.text)}</p><div class="from">${esc(from)}</div></div>
    <div class="side">
      <button class="bzs-btn pri" data-act="copytext" data-text="${esc(md)}">复制引用</button>
      <button class="bzs-btn" data-act="quotesave">存笔记</button>
      ${img}
    </div>
  </div>`;
}

export interface AiCardInput {
  /** 服务商、模型、密钥是否都配好了 */
  ready: boolean;
  /** 当前问的是哪一档（解释 / 翻译 / 摘要），缺省 = 解释 */
  mode?: AiTask;
  /** 划选的原文：压成两行，切档时能确认问的是哪一句 */
  quote?: string;
  /** 卡上的正文：结果 / 失败原因。空 = 还没有结果 */
  text?: string;
  /** 请求还在路上：没有正文时据此画占位文案 */
  busy?: boolean;
  /** 追问轮次：重画时从账本取回，初次问答不在里面 */
  turns?: AiFollowTurn[];
  /** 有没有一条自己的划线可以承接「存成想法」 */
  canMark?: boolean;
}

/**
 * 追问轮次：问题一行、答案一段；失败的那轮只留原因。
 *
 * 单独导出是给"追问中"那一路用的：请求发出去之后不整卡重画（输入框在卡里，
 * 换掉会丢焦点），只把这一块 innerHTML 换掉。
 */
export function aiTurnsHtml(turns?: AiFollowTurn[], pending?: string): string {
  const list = (turns ?? [])
    .map((turn) => {
      const q = turn.q ? `<div class="q">${esc(t('ai.follow.you'))}：${esc(turn.q)}</div>` : '';
      const a = turn.error
        ? `<div class="a is-bad">${esc(turn.error)}</div>`
        : `<div class="a">${esc(turn.a)}</div>`;
      return `<div class="bzs-ai-turn">${q}${a}</div>`;
    })
    .join('');
  const wait = String(pending ?? '').trim()
    ? `<div class="bzs-ai-turn is-busy"><div class="q">${esc(t('ai.follow.you'))}：${esc(pending ?? '')}</div><div class="a">${esc(t('ai.follow.busy'))}</div></div>`
    : '';
  return list + wait;
}

/**
 * ③ AI：原文一截 + 三档页签 + 结果与三个动作。
 *
 * 顺序是「问的是哪段 → 怎么问 → 答案」：引文只留两行，压不住下面的答案。
 * 三档就在卡里切（解释 / 翻译 / 摘要，默认解释），不再让用户先关掉卡片、
 * 回工具条上重新点一次——以前那三颗是三条入口，问同一段话要来回点。
 *
 * 正文取自记账（shell/ai-card），不是「有结果就写 text、没有就写正在请求」：
 * 重画之后还得画得出同一份答案，否则切档、点按钮都会把答案冲掉。
 *
 * 2026-11-10 加追问：答案下面一条输入框，问完续在轮次里。追问与三档共用
 * 同一份账，切档时整份跟着档走。
 */
export function aiCardHtml(input: AiCardInput): string {
  const mode = input.mode ?? 'explain';
  const body = !input.ready
    ? t('ai.card.needSetup')
    : input.text || (input.busy ? t('ai.card.busy') : '');
  const quote = input.quote ? `<div class="quote">「${esc(input.quote)}」</div>` : '';
  /* 没配服务时不摆页签：切了也不会有结果，三颗亮着的按钮只会误导 */
  const modes = input.ready
    ? `<div class="modes" role="tablist">${AI_CARD_MODES.map((m) => {
        const on = m === mode;
        return `<button type="button" class="bzs-ai-mode${on ? ' on' : ''}" role="tab" aria-selected="${on}" data-act="aimode" data-mode="${m}">${esc(
          t(MODE_KEYS[m as keyof typeof MODE_KEYS]),
        )}</button>`;
      }).join('')}</div>`
    : '';
  /* 追问行：没配服务不摆（点了也只会得到一句「还没配置」） */
  const askrow = input.ready
    ? `<div class="askrow">
      <input type="text" data-role="aifollow" placeholder="${esc(t('ai.follow.ph'))}">
      <button type="button" class="bzs-btn sm pri" data-act="aifollow">${esc(t('ai.follow.send'))}</button>
    </div>`
    : '';
  const mark = input.canMark
    ? `<button class="bzs-btn" data-act="aitomark">${esc(t('ai.save.mark'))}</button>`
    : '';
  return `<div class="bzs-ai-card">
    ${quote}
    ${modes}
    <div class="body" data-role="aibody">${esc(body)}</div>
    <div class="turns" data-role="aiturns">${aiTurnsHtml(input.turns)}</div>
    ${askrow}
    <div class="foot">
      <button class="bzs-btn" data-act="aicopy">${esc(t('ai.card.copy'))}</button>
      <button class="bzs-btn" data-act="airetry">${esc(t('ai.card.retry'))}</button>
      ${mark}
      <span class="sp"></span>
      <button class="bzs-btn pri" data-act="aisave">${esc(t('ai.card.save'))}</button>
    </div>
  </div>`;
}

/**
 * ④ 想法的二次确认：写了一半按 Esc / 点外面时才出现。
 *
 * 「丢弃」是危险动作，放右边且不描边强调；「继续写」用灰字，
 * 和卡片里唯一的主按钮（发送）拉开层级——这一条永远不该是主路径。
 */
export function ideaConfirmHtml(): string {
  return `<div class="bzs-idea-confirm">
    <span class="tx">还有没保存的内容，要丢弃吗？</span><span class="sp"></span>
    <button class="ghost" data-act="ideakeep">继续写</button>
    <button data-act="ideadiscard">丢弃</button>
  </div>`;
}

/**
 * ⑤ 点中已有划线时先出的想法气泡。
 *
 * 只显示想法本身：原文就在屏幕上那段高亮里，再抄一遍是纯噪音。
 * 气泡在上、换色胶囊在下（见 text-toolbar.ts）。
 *
 * 2026-11-08 起多一行知识盒标签：存过名词 / 段落的那条划线，这里显示成
 * 一枚可点按钮（`data-act="kbopen"`）。想法为空、只有链接时气泡照样出现——
 * 用户点划线就是想找那条链接，不能因为没写想法就把它藏掉。
 *
 * 2026-11-09 起版式照脚注卡走：左侧一枚「想」字小印（CSS 的 ::before，
 * 与「注」同一套），正文单独一块可滚区。500 / 1000 字的想法只在气泡里
 * 露一截，底部给「展开全文」——整篇读进 overlayIdeaAll 的只读弹窗。
 */

/**
 * 气泡里最多露出来的字数。
 *
 * 超过这个数就多一枚「展开全文」。它是「要不要给出口」的判据，不是截断：
 * 正文仍然整段在 DOM 里，只是外层限高、可滚。200 字是两端都接近
 * 「要滚了」的位置（桌面约 11 行、手机约 9 行）。
 */
export const IDEA_BUBBLE_MAX_CHARS = 200;

export function ideaNeedsExpand(comment: string): boolean {
  return comment.trim().length > IDEA_BUBBLE_MAX_CHARS;
}

export interface MarkBubbleOpts {
  /** 这条标注的 id / 书 id：长想法点「展开全文」时要用 */
  markId?: string;
  bookId?: string;
}

export function markBubbleHtml(comment: string, kb?: KbLink[], opts: MarkBubbleOpts = {}): string {
  const idea = comment ? esc(comment) : '';
  /* 没有 markId 就不给出口：按钮点下去不知道该开哪一条 */
  const long = !!idea && ideaNeedsExpand(comment) && !!opts.markId;
  const body = `<div class="scroll">${idea ? `<div class="tx">${idea}</div>` : ''}${kbLinksHtml(kb)}</div>`;
  const foot = long
    ? `<div class="foot"><button type="button" class="bzs-idea-more" data-act="ideaexpand" data-id="${esc(
        opts.markId ?? '',
      )}" data-book="${esc(opts.bookId ?? '')}">${esc(t('idea.expand'))}</button></div>`
    : '';
  return `<div class="bzs-mark-bubble${long ? ' is-long' : ''}">${body}${foot}</div>`;
}

/**
 * 只读全文：一张能滚的完整想法（「展开全文」弹窗的正文）。
 *
 * 气泡里的高度是有限的；要通读、要抄，得有一块不打折的地方。
 * 保留换行——想法里的分行是用户自己排的。
 */
export function ideaFullHtml(comment: string): string {
  return `<div class="bzs-idea-full">${esc(comment)}</div>`;
}

export interface BookmarkDeleteInput {
  id: string;
  bookId: string;
  /** 书签名（用户自己写的或章节名兜底） */
  label: string;
  /** 目录名，可能为空 */
  chapter?: string;
  bookTitle?: string;
}

/**
 * ⑥ 删除书签的确认卡。
 *
 * 和删除划线同一套：把要删的东西摊开写清楚，而不是「再点一次」。
 * 划线那版的正文是原文摘录；书签没有原文，能拿出来的是
 * 「书名 · 目录名」和它自己的名字。
 */
export function bookmarkDeleteHtml(input: BookmarkDeleteInput): { body: string; foot: string } {
  const where = [input.bookTitle, input.chapter].filter((s) => !!s && s.trim()).join(' · ');
  const body = `<div class="bzs-qcard"><div class="q">${esc(input.label)}</div>
      ${where ? `<div class="loc">${esc(where)}</div>` : ''}</div>
    <div class="bzs-mini" style="margin-top:12px;line-height:1.9">这枚书签会删掉，不能撤销。划线与想法不受影响。</div>`;
  const foot = `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn danger" data-act="delbmkdo" data-id="${esc(input.id)}" data-book="${esc(
       input.bookId,
     )}">删除</button>`;
  return { body, foot };
}

export interface MarkDeleteBarInput {
  id: string;
  bookId: string;
  /** 这条划线是否带着想法：有才提「想法会一起删掉」 */
  hasIdea?: boolean;
}

/**
 * ⑦ 删除划线的确认条（桌面工具条）。
 *
 * 一行字 + 两颗按钮，不是一张卡：它贴在工具条上方，和想法 / 书摘同一列，
 * 高度一多就把工具条挤走。删除不可撤销，所以不提供「不再提示」。
 */
export function markDeleteBarHtml(input: MarkDeleteBarInput): string {
  const tx = input.hasIdea ? '删除这条划线？想法会一起删掉。' : '删除这条划线？';
  return `<div class="bzs-del-bar">
    <span class="tx">${tx}</span><span class="sp"></span>
    <button class="ghost" data-act="close">取消</button>
    <button class="danger" data-act="delmarkdo" data-id="${esc(input.id)}" data-book="${esc(input.bookId)}">删除</button>
  </div>`;
}

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

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

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
  /** 高级能力位 cap:'card'：把这张卡画成图片复制 */
  canImage?: boolean;
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
  /* 「复制图片」只在解锁「书摘卡片」之后出现：卡转图要读 canvas，
     没有这项能力的人给它一颗点了报错的按钮没有意义。 */
  const img = input.canImage ? `<button class="bzs-btn" data-act="quotecopyimg">复制图片</button>` : '';
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
  /** 已经有结果时直接放进来（重试后就地换成新文本） */
  answer?: string;
}

/**
 * ③ AI：只有结果与三个动作。
 *
 * 没有模式切换（解释 / 翻译 / 摘要已经各自是入口，卡里再摆一排等于
 * 让用户先选一次再等一次）、没有「只发送选中的这一段」这种免责话。
 * 请求失败时把失败原因留在 body 里，重试按钮就在下面。
 */
export function aiCardHtml(input: AiCardInput): string {
  const body =
    input.answer ?? (input.ready ? '正在请求…' : '还没有配置 AI 服务。到 书架 · 设置 里填好服务商、模型与密钥。');
  return `<div class="bzs-ai-card">
    <div class="body" data-role="aibody">${esc(body)}</div>
    <div class="foot">
      <button class="bzs-btn" data-act="aicopy">复制</button>
      <button class="bzs-btn" data-act="airetry">重试</button>
      <span class="sp"></span>
      <button class="bzs-btn pri" data-act="aisave">存为笔记</button>
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
 */
export function markBubbleHtml(comment: string): string {
  return `<div class="bzs-mark-bubble">${esc(comment)}</div>`;
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

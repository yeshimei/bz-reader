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
}

/**
 * ② 书摘：左引文右动作的双栏卡。
 *
 * 右栏是固定 108px 的一条：两个按钮竖着排，宽度写死，
 * 引文再长也不会把按钮挤成两行。
 */
export function quoteCardHtml(input: QuoteCardInput): string {
  const from = [input.title, input.author, input.chapter].filter(Boolean).join(' · ');
  const md = `「${input.text}」${from ? `\n— ${from}` : ''}`;
  return `<div class="bzs-quote-card">
    <div class="main"><p class="q">${esc(input.text)}</p><div class="from">${esc(from)}</div></div>
    <div class="side">
      <button class="bzs-btn pri" data-act="copytext" data-text="${esc(md)}">复制引用</button>
      <button class="bzs-btn" data-act="quotesave">存笔记</button>
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

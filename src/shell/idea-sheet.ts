/**
 * 想法输入卡（移动端专用形态）。
 *
 * 微信读书那套的要点：卡片里只放三样——引用的原文、一个输入框、取消/保存。
 * 不放章节名、不放配色说明、不放「想法会出现在哪里」这类解释文字：
 * 手机上多一行字就少一行正文，而且这些信息对正在写的人是噪音。
 *
 * 单独成模块是为了能被 node 里的单测直接调用（overlay.ts 拖进 foliate 的
 * DOM 依赖，测试环境 import 就炸）。
 */

export interface IdeaSheetInput {
  /** 被划的原文 */
  quote: string;
  /** 已有想法（编辑场景） */
  value?: string;
  markId: string;
  bookId: string;
  /** 字数上限，默认 2000 */
  max?: number;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** 卡片主体：引用 + 输入框（不含底部按钮） */
export function ideaSheetBodyHtml(input: IdeaSheetInput): string {
  const quote = input.quote.length > 80 ? `${input.quote.slice(0, 80)}…` : input.quote;
  const max = input.max ?? 2000;
  return `<div class="bzs-sheet-quote">${esc(quote)}</div>
    <textarea class="bzs-sheet-input" data-role="idea" maxlength="${max}" rows="3" placeholder="写点什么…">${esc(
      input.value ?? '',
    )}</textarea>`;
}

/** 底部按钮：只有取消与保存 */
export function ideaSheetActsHtml(input: IdeaSheetInput): string {
  /* 自带 flex 容器：浮层壳的 footer 不是 flex，直接塞按钮会变成竖排 */
  return `<div class="bzs-sheet-foot"><button class="bzs-btn" data-act="close">取消</button><span class="sp"></span><button class="bzs-btn pri" data-act="ideasave" data-id="${esc(
    input.markId,
  )}" data-book="${esc(input.bookId)}">保存</button></div>`;
}

/** 整卡（测试与预览用；真实渲染由 overlay.ts 套壳） */
export function ideaSheetHtml(input: IdeaSheetInput): string {
  return `<div class="bzs-sheet is-idea">${ideaSheetBodyHtml(input)}<div class="bzs-sheet-foot">${ideaSheetActsHtml(
    input,
  )}</div></div>`;
}

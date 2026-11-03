/**
 * 写想法弹窗：**一个输入框 + 取消 / 保存**。
 *
 * 不重复原文、不放章节、没有说明文字。已有想法直接预填，所以再点一次
 * 「写想法」就是修改。
 *
 * 为什么要有取消：点外面不再关闭（见 state.dismissesOnOutside），
 * 写了一半想退出就只剩这一颗按钮。取消不落盘，输入的内容随之丢弃。
 *
 * 单独成模块是为了能被 node 里的单测直接调用（overlay.ts 拖进 foliate 的
 * DOM 依赖，测试环境 import 就炸）。
 */

export interface IdeaSheetInput {
  /** 已有想法（编辑场景）；会原样放进输入框 */
  value?: string;
  markId: string;
  bookId: string;
  /** 字数上限，默认 2000 */
  max?: number;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** 唯一的输入框 */
export function ideaSheetBodyHtml(input: IdeaSheetInput): string {
  const max = input.max ?? 2000;
  return `<textarea class="bzs-sheet-input" data-role="idea" maxlength="${max}" rows="3" placeholder="写点什么…">${esc(
    input.value ?? '',
  )}</textarea>`;
}

/** 取消在左、保存在右：读起来是「放弃 → 提交」，和别的弹层一个顺序 */
export function ideaSheetActsHtml(input: IdeaSheetInput): string {
  return `<div class="bzs-sheet-foot"><button class="bzs-btn" data-act="close">取消</button><span class="sp"></span><button class="bzs-btn pri" data-act="ideasave" data-id="${esc(
    input.markId,
  )}" data-book="${esc(input.bookId)}">保存</button></div>`;
}

/** 整卡（测试与预览用；真实渲染由 overlay.ts 套壳） */
export function ideaSheetHtml(input: IdeaSheetInput): string {
  return `<div class="bzs-sheet is-idea">${ideaSheetBodyHtml(input)}${ideaSheetActsHtml(input)}</div>`;
}

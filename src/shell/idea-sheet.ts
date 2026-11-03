/**
 * 写想法：**一条输入框 + 一颗发送键**（S10 定稿）。
 *
 * 照原型 showcase-read.html 的「输入条」：衬线正文大小的输入区、右下角
 * 一枚铜色发送，外面没有标题、没有取消——取消这件事交给「关闭前的二次确认」
 * （见 reader-cards.ts 的 ideaConfirmHtml），因为取消在打字之前毫无意义，
 * 在打字之后又太容易误点。
 *
 * 已有想法直接预填，所以再点一次「写想法」就是修改。
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

/** 纸飞机：点一下就存，不叫「保存」也不叫「确定」 */
const SEND_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-7-7 16-2-7z"/></svg>';

/**
 * 唯一的输入框 + 发送键。
 *
 * 输入框用 rows=1 而不是 rows=3：想法大多是一句话，三行高的空框会让人
 * 以为要写一段；内容多了它自己会长（CSS 里 min-height 46px + 自动撑开）。
 */
export function ideaSheetBodyHtml(input: IdeaSheetInput): string {
  const max = input.max ?? 2000;
  return `<div class="bzs-idea-card"><div class="row">
    <textarea class="txt" data-role="idea" maxlength="${max}" rows="1" placeholder="写点什么…">${esc(
      input.value ?? '',
    )}</textarea>
    <button class="send" data-act="ideasave" data-id="${esc(input.markId)}" data-book="${esc(
      input.bookId,
    )}" aria-label="保存想法" title="保存">${SEND_ICON}</button>
  </div></div>`;
}

/** 整卡（测试与预览用；真实渲染由 overlay.ts 套壳） */
export function ideaSheetHtml(input: IdeaSheetInput): string {
  return ideaSheetBodyHtml(input);
}

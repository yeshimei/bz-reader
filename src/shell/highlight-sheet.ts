/**
 * 划线详情卡（移动端，**从侧栏打开时用**）。
 *
 * 正文里点划线走 hltools（贴字的极简工具条）；这张卡只在侧栏 / 命令面板
 * 打开时出现：原文、可编辑想法、改色/复制/删除。因为没有锚点，
 * 手机上贴底展示，桌面上居中靠上。
 */
export interface HighlightSheetInput {
  quote: string;
  comment?: string;
  markId: string;
  bookId: string;
  color: string;
  colors: Array<{ value: string; label: string }>;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** 原文 + 想法输入（不含动作行） */
export function highlightSheetBodyHtml(input: HighlightSheetInput): string {
  const quote = input.quote.length > 120 ? `${input.quote.slice(0, 120)}…` : input.quote;
  return `<div class="bzs-sheet-quote">${esc(quote)}</div>
    <textarea class="bzs-sheet-input" data-role="idea" rows="3" placeholder="写点什么…">${esc(
      input.comment ?? '',
    )}</textarea>`;
}

/** 动作行：色点 + 复制 + 删除 */
export function highlightSheetActsHtml(input: HighlightSheetInput): string {
  const dots = input.colors
    .map(
      (c) =>
        `<button class="bzs-pendot${c.value === input.color ? ' on' : ''}" data-act="hlcolor" data-id="${esc(
          input.markId,
        )}" data-book="${esc(input.bookId)}" data-v="${esc(c.value)}" aria-label="${esc(c.label)}"></button>`,
    )
    .join('');
  return `<div class="bzs-sheet-foot"><div class="bzs-sheet-dots">${dots}</div>
    <span class="sp"></span>
    <button class="bzs-btn pri" data-act="ideasave" data-id="${esc(input.markId)}" data-book="${esc(input.bookId)}">保存</button>
    <button class="bzs-btn" data-act="hlquote" data-id="${esc(input.markId)}" data-book="${esc(input.bookId)}">复制</button>
    <button class="bzs-btn" data-act="hldel" data-id="${esc(input.markId)}" data-book="${esc(input.bookId)}">删除</button></div>`;
}

/**
 * 「文字工具框」里那排控件（纯函数，node 里可直接测）。
 *
 * 点中一条已有划线时只弹这一条：
 *   [四个色点] | 写想法  书摘  双链  复制  删除
 * 有想法就在下面原样显示那段想法。
 *
 * 删掉是唯一的破坏性动作，永远排在最后。
 *
 * 刻意不出现的东西：
 *   · 选中的原文——它就在屏幕上，再复制一遍只是噪音；
 *   · 章节 / 日期 / 笔色名称——对正在操作这条线的人没有用；
 *   · 「换一支笔」「想法会出现在哪里」这类说明文字。
 */

export interface ToolbarColor {
  value: string;
  label: string;
  css: string;
}

export interface TextToolbarInput {
  markId: string;
  bookId: string;
  /** 当前笔色（on 状态） */
  color: string;
  colors: readonly ToolbarColor[];
  /** 已有想法；空 / 空白表示没有 */
  comment?: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/**
 * 工具条 + 想法。
 *
 * 返回的是浮层内部内容，外壳（定位、背景）由 overlay.ts 套。
 * `data-act` 与 data-id / data-book 必须和 actions.ts 里的 case 对上。
 */
export function textToolbarHtml(input: TextToolbarInput): string {
  const id = esc(input.markId);
  const book = esc(input.bookId);
  const dots = input.colors
    .map(
      (c) =>
        `<button class="bzs-pendot${c.value === input.color ? ' on' : ''}" data-act="hlcolor" data-id="${id}" data-book="${book}" data-v="${esc(
          c.value,
        )}" style="background:${esc(c.css)}" aria-label="${esc(c.label)}"></button>`,
    )
    .join('');
  const thought = (input.comment ?? '').trim();
  return `<div class="bzs-hltools">
    <div class="bzs-hltools-row">${dots}<span class="bzs-hltools-sep"></span>
      <button class="bzs-sbtn" data-act="hlidea" data-id="${id}" data-book="${book}">写想法</button>
      <button class="bzs-sbtn" data-act="hlquote" data-id="${id}" data-book="${book}">书摘</button>
      <button class="bzs-sbtn" data-act="copylink" data-id="${id}" data-book="${book}">双链</button>
      <button class="bzs-sbtn" data-act="hlcopy" data-id="${id}" data-book="${book}">复制</button>
      <button class="bzs-sbtn danger" data-act="hldel" data-id="${id}" data-book="${book}">删除</button>
    </div>
    ${thought ? `<div class="bzs-hltools-thought">${esc(thought)}</div>` : ''}
  </div>`;
}

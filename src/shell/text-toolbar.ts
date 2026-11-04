/**
 * 「文字工具框」里那排控件（纯函数，node 里可直接测）。
 *
 * 点中一条已有划线时只弹这一条（题跋式）：
 *   「想」爱我的
 *   ─────────────────
 *   [四个色点] | 写想法  书摘  双链  复制  删除
 * 想法在按钮行上方，先读批注、再决定操作。
 *
 * 删掉是唯一的破坏性动作，永远排在最后。
 *
 * 刻意不出现的东西：
 *   · 选中的原文——它就在屏幕上，再复制一遍只是噪音；
 *   · 章节 / 日期 / 笔色名称——对正在操作这条线的人没有用；
 *   · 「换一支笔」「想法会出现在哪里」这类说明文字。
 */

import { markBubbleHtml } from './reader-cards';

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
 * 结构照 S10 定稿：换色胶囊在上（操作优先），想法气泡在下（有想法才出现）；
 * 胶囊与划词那条同形同尺寸（999 圆角、14px 色点、12.5px 文字），
 * 所以「划一段」和「点回一段」看到的是同一个控件。
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
  return `<div class="bzs-hlbar">${dots}<span class="bzs-hlbar-sep"></span>
    <button class="bzs-sbtn pri" data-act="hlidea" data-id="${id}" data-book="${book}">写想法</button>
    <button class="bzs-sbtn" data-act="hlquote" data-id="${id}" data-book="${book}">书摘</button>
    <button class="bzs-sbtn" data-act="copylink" data-id="${id}" data-book="${book}">双链</button>
    <button class="bzs-sbtn" data-act="hlcopy" data-id="${id}" data-book="${book}">复制</button>
    <button class="bzs-sbtn danger" data-act="hldel" data-id="${id}" data-book="${book}">删除</button>
  </div>${thought ? markBubbleHtml(thought) : ''}`;
}

/**
 * 划词胶囊上的动作（S10 定稿）。
 *
 * 顺序是定稿的一部分：想法在最左（最常点），复制在最右（最少点）。
 * AI 文案只写两个字母——旁边就是「书摘」，四个字会把它推远。
 * 基础版不给 AI 权限时整颗不出现，不做灰锁：每次划词都提醒一次
 * 「你没买」比不给还难受。
 */
export function selActions(hasAi: boolean): Array<{ label: string; act: string }> {
  const list = [
    { label: '想法', act: 'selidea' },
    { label: '书摘', act: 'selquote' },
  ];
  if (hasAi) list.push({ label: 'AI', act: 'selai' });
  list.push({ label: '复制', act: 'selcopy' });
  return list;
}

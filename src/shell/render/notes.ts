/* ============================================================
 * bz-reader · 笔记页（shell/render/notes.ts）
 *
 * 跨书汇总：一本书一组，卡片左缘是笔色竖线，与正文里的划线同源同值。
 * 有三块真实数据要照顾：
 *   1. 并没有「想法类型」，所以卡上只写「想 法」二字，不假装分五类
 *   2. 一条标注可能没有评论，这时卡片就只是引文
 *   3. 每日回顾从「有想法的那几条」里挑，没有就整块不出现
 * ============================================================ */
import { HIGHLIGHT_COLORS } from '../../data/notes';
import { can } from '../../data/entitlement';
import type { MarkRow } from '../domain';
import { filterMarks, fmtWhen, groupByBook } from '../domain';
import { MAG, esc } from './html';

export interface NotesView {
  marks: MarkRow[];
  filter: string;
  kw: string;
  reviewIdx: number;
}

/** 一条标注卡；`showLoc` 为 false 时是详情弹层里用的紧凑版 */
export function noteCardHtml(m: MarkRow, showLoc = true): string {
  return `<div class="bzs-ncard" style="--c:${m.css}">
    <div class="tx"><span class="dot" style="background:${m.css}"></span>${esc(m.text)}</div>
    ${m.comment ? `<div class="cm"><b>想 法</b>${esc(m.comment)}</div>` : ''}
    ${
      showLoc
        ? `<div class="loc"><span class="src">${esc(m.bookTitle)} · ${esc(m.chapterTitle)}</span></div>
            <div class="acts2">
              <button data-act="jumpmark" data-id="${m.id}" data-book="${m.bookId}">↪ 回到原文</button>
              <button data-act="copylink" data-id="${m.id}" data-book="${m.bookId}">⧉ 双向链接${
                can('bilink') ? '' : '<i class="pro">高级</i>'
              }</button>
              <span class="when">${fmtWhen(m.createdAt)}</span>
            </div>`
        : ''
    }
  </div>`;
}

export function viewNotes(v: NotesView): string {
  const shown = filterMarks(v.marks, v.filter, v.kw);
  const groups = groupByBook(shown);

  // 每日回顾：只有写过想法的才值得回看
  const recalls = v.marks.filter((m) => m.comment);
  const rv = recalls.length ? recalls[v.reviewIdx % recalls.length] : null;

  const review = rv
    ? `<div class="bzs-review">
        <div class="kick">每 日 回 顾</div>
        <h3>回来看看这条</h3>
        <div class="q">「${esc(rv.text)}」</div>
        <div class="acts">
          <button class="bzs-btn sm" data-act="reviewnext">下一条 ›</button>
          <button class="bzs-btn sm" data-act="jumpmark" data-id="${rv.id}" data-book="${rv.bookId}">回到原文</button>
          <span class="idx">${(v.reviewIdx % recalls.length) + 1} / ${recalls.length}</span>
        </div>
      </div>`
    : '';

  const chips = [
    `<button class="bzs-chip${v.filter === 'all' ? ' on' : ''}" data-act="notefilter" data-v="all">全部</button>`,
    `<button class="bzs-chip${v.filter === 'comment' ? ' on' : ''}" data-act="notefilter" data-v="comment">有想法</button>`,
    ...HIGHLIGHT_COLORS.map(
      (c) =>
        `<button class="bzs-chip${v.filter === c.value ? ' on' : ''}" data-act="notefilter" data-v="${c.value}"><span class="dot" style="background:${c.css}"></span>${c.label}</button>`,
    ),
  ].join('');

  const body = groups.length
    ? groups
        .map(
          (g) => `<div class="bzs-nbook">
            <div class="bzs-nbook-h">
              <b>${esc(g.bookTitle)}</b><span class="bzs-mini">${g.items.length} 条</span>
              <span class="sp"></span>
              <button class="bzs-btn sm" data-act="exportfile" data-id="${g.bookId}">导出这本</button>
            </div>
            <div class="bzs-ngrid">${g.items.map((m) => noteCardHtml(m)).join('')}</div>
          </div>`,
        )
        .join('')
    : `<div class="bzs-empty">没有匹配的标注。去阅读页选中一段文字，挑一支笔。</div>`;

  return `<div class="bzs-noteshead">
      <div class="bzs-well">${MAG}<input data-role="notekw" placeholder="搜划线、想法、书名" value="${esc(v.kw)}"></div>
      ${chips}
      <span style="flex:1"></span>
      <span class="bzs-mini">${shown.length} 条 · ${v.marks.filter((m) => m.comment).length} 条想法</span>
      <button class="bzs-btn sm pri" data-act="export">导出为 Markdown</button>
    </div>
    ${review}
    ${body}`;
}

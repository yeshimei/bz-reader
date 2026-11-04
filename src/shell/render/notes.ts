/* ============================================================
 * bz-reader · 笔记页（shell/render/notes.ts）
 *
 * 跨书汇总：一本书一组，卡片左缘是笔色竖线，与正文里的划线同源同值。
 * 有三块真实数据要照顾：
 *   1. 并没有「想法类型」，所以卡上只写「想 法」二字，不假装分五类
 *   2. 一条标注可能没有评论，这时卡片就只是引文
 *   3. 每日回顾从「有想法的那几条」里挑，没有就整块不出现
 * ============================================================ */
import { HIGHLIGHT_COLORS, colorLabel } from '../../data/notes';
import { can } from '../../data/entitlement';
import type { MarkRow } from '../domain';
import { filterMarks, fmtWhen, groupByBook } from '../domain';
import { allPicked } from '../note-select';
import { MAG, esc } from './html';

export interface NotesView {
  marks: MarkRow[];
  filter: string;
  kw: string;
  reviewIdx: number;
  /** 批量选择模式（标注多选） */
  select?: boolean;
  /** 已选中的标注 id */
  picked?: string[];
}

/** 一条标注卡；`showLoc` 为 false 时是详情弹层里用的紧凑版 */
export function noteCardHtml(m: MarkRow, showLoc = true, picked = false, select = false): string {
  const check = select
    ? `<button class="bzs-npick${picked ? ' on' : ''}" data-act="notepick" data-id="${m.id}"
        aria-pressed="${picked}" title="${picked ? '取消选中' : '选中'}">${picked ? '✓' : ''}</button>`
    : '';
  return `<div class="bzs-ncard${select ? ' pick' : ''}${picked ? ' on' : ''}" style="--c:${m.css}">
    ${check}
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
  const select = v.select === true;
  const picked = v.picked ?? [];
  const shownIds = shown.map((m) => m.id);

  /* 每日回顾：只有写过想法的才值得回看。
     **按日期轮**（P3-13）：以前是「顺序下一条」——翻一次就往前走一格，
     跟「每日」没有关系；第二天打开还停在上次那条的后面一条，永远轮不到
     真正没看过的那批。现在用「年内第几天」当种子：同一天稳定、隔天换一条，
     「下一条」在当天里继续往后走。
     选择模式下不出现：正在批量挑要删的，跳走干别的会中断。 */
  const recalls = v.marks.filter((m) => m.comment);
  const day = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86_400_000,
  );
  const reviewAt = recalls.length ? (day + v.reviewIdx) % recalls.length : 0;
  const rv = recalls.length ? recalls[reviewAt] : null;

  const review =
    rv && !select
      ? `<div class="bzs-review">
        <div class="kick">每 日 回 顾</div>
        <h3>回来看看这条</h3>
        <div class="q">「${esc(rv.text)}」</div>
        <div class="acts">
          <button class="bzs-btn sm" data-act="reviewnext">下一条 ›</button>
          <button class="bzs-btn sm" data-act="jumpmark" data-id="${rv.id}" data-book="${rv.bookId}">回到原文</button>
          <span class="idx">${reviewAt + 1} / ${recalls.length}</span>
        </div>
      </div>`
      : '';

  const chips = [
    `<button class="bzs-chip${v.filter === 'all' ? ' on' : ''}" data-act="notefilter" data-v="all">全部</button>`,
    `<button class="bzs-chip${v.filter === 'comment' ? ' on' : ''}" data-act="notefilter" data-v="comment">有想法</button>`,
    ...HIGHLIGHT_COLORS.map(
      (c) =>
        `<button class="bzs-chip${v.filter === c.value ? ' on' : ''}" data-act="notefilter" data-v="${c.value}"><span class="dot" style="background:${c.css}"></span>${colorLabel(c.value)}</button>`,
    ),
  ].join('');

  const selBar = select
    ? `<div class="bzs-nselbar">
        <span class="bzs-mini">已选 ${picked.length} 条</span>
        <span class="sp"></span>
        <button class="bzs-btn sm" data-act="noteall">${allPicked(picked, shownIds) ? '取消全选' : '全选'}</button>
        <button class="bzs-btn sm" data-act="notesel">退出选择</button>
        <button class="bzs-btn sm danger" data-act="notedrop"${picked.length ? '' : ' disabled'}>删除${
          picked.length ? ` ${picked.length} 条` : ''
        }</button>
      </div>`
    : '';

  const body = groups.length
    ? groups
        .map(
          (g) => `<div class="bzs-nbook">
            <div class="bzs-nbook-h">
              <b>${esc(g.bookTitle)}</b><span class="bzs-mini">${g.items.length} 条</span>
              <span class="sp"></span>
              <button class="bzs-btn sm" data-act="exportfile" data-id="${g.bookId}">导出这本</button>
            </div>
            <div class="bzs-ngrid">${g.items
              .map((m) => noteCardHtml(m, !select, picked.includes(m.id), select))
              .join('')}</div>
          </div>`,
        )
        .join('')
    : `<div class="bzs-empty">没有匹配的标注。去阅读页选中一段文字，挑一支笔。</div>`;

  return `<div class="bzs-noteshead">
      <div class="bzs-well">${MAG}<input data-role="notekw" placeholder="搜划线、想法、书名" value="${esc(v.kw)}"></div>
      ${chips}
      <span style="flex:1"></span>
      <span class="bzs-mini">${shown.length} 条 · ${v.marks.filter((m) => m.comment).length} 条想法</span>
      ${select ? '' : '<button class="bzs-btn sm" data-act="notesel">选择</button>'}
      <button class="bzs-btn sm pri" data-act="export">导出为 Markdown</button>
    </div>
    ${selBar}
    ${review}
    ${body}`;
}

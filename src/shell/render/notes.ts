/* ============================================================
 * bz-reader · 笔记页（shell/render/notes.ts）
 *
 * 跨书汇总：一本书一组，卡片左缘是笔色竖线，与正文里的划线同源同值。
 * 有三块真实数据要照顾：
 *   1. 并没有「想法类型」，所以卡上只写「想 法」二字，不假装分五类
 *   2. 一条标注可能没有评论，这时卡片就只是引文
 *   3. 每日回顾从「有想法的那几条」里挑，没有就整块不出现
 * ============================================================ */
import { t } from '../../i18n';
import { HIGHLIGHT_COLORS, colorLabel } from '../../data/notes';
import { can } from '../../data/entitlement';
import type { MarkRow } from '../domain';
import { filterMarks, fmtWhen, groupByBook } from '../domain';
import { allPicked } from '../note-select';
import { kbLinksHtml } from '../kb-links';
import { MAG, esc, ico } from './html';

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
    ? `<button class="bzs-npick${picked ? ' on' : ''}" data-act="notepick" data-id="${esc(m.id)}"
        aria-pressed="${picked}" title="${picked ? t('notes.unpick') : t('notes.pick')}">${picked ? '✓' : ''}</button>`
    : '';
  return `<div class="bzs-ncard${select ? ' pick' : ''}${picked ? ' on' : ''}" style="--c:${m.css}">
    ${check}
    <div class="tx"><span class="dot" style="background:${m.css}"></span>${esc(m.text)}</div>
    ${m.comment ? `<div class="cm"><b>${t('side.ideaTag')}</b>${esc(m.comment)}</div>` : ''}
    ${kbLinksHtml(m.kb)}
    ${
      showLoc
        ? `<div class="loc"><span class="src">${esc(m.bookTitle)} · ${esc(m.chapterTitle)}</span></div>
            <div class="acts2">
              <button data-act="jumpmark" data-id="${esc(m.id)}" data-book="${esc(m.bookId)}">↪ ${t('notes.jump')}</button>
              <button data-act="copylink" data-id="${esc(m.id)}" data-book="${esc(m.bookId)}">⧉ ${t('notes.bilink')}${
                can('bilink') ? '' : `<i class="pro">${t('notes.pro')}</i>`
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
  /* Set 一遍：原来是每张卡都 `picked.includes(id)`，500 条标注时是 25 万次
     字符串比较，切一次筛选就卡一下（D5）。 */
  const pickedSet = new Set(picked);
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
        <div class="kick">${t('notes.review.kick')}</div>
        <h3>${t('notes.review.title')}</h3>
        <div class="q">「${esc(rv.text)}」</div>
        <div class="acts">
          <button class="bzs-btn sm" data-act="reviewnext">${t('notes.review.next')}</button>
          <button class="bzs-btn sm" data-act="jumpmark" data-id="${esc(rv.id)}" data-book="${esc(rv.bookId)}">${t('notes.jump')}</button>
          <span class="idx">${reviewAt + 1} / ${recalls.length}</span>
        </div>
      </div>`
      : '';

  const chips = [
    `<button class="bzs-chip${v.filter === 'all' ? ' on' : ''}" data-act="notefilter" data-v="all">${t('notes.filter.all')}</button>`,
    `<button class="bzs-chip${v.filter === 'comment' ? ' on' : ''}" data-act="notefilter" data-v="comment">${t('notes.filter.comment')}</button>`,
    ...HIGHLIGHT_COLORS.map(
      (c) =>
        `<button class="bzs-chip${v.filter === c.value ? ' on' : ''}" data-act="notefilter" data-v="${c.value}"><span class="dot" style="background:${c.css}"></span>${colorLabel(c.value)}</button>`,
    ),
  ].join('');

  const selBar = select
    ? `<div class="bzs-nselbar">
        <span class="bzs-mini">${t('notes.selected', { n: picked.length })}</span>
        <span class="sp"></span>
        <button class="bzs-btn sm" data-act="noteall">${
          allPicked(picked, shownIds) ? t('notes.selectNone') : t('notes.selectAll')
        }</button>
        <button class="bzs-btn sm" data-act="notesel">${t('notes.exitSelect')}</button>
        <button class="bzs-btn sm danger" data-act="notedrop"${picked.length ? '' : ' disabled'}>${
          picked.length ? t('notes.deleteN', { n: picked.length }) : t('notes.delete')
        }</button>
      </div>`
    : '';

  const body = groups.length
    ? groups
        .map(
          (g) => `<div class="bzs-nbook">
            <div class="bzs-nbook-h">
              <b>${esc(g.bookTitle)}</b><span class="bzs-mini">${t('notes.count', { n: g.items.length })}</span>
              <span class="sp"></span>
              <button class="bzs-btn sm" data-act="exportfile" data-id="${esc(g.bookId)}">${t('notes.exportThis')}</button>
            </div>
            <div class="bzs-ngrid">${g.items
              .map((m) => noteCardHtml(m, !select, pickedSet.has(m.id), select))
              .join('')}</div>
          </div>`,
        )
        .join('')
    : `<div class="bzs-empty">${t('notes.empty')}</div>`;

  return `<div class="bzs-noteshead">
      <div class="bzs-well">${MAG}<input data-role="notekw" placeholder="${t('notes.search.ph')}" value="${esc(v.kw)}"></div>
      ${chips}
      <span style="flex:1"></span>
      <span class="bzs-mini">${t('notes.summary', {
        n: shown.length,
        ideas: v.marks.filter((m) => m.comment).length,
      })}</span>
      ${select ? '' : `<button class="bzs-round" data-act="notesel" aria-label="${t('notes.select')}" title="${t(
        'notes.select',
      )}">${ico('listchecks')}</button>`}
      <button class="bzs-btn sm pri" data-act="export">${t('notes.export')}</button>
    </div>
    ${selBar}
    ${review}
    ${body}`;
}

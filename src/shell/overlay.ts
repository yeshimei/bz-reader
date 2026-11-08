/* ============================================================
 * bz-reader · 弹层与浮层（shell/overlay.ts）
 *
 * 一个 fixed 全屏容器挂在 body 上，内部按 state.overlay 渲染一种弹层。
 * 为什么不挂在各视图里：划词条、书摘卡、AI 卡贴在正文上，正文在
 * 阅读视图、而搜索/导入可能从书架发起——一个容器管全部，就不会出现
 * 「弹窗跟着视图一起被销毁」或者「两个遮罩叠在一起」。
 *
 * 容器本身带 .bzs-shell + data-bzaccent，为的是拿到同一套设计令牌；
 * 它的背景被覆盖成透明，所以不会给整屏染色。
 * ============================================================ */
import { isMobileEnv, isMobileShell } from '../core/mobile';
import { t } from '../i18n';
import { planLabel } from '../i18n/plan';
import { anchoredPlacement } from './anchored-style';
import { sheetLift } from './keyboard-inset';
import { ideaSheetBodyHtml, ideaValue } from './idea-sheet';
import { MARK_ACTS, SELECTION_ACTS, planToolbarHit, toggleMoreMenu, toolbarHtml } from './text-toolbar';
import { aiCardHtml, bookmarkDeleteHtml, footnoteCardHtml, ideaConfirmHtml, markBubbleHtml, markDeleteBarHtml } from './reader-cards';
import { HIGHLIGHT_COLORS } from '../data/notes';
import { aiAsk, type AiTask } from '../data/ai';
import type { ReaderBook } from '../data/schema';
import { collectStats } from '../data/stats';
import { cn, esc, coverHtml, ico } from './render/html';
import { setHtml } from '../ui/dom';
import { bmksOf, allMarks, fmtMinutes, fmtWhen, marksOf } from './domain';
import { noteCardHtml } from './render/notes';
import { cardTemplateChipsHtml, quoteCardHtml, quoteRefMarkdown } from './render/quote-card';
import { searchFormHtml, searchResultsHtml } from './render/search';
import { kickBodySearch, resetBodySearch } from './search-run';
import {
  bumpOverlayRev,
  closeOverlay,
  dismissesOnTap,
  getState,
  markIdeaDirty,
  overlayRenderKey,
  persistShellState,
  setStateQuiet,
  setIdeaDraft,
} from './state';
import { getShellSource, liveBooks, shellPrefs, shellSettings } from './source';
import { bzEmbedder, bzEntryReady } from '../data/bz-bridge';
import { aiCardBegin, aiCardDone, aiCardDrop, aiCardFail, aiCardGet, aiCardKey, aiCardReset, aiModeOf } from './ai-card';
import { glyphOf } from './adapt';
import { hydrateCovers } from './covers';
import { PLAN_TABLE, can, entitlement, type Cap, type PlanCell } from '../data/entitlement';
import { protocolUrl } from '../data/deeplink';
import { dataDirOf } from '../core/plugin-path';
import { bindMaskDismiss } from '../core/mask-dismiss';
import { escManager } from '../core/esc-manager';
import { trapFocus } from '../core/ui/focus-trap';
import { RT } from './runtime';
import { rangeFill } from './range-fill';
import { getToc } from '../view/toc-state';
import { dispatchInput } from './actions';
import { groupButtonHtml } from './group';
import { chapterDigests } from '../data/portrait';
import { cachedPortrait, ensurePortrait } from './portrait-cache';
import { portraitStatusLine } from './render/portrait';

/* ─────────── 小工具 ─────────── */

function modal(title: string, sub: string, body: string, foot = '', cls = '', mask = ''): string {
  /* 带输入框的弹窗在移动端要居中偏上：底部抽屉会被软键盘顶出屏幕。
     按内容自动判定，省得每个调用点都要记得传类。
     页脚也要看：激活码框就在 foot 里，只看 body 会把它漏掉。 */
  const withInput = /<(input|textarea)\b/i.test(body) || /<(input|textarea)\b/i.test(foot);
  const scrim = ['bzs-scrim', mask, withInput ? 'has-input' : ''].filter(Boolean).join(' ');
  /* role / aria-modal（C6）：读屏要能听出「这是一张弹窗、焦点该留在这里」，
     宿主自己的 Modal 有这套，壳层弹窗以前是裸 div。焦点圈闭在 paint() 里挂。 */
  return `<div class="${scrim}" data-role="scrim"><div class="bzs-modal ${cls}" role="dialog" aria-modal="true" aria-label="${esc(
    title,
  )}">
    <div class="bzs-mhead"><b>${esc(title)}</b><span class="n">${sub}</span><span class="sp"></span>
      <button class="x" data-act="close" title="${t('common.close')}">${ico('x')}</button></div>
    <div class="bzs-mbody">${body}</div>
    ${foot ? `<div class="bzs-mfoot">${foot}</div>` : ''}
  </div></div>`;
}

function closeBtn(): string {
  return `<span class="sp"></span><button class="bzs-btn pri" data-act="close">知道了</button>`;
}

function bookById(id?: string | null): ReaderBook | undefined {
  const books = liveBooks();
  return id ? books.find((b) => b.id === id) : undefined;
}

function markById(id?: string | null, bookId?: string | null) {
  const books = liveBooks();
  for (const b of books) {
    if (bookId && b.id !== bookId) continue;
    const h = (b.notes?.highlights ?? []).find((x) => x.id === id);
    if (h) return { book: b, mark: h };
  }
  return null;
}

function bookmarkById(id?: string | null, bookId?: string | null) {
  const books = liveBooks();
  for (const b of books) {
    if (bookId && b.id !== bookId) continue;
    const k = (b.notes?.bookmarks ?? []).find((x) => x.id === id);
    if (k) return { book: b, bookmark: k };
  }
  return null;
}

/* ─────────── 各弹层 ─────────── */

/**
 * 搜索命中列表（只这一段随输入替换）。
 *
 * 以前 input 里只写 RT.searchKw 就 return，而 `[data-role="hitlist"]` 从没被
 * 渲染过——用户打字时屏幕毫无变化，必须再点一下「本书 / 全库」才出结果。
 * 这里把「命中计算」交给纯函数 search-hits，顺便避免整块重绘打断中文输入法。
 */
function overlaySearch(): string {
  const { searchKw, searchScope } = getState();
  return modal(
    '搜索',
    '本书 / 全库',
    `${searchFormHtml()}<div data-role="hitlist">${searchResultsHtml(searchKw, searchScope)}</div>`,
    '',
    'wide tall',
  );
}

/**
 * 排版表单本体。
 *
 * 它现在有两个出口：阅读页右上角的浮层（主路径，边调边看）与
 * 命令面板兜底弹层。**同一个函数**，避免两处控件长歪。
 */
export function typographyFormHtml(): string {
  const p = shellPrefs();

  const seg = (name: string, opts: Array<[string, string]>, cur: string): string =>
    `<div class="bzs-seg">${opts
      .map(([v, l]) => `<button class="${cur === v ? 'on' : ''}" data-act="setpref" data-k="${name}" data-v="${v}">${l}</button>`)
      .join('')}</div>`;

  const rng = (k: string, label: string, val: number, min: number, max: number, step: number, unit: string): string => {
    return `<div class="bzs-setrow"><label>${label}</label>
      <input type="range" data-role="pref" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}" style="--fill:${rangeFill(min, max, val)}">
      <span class="val">${k === 'lineHeight' ? val.toFixed(1) : val + unit}</span></div>`;
  };

  /* 方向卡只演示方向本身：写「横排 / 竖排」两个大字。
     以前塞的是书名，书名一长（红楼梦（人文社权威定本彩皮版…））卡片就被撑歪，
     而且用户要看的是「字怎么排」，不是「我的书叫什么」。 */
  const dir = (v: 'horizontal' | 'vertical'): string =>
    `<button class="bzs-dircard${p.layout === v ? ' on' : ''}" data-act="setpref" data-k="layout" data-v="${v}">
      <span class="t${v === 'vertical' ? ' is-v' : ''}">${v === 'vertical' ? '竖排' : '横排'}</span>
    </button>`;

  return `<div class="bzs-setgrp flat bzs-typo">
    ${rng('fontSize', '字号', p.fontSize, 14, 30, 1, 'px')}
    ${rng('lineHeight', '行距', p.lineHeight, 1.4, 2.4, 0.1, '')}
    ${rng('margin', '页边距', p.margin, 8, 120, 4, '')}
    <div class="bzs-setrow"><label>字体</label>${seg(
      'fontFamily',
      [
        ['book', '跟随书籍'],
        ['serif', '宋体'],
        ['sans', '黑体'],
      ],
      p.fontFamily,
    )}</div>
    <div class="bzs-setrow"><label>对齐</label>${seg(
      'align',
      [
        ['justify', '两端对齐'],
        ['left', '左对齐'],
      ],
      p.align,
    )}</div>
    <div class="bzs-setrow bzs-setrow-dir"><label>方向</label>
      <div class="bzs-dirpick">${dir('horizontal')}${dir('vertical')}</div>
    </div>
    <div class="bzs-setrow"><label>栏数</label>${seg(
      'columns',
      [
        ['1', '单栏'],
        ['2', '双栏'],
      ],
      String(p.columns),
    )}</div>
    <div class="bzs-setrow"><label>翻页</label>${seg(
      'flow',
      [
        ['paged', '分页'],
        ['scroll', '滚动'],
      ],
      p.flow,
    )}</div>
  </div>`;
}

/**
 * 排版面板：右上角贴边浮层，改一项正文立刻重排（没有遮罩，边调边看）。
 *
 * 没有标题头：浮层挂在工具栏下面，自己的头部会把上一行的按钮压住；
 * 关闭靠点外面或 Esc（浮层统一走 document 级收口），不需要一枚 ✕。
 */
function overlayTypography(): string {
  return `<div class="bzs-float is-corner no-head" data-role="float">
    <div class="bzs-mbody">${typographyFormHtml()}</div>
  </div>`;
}

function overlayExport(bookId?: string): string {
  const book = bookById(bookId);
  const md = buildPreview(book);
  return modal(
    '导出摘录',
    book ? esc(book.meta.title) : '全部书籍',
    `<div class="bzs-md">${esc(md)}</div>
     <div class="bzs-mini" style="margin-top:10px;line-height:1.9">每条引文都带章节与定位；导出到「${esc(
       shellSettings().exportDir,
     )}」目录，不覆盖你手写的同名笔记。</div>`,
    `<button class="bzs-btn" data-act="copytext" data-text="${esc(md)}">复制 Markdown</button>${closeBtn()}`,
    'wide',
  );
}

function buildPreview(book?: ReaderBook): string {
  const books = book ? [book] : liveBooks().filter((b) => (b.notes?.highlights ?? []).length);
  if (!books.length) return '（还没有划线。去阅读页选中一段文字试试。）';
  const withComments = shellSettings().exportComments;
  return books
    .map((b) => {
      const lines = [`# ${b.meta.title || '未命名'} · 摘录`, ''];
      const groups = new Map<string, string[]>();
      for (const h of marksOf(b)) {
        const key = h.chapterTitle || '未命名章节';
        if (!groups.has(key)) groups.set(key, []);
        const block = [`> ${h.text.replace(/\s*\n\s*/g, ' ')}`, ''];
        if (withComments && h.comment) block.push(`**想法**：${h.comment}`, '');
        if (h.cfiRange)
          block.push(
            `— [在原文中查看](${protocolUrl({
              bookId: b.id,
              cfi: h.cfiRange,
              text: h.text.replace(/\s+/g, ' ').slice(0, 20),
              chapter: h.chapterTitle,
            })})`,
            '',
          );
        groups.get(key)!.push(block.join('\n'));
      }
      for (const [chapter, blocks] of groups) lines.push(`## ${chapter}`, '', ...blocks);
      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}

function overlayBookmap(): string {
  const book = bookById(getState().bookId) ?? liveBooks()[0];
  if (!book) return modal('全书鸟瞰', '全书一屏鸟瞰', '<div class="bzs-empty">还没有打开的书。</div>', closeBtn(), 'wide');
  const marks = marksOf(book);
  const bks = bmksOf(book);
  const chapters = new Map<string, { marks: number; bks: number }>();
  for (const m of marks) {
    const g = chapters.get(m.chapterTitle) ?? { marks: 0, bks: 0 };
    g.marks += 1;
    chapters.set(m.chapterTitle, g);
  }
  for (const k of bks) {
    const g = chapters.get(k.chapterTitle) ?? { marks: 0, bks: 0 };
    g.bks += 1;
    chapters.set(k.chapterTitle, g);
  }
  /* 鸟瞰的章节名来自标注，不是目录项：两者可能差一个「第一章」编号。
     先用完整名字精确找，再用包含关系兜底；找不到 href 时动作层还有名称回查。 */
  /* 有压缩画像时，每章补一句话摘要：鸟瞰不该只是「这章划了几条」 */
  const portrait = cachedPortrait(book.id) ?? null;
  if (cachedPortrait(book.id) === undefined) {
    void ensurePortrait(getShellSource()?.app, book.id, () => bumpOverlayRev());
  }
  const digestRows = portrait ? chapterDigests(portrait) : [];
  const digestOf = (title: string): string => {
    const name = title.trim();
    if (!name) return '';
    const exact = digestRows.find((d) => d.chapter.trim() === name);
    if (exact) return exact.line;
    const loose = digestRows.find((d) => {
      const l = d.chapter.trim();
      return !!l && (l.includes(name) || name.includes(l));
    });
    return loose?.line ?? '';
  };
  const toc = getToc()?.items ?? [];
  const hrefOf = (title: string): string => {
    const t = title.trim();
    if (!t) return '';
    const exact = toc.find((it) => (it.label || '').trim() === t);
    if (exact?.href) return exact.href;
    const loose = toc.find((it) => {
      const l = (it.label || '').trim();
      return !!l && (l.includes(t) || t.includes(l));
    });
    return loose?.href ?? '';
  };
  const rows = [...chapters.entries()]
    .map(
      /* 行要真的能点（S-05）：样式里早就有 cursor:pointer 和 hover 铜底，
         但 DOM 上没有 data-act——看着能点、点下去整块是死的。
         同时补 data-href：review 明确要求带 href，靠章节名回查 TOC 在
         编号不一致时多半找不到（TOC 的 label 常带「第一章」）。 */
      ([title, g], i) => `<div class="row" data-act="jumpch" data-label="${esc(title)}"${
        hrefOf(title) ? ` data-href="${esc(hrefOf(title))}"` : ''
      } role="button" tabindex="0">
        <span class="no">${cn(i + 1)}</span><span class="nm">${esc(title)}${
          digestOf(title) ? `<em class="dg">${esc(digestOf(title))}</em>` : ''
        }</span>
        <div class="strip">${Array.from({ length: Math.min(12, g.marks) }, () => '<u style="background:var(--copper)"></u>').join('')}</div>
        <span class="bzs-mini">${g.marks} 划 · ${g.bks} 签</span></div>`,
    )
    .join('');
  const body = `<div class="bzs-mini" style="margin-bottom:12px">${esc(book.meta.title || '未命名')} · ${
    chapters.size
  } 个有标注的章节 · ${bks.length} 枚书签 · ${marks.length} 条划线。点一行跳到那一章。</div>
    <div class="bzs-bmap">${rows || '<div class="bzs-empty">这本书还没有书签或划线。</div>'}</div>`;
  return modal('全书鸟瞰', '全书一屏鸟瞰', body, closeBtn(), 'wide tall');
}

function overlayQuote(
  text?: string,
  bookId?: string,
  chapterTitle?: string,
  template?: string,
  markId?: string,
): string {
  const book = bookById(bookId ?? getState().bookId);
  const t = text || RT.sel?.text || '';
  const ch = chapterTitle || RT.sel?.chapterTitle || '未命名章节';
  /* 没用过模板就用 RT.cardTpl 记着的那一版：换过一次版式之后，
     下次从别的划线打开还是同一版，不用每次都重选。 */
  const tpl = template || RT.cardTpl;
  const quoteMd = quoteRefMarkdown({
    text: t,
    title: book?.meta.title,
    author: book?.meta.author,
    chapter: ch,
  });
  const body = `${cardTemplateChipsHtml(tpl)}
    ${quoteCardHtml({
      text: t,
      bookTitle: book?.meta.title ?? '未命名',
      author: book?.meta.author ?? '佚名',
      chapter: ch,
      template: tpl,
    })}
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="bzs-btn pri" data-act="copytext" data-text="${esc(quoteMd)}">复制引用</button>
      <button class="bzs-btn" data-act="quotesave">存笔记</button>
      ${__BZ_READER_PRO__ && can('card') ? '<button class="bzs-btn" data-act="quotecopyimg">复制图片</button>' : ''}
    </div>`;
  /* 从划线打开时带 markId：工具条走 hl*，删除/复制都有据可依；
     从刚划的选区打开时没有 markId，退回 sel*（此时删除本来也不该出现）。 */
  const mark = markId ? markById(markId, bookId)?.mark : undefined;
  return textPanel(body, 'bzs-quote-panel', {
    active: 'quote',
    marked: !!markId,
    markId,
    bookId: markId ? (book?.id ?? bookId) : undefined,
    color: mark?.color,
  });
}

/**
 * 写想法：贴着划线的输入条（S10 定稿）。
 *
 * 只有一个输入区和一颗发送键；不重复原文、不放章节与说明。
 * 已有想法会预填，所以再点一次「写想法」就是修改。
 * 无遮罩：想法常常要对照正文写，遮住半页反而写不出来。
 * 有未保存内容时点外面 / 按 Esc，先出二次确认（state.ideaDirty）。
 */
function overlayIdea(markId?: string, bookId?: string): string {
  const found = markById(markId, bookId);
  if (!found) {
    const empty = '<div class="bzs-empty">这条标注已不存在。</div>';
    return isMobileEnv() ? textDialog(`<div class="bzs-float is-dialog bzs-idea-panel">${empty}</div>`) : bareFloat(empty, 'bzs-idea-panel');
  }
  const payload = {
    value: ideaValue(getState().ideaDraft, found.mark.comment),
    markId: found.mark.id,
    bookId: found.book.id,
  };
  const confirm = getState().ideaConfirm ? ideaConfirmHtml() : '';
  return textPanel(`${ideaSheetBodyHtml(payload)}${confirm}`, 'bzs-idea-panel', {
    active: 'idea',
    markId: found.mark.id,
    bookId: found.book.id,
    color: found.mark.color,
  });
}

/**
 * 点中已有划线：桌面是「想法气泡 + 工具条」一列，手机只摆工具条。
 *
 * 手机上不摆气泡不是漏了：手指刚点在字上，那一带本来就没有空位放一段
 * 可能很长的想法；想法在面板里能看能改，不必再在旁边重复一遍。
 */
function overlayHltools(markId?: string, bookId?: string): string {
  const found = markById(markId, bookId);
  if (!found) return '';
  const { book, mark } = found;
  const toolbar = toolbarHtml({
    marked: true,
    compact: isMobileEnv(),
    kb: can('ai') && bzEntryReady(getShellSource()?.app),
    narrow: window.innerWidth < 520,
    color: mark.color ?? 'amber',
    colors: HIGHLIGHT_COLORS,
    acts: MARK_ACTS,
    attrs: `data-id="${esc(mark.id)}" data-book="${esc(book.id)}"`,
  });
  if (isMobileEnv()) return bareFloat(toolbar, 'bzs-hltools-panel');
  const bubble = mark.comment ? markBubbleHtml(mark.comment) : '';
  return bareFloat(`<div class="bzs-tb-stack">${bubble}${toolbar}</div>`, 'bzs-hltools-panel has-stack');
}

/**
 * 删除确认：侧栏行的 × 点下去先问一句。
 *
 * 两种东西共用这套确认：划线（markId）与书签（bookmarkId）。
 * 以前都是「再点一次才删」（toast 提示），但在侧栏里连点两下和
 * 「一次没点准又补一下」几乎分不出来。删除不可撤销，所以不给「不再提示」。
 *
 * 划线有两条路：桌面上从文字工具框点「删除」时带锚点，出一张贴字的小条；
 * 从侧栏的 × 点进来没有锚点，仍走带标题的确认弹窗。
 */
function overlayConfirmDel(
  markId?: string,
  bookId?: string,
  bookmarkId?: string,
  anchor?: { left: number; top: number; width?: number; height?: number },
): string {
  /* 手机上删除确认与书摘 / AI 同一张遮罩弹窗：都从工具条上点出来，
     不该一个从底部抽屉来、另一个从中间来。桌面维持原来的浮卡。 */
  const mask = isMobileEnv() ? 'bzs-text-scrim' : '';
  if (bookmarkId) {
    const found = bookmarkById(bookmarkId, bookId);
    if (!found)
      return modal('删除书签', '', '<div class="bzs-empty">这枚书签已经不在了。</div>', closeBtn(), '', mask);
    const { book, bookmark } = found;
    const { body, foot } = bookmarkDeleteHtml({
      id: bookmark.id,
      bookId: book.id,
      label: bookmark.label || bookmark.chapterTitle || '书签',
      chapter: bookmark.chapterTitle,
      bookTitle: book.meta.title,
    });
    return modal('删除这枚书签？', esc(bookmark.chapterTitle ?? ''), body, foot, '', mask);
  }
  const found = markById(markId, bookId);
  if (!found) return modal('删除划线', '', '<div class="bzs-empty">这条标注已经不在了。</div>', closeBtn(), '', mask);
  const { book, mark } = found;
  /* 桌面工具条：和想法 / 书摘同一列——确认条在上、工具条在下，整块贴着
     划线。不再压遮罩、不再弹带标题的大卡；工具条位置不动，点完不用重找。 */
  if (!isMobileEnv() && anchor) {
    return textPanel(
      markDeleteBarHtml({ id: mark.id, bookId: book.id, hasIdea: !!mark.comment?.trim() }),
      'bzs-del-panel',
      { active: 'del', markId: mark.id, bookId: book.id, color: mark.color },
    );
  }
  const body = `<div class="bzs-qcard"><div class="q">${esc(mark.text)}</div>
      <div class="loc">${esc(book.meta.title || '')} · ${esc(mark.chapterTitle ?? '')}</div></div>
    <div class="bzs-mini" style="margin-top:12px;line-height:1.9">这条划线与它的想法会一起删掉，不能撤销。</div>`;
  return modal(
    '删除这条划线？',
    esc(mark.chapterTitle ?? ''),
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn danger" data-act="delmarkdo" data-id="${mark.id}" data-book="${book.id}">删除</button>`,
    '',
    mask,
  );
}

/**
 * 批量删除确认（标注多选）。
 *
 * 一次删很多条，比单条更需要「删的是哪批」的实感：列前三条 + 总数，
 * 而不是只弹一句「确定删除 37 条吗」。删除不可撤销，所以不提供「不再提示」。
 */
function overlayConfirmDrop(): string {
  const ids = new Set(getState().noteSel);
  const rows = allMarks(liveBooks()).filter((m) => ids.has(m.id));
  if (!rows.length) return modal('删除标注', '', '<div class="bzs-empty">没有选中任何标注。</div>', closeBtn());
  const preview = rows
    .slice(0, 3)
    .map(
      (m) => `<div class="bzs-qcard"><div class="q">${esc(m.text)}</div>
      <div class="loc">${esc(m.bookTitle)} · ${esc(m.chapterTitle)}</div></div>`,
    )
    .join('');
  const more = rows.length > 3 ? `<div class="bzs-mini">还有 ${rows.length - 3} 条…</div>` : '';
  return modal(
    `删除选中的 ${rows.length} 条划线？`,
    '不能撤销',
    `${preview}${more}<div class="bzs-mini" style="margin-top:12px;line-height:1.9">这些划线下的想法会一起删掉。</div>`,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn danger" data-act="notedropdo">删除 ${rows.length} 条</button>`,
  );
}

/**
 * 浮层外壳：**没有遮罩**，也不吃正文上的点击。
 *
 * 排版面板、划线卡、脚注与想法都得「一边看正文一边操作」：遮罩一压，
 * 正文糊掉，用户只能调完再关掉看效果，等于还是弹窗。所以浮层直接挂在
 * fixed 容器里，正文照旧可点可滚。
 *
 * 定位不写 inline style：由 paint() 量完实际尺寸后按锚点摆放；
 * 没有锚点的（从侧栏打开）退回 CSS 里的居中/贴底。
 */

/**
 * 无头浮层：只有内容，没有标题与关闭按钮。
 * 关掉靠点外面（OverlayLayer 的文档级收口），不再多一枚 ✕。
 */
function bareFloat(body: string, cls: string): string {
  return `<div class="bzs-float ${cls} is-anchored" data-role="float">${body}</div>`;
}

/**
 * 手机上的文字面板：一张独立的遮罩弹窗，位置由 CSS 定（居中偏上），
 * 不跟工具条走——手机上工具条与面板一次只出现一样东西。
 */
function textDialog(inner: string): string {
  /* 手机上的文字面板也是「压住正文、焦点该留在里面」的弹窗（C6）。
     aria-label 不能省：只写 role="dialog" 时读屏只会念「对话框」，
     听不出打开的是想法、书摘还是 AI。 */
  return `<div class="bzs-scrim bzs-text-scrim" data-role="scrim" role="dialog" aria-modal="true" aria-label="${esc(
    t('common.dialog'),
  )}">${inner}</div>`;
}

/**
 * 文字面板的两种形态（S11 定稿）。
 *
 * **桌面**：正文在上、同一枚工具条在下，竖着叠一列。工具条永远在同一个
 * 高度上——打开想法 / 书摘 / AI 时它不会跳走，用户不用重新找按钮。
 * 整块再由 `placeAnchored()` 贴到划线之上。
 *
 * **手机**：正文单独进遮罩弹窗，工具条不参与。屏幕窄，一块地方只放得下
 * 一样；而且弹窗要能滚、要能被键盘顶起来，贴着字反而两头不讨好。
 *
 * `acts` 跟着「有没有具体这条划线」走：有 markId 就是 hl*（删除、复制都有
 * 对象），没有就退回 sel*（刚划完的选区，此时不该出现删除）。
 */
function textPanel(
  body: string,
  cls: string,
  opts: {
    active?: string;
    marked?: boolean;
    markId?: string;
    bookId?: string;
    color?: string;
  } = {},
): string {
  if (isMobileEnv()) {
    return textDialog(`<div class="bzs-float is-dialog ${cls}" data-role="float">${body}</div>`);
  }
  const attrs = opts.markId ? `data-id="${esc(opts.markId)}" data-book="${esc(opts.bookId ?? '')}"` : '';
  const toolbar = toolbarHtml({
    marked: opts.marked ?? true,
    color: opts.color,
    colors: HIGHLIGHT_COLORS,
    kb: can('ai') && bzEntryReady(getShellSource()?.app),
    narrow: window.innerWidth < 520,
    acts: opts.markId ? MARK_ACTS : SELECTION_ACTS,
    active: opts.active,
    attrs,
  });
  /* 外壳透明，底板交给 `${cls}-body`：工具条要露在卡片外面，
     不能跟卡片共用一个底——两层白底叠起来像套了个相框。 */
  return bareFloat(
    `<div class="bzs-tb-stack"><div class="bzs-panel-body ${cls}-body">${body}</div>${toolbar}</div>`,
    'has-stack',
  );
}

/**
 * 脚注浮窗（S10 定稿）：左侧一枚「注」小印，其余全是注文。
 *
 * 不写标题「脚注」、也不摆「跳到原文 / 关闭」：注是正文的一句旁白，
 * 抬头与按钮会把它变成一份需要处理的文件。点外面就收。
 * 跨章脚注的回头路在正文里的链接上，不在这张卡里。
 */
function overlayFootnote(text?: string): string {
  return bareFloat(footnoteCardHtml(text ?? ''), 'bzs-fn-panel');
}

/**
 * AI 卡（S10 定稿）：只有结果与三个动作。
 *
 * 没有模式切换（解释 / 翻译 / 摘要已经各自是入口，卡里再摆一排等于让用户
 * 先选一次再等一次），没有模型名标签、没有免责说明。
 * 失败时把原因留在 body 里，「重试」就在下面——不要一句话把弹层关掉。
 */
function overlayAi(markId?: string, bookId?: string): string {
  /* 整段包在 if 里而不是提前 return：esbuild 会连模板一起删掉，
     base 包里就不会留下「AI 助手」的界面文案。 */
  let html = '';
  if (__BZ_READER_PRO__) {
    const s = shellSettings();
    const ready = !!s.ai.baseUrl && !!s.ai.apiKey && !!s.ai.model;
    const o = getState().overlay;
    const text = o?.text || RT.sel?.text || '';
    const mode = aiModeOf(o?.mode);
    const entry = ready ? aiCardGet(aiCardKey('ai', mode, text)) : undefined;
    html = textPanel(
      aiCardHtml({
        ready,
        mode,
        quote: text,
        text: entry?.text,
        /* 没有记账 = 请求正要发出去：先画占位，别让卡片空着 */
        busy: entry ? entry.status === 'busy' : true,
      }),
      'bzs-ai-panel',
      {
        active: 'ai',
        marked: !!markId,
        markId,
        bookId,
        color: markId ? markById(markId, bookId)?.mark.color : undefined,
      },
    );
  }
  return html;
}

function overlayDict(word?: string): string {
  const w = word || RT.dictWord || '';
  const body = `<div class="bzs-dict"><div class="w">${esc(w)}</div>
      <div class="py">选中的词</div>
      <div class="df">插件本身不带离线词典。要查这个词，用下面的 AI 解释——它会结合你正在读的这段来解释，比通用词典更贴近上下文。</div></div>
    <div class="bzs-ai-src">词条来源：AI（需在设置里配置服务商与密钥）</div>`;
  return modal(
    '查词',
    '结合上下文解释',
    body,
    `<button class="bzs-btn pri" data-act="selai">用 AI 解释</button>${closeBtn()}`,
  );
}

function overlayPoster(): string {
  const books = liveBooks();
  const st = collectStats(books);
  /* 读完只认 completedTime（P2-06）：percent 不再是「读完」的判据，
     否则取消读完之后 percent 还停在 1，卡片和海报一直算它读完。 */
  const done = books.filter((b) => !!b.reading.stats.completedTime).length;
  const top = [...st.books].sort((a, b) => b.seconds - a.seconds)[0];
  const year = new Date().getFullYear();
  const body = `<div class="bzs-poster"><div class="yr">${year} · 阅 读 年 报</div>
      <div class="big">${done}</div><h2>本读完了</h2>
      <div class="sub">连续 ${st.streakDays} 天没有断过 · 累计 ${Math.round(st.totalSeconds / 3600)} 小时<br>
        ${top ? `最长的一本是《${esc(top.title)}》，陪了你 ${Math.round(top.seconds / 60)} 分钟` : '还没有读完的记录'}</div>
      <div style="margin-top:22px;font-family:var(--serif);font-size:12px;letter-spacing:.4em;color:var(--copper)">bz 阅读 · 墨与铜</div>
    </div>`;
  return modal(
    '年度海报',
    '可以存成一张图',
    body,
    `<button class="bzs-btn" data-act="copytext" data-text="${year} 阅读年报 · 读完 ${done} 本 · 连续 ${st.streakDays} 天">复制文字版</button>${closeBtn()}`,
  );
}

function overlayGoal(): string {
  const st = getState();
  const done = liveBooks().filter((b) => !!b.reading.stats.completedTime).length;
  const body = `<div class="bzs-setgrp flat">
      <div class="bzs-setrow"><label>今年读</label>
        <input type="range" data-role="goal" min="5" max="100" step="1" value="${st.goal}" style="--fill:${rangeFill(5, 100, st.goal)}">
        <span class="val" id="bzs-goalval">${st.goal} 本</span></div>
      <div class="bzs-mini" style="margin-top:12px;line-height:1.9">已完成 ${done} 本。目标只影响仪表盘上的那圈铜线。</div>
    </div>`;
  return modal('年度目标', '按自己的节奏来', body, closeBtn());
}

/**
 * 重置界面状态：把「会重置」与「不会动」分成两行对照。
 *
 * 最后一句必须点出**真正的数据位置**（可配置，见设置页的「数据目录」）：
 * 否则用户会以为「重置」等于清空数据，或者反过来以为数据没了。
 * 「纸色」那一档已经撤掉（底色跟宿主），文案里不能再提。
 */
function overlayReset(): string {
  const dir = dataDirOf();
  return modal(
    '重置界面状态',
    '只清书架的界面设置，不动你的书与笔记',
    `<div class="bzs-reset">
      <div><b class="k">会重置</b>：书库视图与筛选、年度目标、默认笔色。</div>
      <div><b class="k2">不会动</b>：书、阅读进度、划线、书签、AI 配置。</div>
      <div class="bzs-mini">阅读数据在 ${esc(dir)}/bz-reader.json 里，要清它请直接删那个文件。</div>
    </div>`,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn danger" data-act="resetui">确认重置</button>`,
  );
}

/**
 * 读完一本书时弹的一张卡：打分 + 一句话。
 *
 * 为什么值得专门做：读完是用户记忆最深的时刻，也是晒图的高发点。
 * 它把一个统计数字变成一次记录——代价只是一个弹层。
 *
 * 星星不走重绘：点一下改 class 就够了，重绘会把已经输入的一句话清掉。
 * 保存时从 DOM 读被点亮的颗数。
 */
function overlayFinish(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('读完了', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());

  const st = b.reading.stats;
  const rated = st.rating ?? 0;
  const minutes = Math.max(1, Math.round((st.totalReadTime || 0) / 60));
  const stars = [1, 2, 3, 4, 5]
    .map(
      (i) =>
        `<button class="bzs-star${rated >= i ? ' on' : ''}" data-act="rate" data-v="${i}" aria-label="${i} 星">${ico(
          'star',
        )}</button>`,
    )
    .join('');

  const body = `<div class="bzs-finish">
      <div class="kick">读 完 了</div>
      <h3>${esc(b.meta.title)}</h3>
      <div class="sub">${esc(b.meta.author || '佚名')} · 累计 ${minutes} 分钟</div>
      <div class="bzs-stars" data-role="stars">${stars}</div>
      <textarea data-role="review" rows="3" placeholder="一句话：这本书给你留下了什么">${esc(st.review ?? '')}</textarea>
      <div class="bzs-mini">保存后会写进这本书的元数据，并在导出时带上。</div>
    </div>`;

  return modal(
    '读完一本书',
    '记一笔',
    body,
    `<button class="bzs-btn" data-act="finishskip">跳过</button>
     <button class="bzs-btn pri" data-act="finishsave" data-id="${b.id}">保存</button>`,
  );
}

function overlayDetail(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('书籍详情', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());
  const marks = marksOf(b);
  const bks = bmksOf(b);
  const percent = Math.round((b.reading.position.percent || 0) * 100);
  const missing = b.fileRef.fileMissing === true;
  if (cachedPortrait(b.id) === undefined) {
    void ensurePortrait(getShellSource()?.app, b.id, () => bumpOverlayRev());
  }
  const body = `<div class="bzs-detail">${coverHtml({
    coverUrl: null, // 真封面异步回填（paint 末尾 hydrateCovers），这里只出占位色块
    bg: 'linear-gradient(150deg,#4a3a28,#2c2115)',
    fg: '#e9dcc3',
    glyph: glyphOf(b.meta.title || '无题'),
    title: b.meta.title || '',
    id: b.id,
  })}<div>
      <h2>${esc(b.meta.title || '未命名')}</h2>
      <div class="au">${esc(b.meta.author || '佚名')}</div>
      <div class="desc">${esc(b.meta.description || '这本书还没有简介。')}</div>
      <div class="acts">
        ${
          missing
            ? `<button class="bzs-btn pri" data-act="missing" data-id="${b.id}">重新定位文件…</button>`
            : `<button class="bzs-btn pri" data-act="openbook" data-id="${b.id}">开始阅读 ›</button>`
        }
        <button class="bzs-btn" data-act="fav" data-id="${b.id}">${ico('star')} ${
          getState().favIds.includes(b.id) ? '已收藏' : '收藏'
        }</button>
        <button class="bzs-btn" data-act="done" data-id="${b.id}">${
          b.reading.stats.completedTime ? '标为在读' : '标为读完'
        }</button>
        ${
          can('ai')
            ? `<button class="bzs-btn" data-act="ptopen" data-id="${b.id}">${esc(t('detail.portrait.open'))}</button>`
            : ''
        }
      </div>
      <div class="bzs-kv"><b>阅读进度</b><span>${percent}%</span></div>
      <div class="bzs-kv"><b>累计时长</b><span>${fmtMinutes(b.reading.stats.totalReadTime || 0)}</span></div>
      <div class="bzs-kv"><b>划线 / 书签</b><span>${marks.length} 条 / ${bks.length} 枚</span></div>
      <div class="bzs-kv"><b>上次打开</b><span>${fmtWhen(b.reading.stats.lastReadTime)}</span></div>
      <div class="bzs-kv"><b>${esc(t('detail.portrait'))}</b><span>${esc(
        portraitStatusLine(cachedPortrait(b.id) ?? null, bzEmbedder(getShellSource()?.app).model),
      )}</span></div>
      <div class="bzs-kv"><b>文件</b><span style="max-width:280px;overflow:hidden;text-overflow:ellipsis${
        missing ? ';color:var(--vermilion)' : ''
      }">${esc(b.fileRef.vaultPath)}${missing ? '（失联）' : ''}</span></div>
      ${
        marks.length
          ? `<div class="bzs-sect-h"><b>这本书的划线</b><span class="ln"></span></div>
             <div class="bzs-ngrid">${marks.slice(0, 3).map((m) => noteCardHtml(m, false)).join('')}</div>`
          : ''
      }
    </div></div>`;
  return modal(
    '书籍详情',
    `${b.fileRef.format.toUpperCase()} · ${esc(b.fileRef.vaultPath)}`,
    body,
    `<button class="bzs-btn" data-act="export" data-id="${b.id}">导出这本书的划线</button>${closeBtn()}`,
    'wide tall',
  );
}

/* ─────────── 渲染入口 ─────────── */

/**
 * 解锁弹层：基础版 / 高级版功能对照表。
 *
 * 出现的时机全是「用户刚想干一件事被拦下」——点导出、点卡片、点跨书搜索。
 * 所以第一句仍是他想做的那件事，第二句直接给一张对照表：差在哪，自己看。
 * 面板里**不写价格**——价格会变、渠道会变，写进插件里就成了每次调价都要发版；
 * 只在商店页标价，这里只负责把人送过去。
 */
function planCell(kind: 'free' | 'pro', v: PlanCell): string {
  if (v === 'yes') return `<i class="y">${ico('check')}</i>`;
  if (v === 'part') return `<i class="p">${t('unlock.part')}</i>`;
  return `<i class="n">—</i>`;
}

/* 导出给测试：这一屏是免费用户最常看到的，按钮与群号值得单独钉住 */
export function overlayUnlock(mode?: string): string {
  const v = entitlement();
  /* 不传 mode = 只是「查看功能对照」（设置页那颗按钮），不高亮任何一行。
     以前这里兜底成 export，结果从设置页进来看全表，视线总被拽到导出那行。 */
  const cap = mode ? (mode as Cap) : undefined;
  const paid = v.tier === 'paid';

  /* 不再在表头上写「你点的是朗读 / 基础版此项需高级版」：
     那两行字占掉了整屏最贵的空间，信息量却等于「看下面那张表」。
     做法改成：直接在表里把这一项标亮，并滚到可见范围。 */
  const rows = PLAN_TABLE.map((r) => {
    const hot = !paid && !!cap && r.cap === cap;
    return `<div class="bzs-plan-row${hot ? ' is-cap' : ''}">
        <span>${esc(planLabel(r.key))}${r.note ? `<em>${esc(r.note)}</em>` : ''}</span>
        ${planCell('free', r.free)}${planCell('pro', r.pro)}
      </div>`;
  }).join('');

  const body = `<div class="bzs-unlock">
      <div class="bzs-plan">
        <div class="bzs-plan-row head"><span>${t('unlock.col.feature')}</span><b>${t('unlock.col.base')}</b><b>${t('unlock.col.pro')}</b></div>
        ${rows}
      </div>
    </div>`;

  /* 购买区与激活框都放进页脚：正文里的对照表再长、滚多远，这两个出口
     也钉在底部。以前购买条在正文里，表一长就被推出可视区。 */
  const foot = `<div class="bzs-unlock-foot">
      <div class="bzs-unlock-buy">
        <button class="bzs-btn pri" data-act="buy">${t('unlock.buy')}</button>
        ${groupButtonHtml()}
        <span class="bzs-mini">${t('unlock.hint')}</span>
      </div>
      <div class="bzs-unlock-act">
        <label>${t('unlock.haveCode')}</label>
        <input data-role="license" placeholder="BZR2.…" value="${esc(v.license)}" spellcheck="false">
        <button class="bzs-btn sm pri" data-act="activate">${t('settings.lic.activate')}</button>
      </div>
    </div>`;

  return modal(t('unlock.title'), paid ? t('unlock.activated') : '', body, foot, 'wide tall');
}

function overlayPtClean(): string {
  const list = RT.ptOrphans;
  const body = `<div class="bzs-ack"><p>${esc(t('pt.clean.confirm'))}</p>
      <ul class="bzs-pt-orphans">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  return modal(
    t('pt.clean'),
    '',
    body,
    `<button class="bzs-btn" data-act="close">${esc(t('pt.close'))}</button>
     <button class="bzs-btn pri danger" data-act="ptcleanyes">${esc(t('pt.clean'))}</button>`,
  );
}

/**
 * 重建索引的二次确认。
 *
 * 「重建」在这个插件里等于把这本书的索引整份删掉再重算：删掉的块、花掉的
 * 请求都收不回来，重算期间也没法一边读一边问。所以先摊开写清楚，再让他点。
 * 确认之后不自动开跑——回到「还没建索引」的空态重新选建法（2026-11-07 定稿）。
 */
function overlayRebuildIndex(): string {
  const body = `<div class="bzs-ack"><p>${esc(t('side.ai.rebuild.confirm'))}</p></div>`;
  return modal(
    t('side.ai.index.rebuild'),
    '',
    body,
    `<button class="bzs-btn" data-act="close">${esc(t('common.cancel'))}</button>
     <button class="bzs-btn pri danger" data-act="aiidxrebuildyes">${esc(t('side.ai.index.rebuild'))}</button>`,
  );
}

/**
 * 第一次用「问这本书」时把话说清楚：会把什么发出去、发到哪儿。
 *
 * 只弹一次（`settings.aiAck`），记在这台机器上：换台电脑再讲一遍是应该的。
 * 依据已经不是档位了（每次都是全书 + 共享打开时的笔记），所以这里只剩一种口径。
 */
function overlayAck(): string {
  const body = `<div class="bzs-ack"><p>${esc(t('ack.body.book'))}</p></div>`;
  return modal(t('ack.title'), '', body, `<button class="bzs-btn pri" data-act="ackok">${esc(t('ack.ok'))}</button>`);
}

/**
 * 换数据目录的二次确认。
 *
 * 迁移会搬运整份书库、标注和封面，属于「不可撤销」的操作，所以必须
 * 把「从哪到哪」摊开写清楚，并且说明失败会保留原目录——用户点确认前
 * 得知道最坏结果是什么。
 */
/**
 * 改名：只改书架上显示的名字。
 *
 * 不去重命名笔记库里的文件——那会影响用户自己的 wiki 链接与备份，
 * 而且同一个文件可能在别处被引用。改名只落在 bz 的元数据里。
 */
function overlayRename(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('改名', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());
  const body = `<div class="bzs-setgrp flat">
      <div class="bzs-setrow"><label>书名</label>
        <input data-role="rename" value="${esc(b.meta.title || '')}" spellcheck="false" style="flex:1"></div>
      <div class="bzs-mini" style="margin-top:10px;line-height:1.9">只改书架上显示的名字，笔记库里的文件名不动，
        进度、划线、书签也都不会丢。</div>
    </div>`;
  return modal(
    '改名',
    esc(b.fileRef.format.toUpperCase()),
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn pri" data-act="renamesave" data-id="${b.id}">保存</button>`,
  );
}

/**
 * 移出书架：归档，不删任何数据，也不删文件。
 *
 * 2026-11-06 改：以前这个确认框写的是「进度、划线、书签与想法一起删掉」，
 * 点一下真的删。现在只打归档标记——重新导入同一份文件就复活，
 * 所以按钮也不再是危险色。
 */
function overlayRemoveBook(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('移出书架', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());
  const marks = marksOf(b).length;
  const body = `<div style="font-size:13px;line-height:2;color:var(--t2)">
      《${esc(b.meta.title || '未命名')}》会从书架移走，但<b>数据都保留</b>：阅读进度、${marks} 条划线、书签与想法。<br>
      笔记库里的原文件 <code>${esc(b.fileRef.vaultPath)}</code> <b>不会</b>被删除。<br>
      以后重新导入同一份文件，会自动接上原来的进度和划线。
    </div>`;
  return modal(
    '移出书架',
    esc(b.meta.title || '未命名'),
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn pri" data-act="removebookdo" data-id="${b.id}">移出书架</button>`,
  );
}

/**
 * 文件失联：书还在书架上，记录与数据都在，只是文件不在登记的路径上。
 *
 * 三个出口：在库里按指纹找、手动选一个文件、移出书架（归档）。
 * 不在这里「删记录」——数据一条都不该丢。
 */
function overlayMissing(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('文件失联', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());
  const name = b.meta.title || '未命名';
  const marks = marksOf(b).length;
  const body = `<div style="font-size:13px;line-height:2;color:var(--t2)">
      《${esc(name)}》的文件不在原来的位置了：<br>
      <code>${esc(b.fileRef.vaultPath)}</code><br>
      阅读进度、${marks} 条划线、书签与想法都还在，找到文件就能接上。<br>
      <span style="color:var(--t3);font-size:12px">如果只是改过名，点「在库里找一找」多半能自动认出来。</span>
    </div>`;
  return modal(
    '文件失联',
    esc(name),
    body,
    `<button class="bzs-btn pri" data-act="relocateauto" data-id="${b.id}">在库里找一找</button>
     <button class="bzs-btn" data-act="relocatepick" data-id="${b.id}">选择文件…</button>
     <span class="sp"></span>
     <button class="bzs-btn" data-act="archivebook" data-id="${b.id}">移出书架</button>`,
  );
}

/**
 * 从备份恢复（C12）：把「会发生什么」摊开写清楚，再让他点。
 *
 * 恢复的语义是**整份替换**——备份里有多少本，恢复后就是多少本，当前这台
 * 机器上的书、进度、划线一条都不留。这跟「导入」不是一回事，也和以前的
 * 「合并恢复」不是一回事，所以文案必须自己说出这一点，不能靠用户猜。
 */
function overlayRestore(): string {
  return modal(
    t('restore.title'),
    t('restore.sub'),
    `<div class="bzs-ack">
      <p>${esc(t('restore.body'))}</p>
      <p class="bzs-mini">${esc(t('restore.hint'))}</p>
    </div>`,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">${esc(t('common.cancel'))}</button>
     <button class="bzs-btn danger" data-act="restoredo">${esc(t('restore.do'))}</button>`,
  );
}

const MOVE_COPY: Record<'export' | 'import' | 'data', { title: string; bullets: string[] }> = {
  export: {
    title: '迁移导出目录',
    bullets: [
      '已经导出的书摘笔记会搬到新目录',
      '文件移动时 Obsidian 会同步改写库内所有指向它的链接，不会搬断',
      '中途失败会把已经搬走的文件挪回原处',
    ],
  },
  import: {
    title: '迁移书籍位置',
    bullets: [
      '书库里登记的书文件会搬到新目录',
      '库内指向这些书的链接由 Obsidian 一起改写',
      '书架上每本书的文件路径会跟着更新',
    ],
  },
  data: {
    title: '迁移数据目录',
    bullets: [
      '书架、划线、书签、阅读进度与封面会整体复制到新目录',
      '复制并校验通过后才删除旧目录；中途失败会原样保留',
      '已经粘进笔记的摘录链接不受影响，仍能跳回原文',
    ],
  },
};

function overlayMoveDir(mode: string, raw: string): string {
  const kind = mode === 'export' || mode === 'import' ? mode : 'data';
  let from = '';
  let to = '';
  try {
    const p = JSON.parse(raw || '{}') as { from?: string; to?: string };
    from = p.from || '';
    to = p.to || '';
  } catch {
    /* 坏数据按空处理，下面给重新选择的出口 */
  }
  const copy = MOVE_COPY[kind];
  if (!from || !to) {
    return modal(
      copy.title,
      '',
      '<div class="bzs-empty">目录信息不完整，请关掉重新选择。</div>',
      `<span class="sp"></span><button class="bzs-btn" data-act="close">关闭</button>`,
    );
  }
  const body = `<div class="bzs-move">
      <div class="bzs-move-row"><b>当前目录</b><code>${esc(from)}/</code></div>
      <div class="bzs-move-row to"><b>迁移到</b><code>${esc(to)}/</code></div>
      <ul class="bzs-unlock-list">
        ${copy.bullets.map((t) => `<li>${esc(t)}</li>`).join('')}
      </ul>
      <div class="bzs-mini">迁移要写一批文件，开始后请等提示完成再继续操作。</div>
    </div>`;
  return modal(
    copy.title,
    `${esc(from)} → ${esc(to)}`,
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn pri" data-act="dodirmove">确认迁移</button>`,
  );
}

export function overlayHtml(): string {
  const o = getState().overlay;
  if (!o) return '';
  switch (o.kind) {
    case 'search':
      return overlaySearch();
    case 'typography':
      return overlayTypography();
    case 'export':
      return overlayExport(o.bookId);
    case 'bookmap':
      return overlayBookmap();
    case 'quote':
      return overlayQuote(o.text, o.bookId, o.chapterTitle, o.mode, o.markId);
    case 'idea':
      return overlayIdea(o.markId, o.bookId);
    case 'hltools':
      return overlayHltools(o.markId, o.bookId);
    case 'confirmdel':
      return overlayConfirmDel(o.markId, o.bookId, o.bookmarkId, o.anchor);
    case 'notedrop':
      return overlayConfirmDrop();
    case 'footnote':
      return overlayFootnote(o.text);
    case 'ai':
      return overlayAi(o.markId, o.bookId);
    case 'dict':
      return overlayDict(o.word);
    case 'poster':
      return overlayPoster();
    case 'setgoal':
      return overlayGoal();
    case 'reset':
      return overlayReset();
    case 'detail':
      return overlayDetail(o.bookId);
    case 'finish':
      return overlayFinish(o.bookId);
    case 'unlock':
      return overlayUnlock(o.mode);
    case 'movedir':
      return overlayMoveDir(o.mode || 'data', o.text || '');
    case 'rename':
      return overlayRename(o.bookId);
    case 'removebook':
      return overlayRemoveBook(o.bookId);
    case 'missing':
      return overlayMissing(o.bookId);
    case 'ack':
      return overlayAck();
    case 'ptclean':
      return overlayPtClean();
    case 'rebuildidx':
      return overlayRebuildIndex();
    case 'restore':
      return overlayRestore();
    default:
      return '';
  }
}

/**
 * 上一次真正发出 AI 请求的键（`kind|task|text`）。
 *
 * 以前 `paint()` 里无条件调 `runAiForOverlay()`，而**点击弹层里任何按钮
 * 都会 `paint()`**：想点「存为笔记」，正文立刻变回「正在请求…」，刚看到的
 * 答案被抹掉并重新发一次（花的是用户的钱）；点一次模式切换会在同一 tick
 * 发两条，一条写进已经被替换掉的旧节点，纯浪费（P1-08）。
 *
 * 现在这份记号由 `shell/ai-card` 的账本承担：**在路上的不算重发、已经有
 * 结果的直接画回去**。同一条规则顺带治好了「答案只写在 DOM 上、重画就丢」
 * ——那个症状是卡片永远停在「正在请求…」。
 */

/** 只往「当前这张卡」里写：换档之后旧请求回来，不该污染新卡 */
function currentAiKey(): string {
  const o = getState().overlay;
  if (!o || o.kind !== 'ai') return '';
  const text = o.text || RT.sel?.text || '';
  return aiCardKey(o.kind, aiModeOf(o.mode), text);
}

/**
 * 把册子里的这一条画到**当前**的 DOM 上。
 *
 * 不缓存节点：请求要跑几十秒，中间任何一次重画都会把节点换掉，抓着旧节点
 * 写进去等于写在空气里（用户看到的就是「一直正在请求」）。
 */
function writeAiBody(key: string): void {
  if (!key || currentAiKey() !== key) return;
  const entry = aiCardGet(key);
  /* 还在路上（正文是空的）：占位文案由渲染那一侧画，这里不要写一个空串进去 */
  if (!entry || !entry.text) return;
  const node = document.querySelector<HTMLElement>('[data-role="aibody"]');
  if (node) node.textContent = entry.text;
}

/** 正在跑的请求：`RT.aiAbort` 给「取消请求」用，这里额外记着它是哪一档 */
let aiInFlight: { key: string; ctrl: AbortController } | null = null;

/** AI 请求：弹层打开后自己发一次，结果记进册子并回填到 [data-role="aibody"] */
export async function runAiForOverlay(): Promise<void> {
  const o = getState().overlay;
  if (!o || o.kind !== 'ai') return;
  /* 到期 / 未解锁不再发请求：弹层可能是在有码时打开的，跑完再点重试也得拦 */
  if (!can('ai')) return;
  const s = shellSettings();
  if (!s.ai.baseUrl || !s.ai.apiKey || !s.ai.model) return;
  const text = o.text || RT.sel?.text || '';
  const task: AiTask = aiModeOf(o.mode);
  const key = aiCardKey(o.kind, task, text);

  /* 同一条还在路上：把占位画回去就够，绝不重复发（花的是用户的钱） */
  if (aiInFlight?.key === key) {
    writeAiBody(key);
    return;
  }
  const entry = aiCardGet(key);
  /* 已经问过：结果 / 失败原因都还在册子上，画回去即可。失败不自动重发，
     重发是「重试」那颗按钮的事——自动重发等于用户每点一下都扣一次费 */
  if (entry && entry.status !== 'busy') {
    writeAiBody(key);
    return;
  }
  /* 换档 / 换一段：把旧请求掐掉，它的机会已经过去了 */
  if (aiInFlight) {
    const old = aiInFlight;
    aiInFlight = null;
    if (RT.aiAbort === old.ctrl) RT.aiAbort = null;
    old.ctrl.abort();
    aiCardDrop(old.key);
  }
  aiCardBegin(key);
  const ctrl = new AbortController();
  aiInFlight = { key, ctrl };
  RT.aiAbort = ctrl;
  try {
    const res = await aiAsk(s, { task, text }, { signal: ctrl.signal });
    if (aiInFlight?.ctrl === ctrl) {
      aiInFlight = null;
      RT.aiAbort = null;
    }
    /* 只进卡片的册子，**不**写侧栏的问答记录：工具栏这条路是「问一小段」，
       侧栏那条是「问整本书」，两边的上下文、花费、追问方式都不一样。
       以前把自己的结果也 push 进侧栏日志，用户会看到侧栏凭空多出一条
       没有提问的答案，捡起来接着问还会发现它根本没有书的依据。 */
    aiCardDone(key, res.text);
  } catch (e) {
    if (aiInFlight?.ctrl === ctrl) {
      aiInFlight = null;
      RT.aiAbort = null;
    }
    /* 被掐掉的请求不留「已取消」这种假结果：取消按钮自己会写一条给人看的，
       换档则连这条都不需要——旧档切回来应该重新问 */
    if (!ctrl.signal.aborted) aiCardFail(key, (e as Error).message);
    else aiCardDrop(key);
  }
  /* 卡已经关了 / 换了另一档：这份结果没人看，别留在册子上冒充「问过了」 */
  if (currentAiKey() !== key) aiCardDrop(key);
  writeAiBody(key);
}

/* ─────────── 容器 ─────────── */

/**
 * 全屏弹层容器。挂 body，用 fixed 定位；内部带 .bzs-shell 拿设计令牌，
 * 但背景透明，所以只是「一层可以放弹窗的空气」，不会给宿主窗口染色。
 */
export class OverlayLayer {
  readonly root: HTMLElement;
  /** 卸载时要撤掉的监听（键盘补偿等） */
  private disposers: Array<() => void> = [];
  private accent = '';
  /** 上一次画的是哪种弹层：同种重画不算「打开」，不抢输入焦点 */
  private lastKind = '';
  /** 当前弹窗的焦点圈闭解绑：每次重画换新节点，旧的跟着旧节点作废 */
  private untrap: (() => void) | null = null;
  /** 正文命中到达时只换命中列表；搜索浮层关闭 / 重画时摘掉 */
  private hitlistCb: (() => void) | null = null;

  /**
   * 浮层（排版 / 工具条 / 脚注 / 书摘 / AI / 想法）没有遮罩，所以「点空白处
   * 关闭」得自己在文档级收：用捕获阶段的 pointerdown，且**不阻断**事件——
   * 点正文照样能选字、翻页。
   *
   * 写想法也走这条路：空着直接关，有字先亮确认条（判断在 closeOverlay 里）。
   * 唯一的例外是点浮层自己——那一下是用户在操作这张卡。
   */
  private onDocPointer = (e: PointerEvent): void => {
    if (!dismissesOnTap(getState().overlay?.kind)) return;
    const t = e.target as Node | null;
    if (t && this.root.contains(t)) return;
    closeOverlay();
  };

  /**
   * ESC 交给 `core/esc-manager` 统一收口（C6）。
   *
   * 以前这里自己挂 document 级 keydown，谁后注册谁先跑，和宿主自带的
   * 弹窗（`ui/modal` 已经走 escManager）完全是两套顺序：叠在一起时先关
   * 哪一层取决于模块加载顺序。注册成一层之后，ESC 从最上面那一层开始关。
   */
  private esc: { unregister: () => void } | null = null;

  constructor(private onAction: (act: string, el: HTMLElement) => void) {
    this.root = createDiv();
    this.root.className = 'bzs-shell bzs-overlay-root';
    /* 视口一变（手机键盘弹起 / 桌面改窗口大小）就重新摆位：
       锚点浮层贴着文字，贴底卡抬到键盘之上。 */
    const sync = (): void => this.syncPosition();
    const vv = window.visualViewport;
    if (vv && isMobileShell()) {
      vv.addEventListener('resize', sync);
      vv.addEventListener('scroll', sync);
      this.disposers.push(() => {
        vv.removeEventListener('resize', sync);
        vv.removeEventListener('scroll', sync);
      });
    }
    window.addEventListener('resize', sync);
    this.disposers.push(() => window.removeEventListener('resize', sync));
    document.body.appendChild(this.root);
    document.addEventListener('pointerdown', this.onDocPointer, true);
    /* 输入框里的 Esc 是「放弃这次输入」，不该顺手把整个弹层关掉（P3-14）：
       写想法写到一半按 Esc，以前是连内容一起没了。 */
    this.esc = escManager.register('bzr-shell-overlay', {
      isVisible: () => !!getState().overlay,
      close: () => {
        const t = document.activeElement as HTMLElement | null;
        if (t && this.root.contains(t) && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
          t.blur();
          return;
        }
        /* 走关闭动作而不是直接 closeOverlay：弹层关闭要带副作用
           （建画像时暂停 + 退回「当前这一屏」）。直接关会绕过它们。 */
        this.onAction('close', this.root);
      },
    });
    this.disposers.push(() => this.esc?.unregister());

    this.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      /* 遮罩关闭交给 bindMaskDismiss（挂在 paint 里那层 scrim 上）：
         以前这里判 `target.dataset.role === 'scrim'`，在弹窗里选字、鼠标滑到
         遮罩上松手时 click 的 target 就是遮罩，面板被误关。 */
      const hit = target.closest<HTMLElement>('[data-act]');
      if (!hit) return;
      e.preventDefault();
      const plan = planToolbarHit(hit.dataset.act);
      if (plan.kind === 'ignore') return;
      /* 「⋯」只开合自己的菜单：就地切一个类，不派发、**不重画**。
         以前这里没有分支，点下去被当成一次普通动作发出去，紧接着
         paint() 把刚画出来的菜单连同 DOM 一起换掉——手机上看到的就是
         「闪一下，打不开」。 */
      if (plan.kind === 'more') {
        const bar = hit.closest<HTMLElement>('.bzs-tb');
        const open = toggleMoreMenu(bar, window.innerHeight);
        hit.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      const before = overlayRenderKey(getState());
      this.onAction(plan.act, hit);
      /* 动作改完状态后重画一次（遮罩内没有视图订阅）。
         rate 例外：它只改星星的 class，紧接着重画会按「还没保存的 rating」
         重建 DOM，星星立刻熄灭、保存下来是 0 星。

         去重（C7）：状态变了的话，`repaint()` 的广播已经走到 sync()→paint()
         画过一遍了；这里再画一次就是整棵 DOM 重建两遍（外加一次封面回填）。
         只有「状态变了但内容键没体现」的变化（换笔色、勾选）才需要补一次。 */
      if (!getState().overlay || plan.act === 'rate') return;
      if (overlayRenderKey(getState()) === before) this.paint();
    });

    this.root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const role = t?.dataset?.role;
      if (!role) return;
      /* 想法：记下正在打的字（重绘时要放回去），并判断有没有改动。
         「有改动」比「非空」准确：打开一条已有想法、什么都不改就点别处，
         不该被问一遍；把旧想法整条删掉反而是改动，必须问。 */
      if (role === 'idea') {
        const o = getState().overlay;
        const found = o ? markById(o.markId, o.bookId) : null;
        setIdeaDraft(t.value);
        markIdeaDirty(t.value.trim() !== (found?.mark.comment ?? '').trim());
        return;
      }
      // 搜索框就地更新命中列表：重绘会把输入框换掉，手指还在打就被打断
      if (role === 'searchkw') {
        /* 输入过程不整页重绘，也不落盘（A-24）：`setState` 每敲一个字都会
           广播 + 同步写一次 localStorage，中文输入法还会被打断。与书架搜索页
           （shelf-panel.ts）用同一条 setStateQuiet；关闭浮层时由 closeOverlay
           走一次正常持久化。 */
        setStateQuiet({ searchKw: t.value });
        const list = this.root.querySelector<HTMLElement>('[data-role="hitlist"]');
        if (list) setHtml(list, searchResultsHtml(t.value, getState().searchScope));
        kickBodySearch(t.value, getState().searchScope);
        return;
      }
      // 排版滑块（pref）、年度目标（goal）、设置项（setting）走与书架同一条链路。
      // 之前这里只认 searchkw，三个排版滑块拖了没有任何反应。
      dispatchInput(t, e);
    });
    /* 松手 / 输入法上屏之后收口一次：input 期间走的是静默写入，不重绘（P1-09）。
       以前只有 input 一个监听，重绘就发生在拖动途中。 */
    const settle = (e: Event): void => {
      const t = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (t?.dataset?.role) dispatchInput(t, e);
    };
    this.root.addEventListener('change', settle);
    this.root.addEventListener('compositionend', settle);
  }

  /** 强调色换档：弹层拿的是同一套令牌，改档不必重画内容 */
  setAccent(accent: string): void {
    if (this.accent === accent) return;
    this.accent = accent;
    this.root.dataset.bzaccent = accent;
  }

  /**
   * 跟着壳层状态重画。
   *
   * 调用方（`plugin.registerShellSync`）已经按 `overlayKey` 判过「内容变了」，
   * 这里直接画就行（P3-02）。以前这里还维护一个 `lastKind`，两个分支都
   * `paint()`——注释里「同一种弹层只重画一次」根本不成立，等于每次 sync
   * 都全量重建一次弹层 DOM。
   */
  sync(): void {
    const o = getState().overlay;
    const kind = o?.kind ?? '';
    /* 同一种弹层重画不算「打开」：亮确认条、点「继续写」都会走到这里，
       重新聚焦会把手机键盘再顶起来一次，而用户的手刚离开输入框。 */
    const prev = this.lastKind;
    const opening = kind !== prev;
    this.lastKind = kind;
    /* 搜索词在输入期间是 setStateQuiet 写的（不广播、不落盘）。离开搜索浮层
       时补一次正常持久化（A-24）——不广播，避免这次关闭再触发一轮重绘。 */
    if (prev === 'search' && kind !== 'search') {
      persistShellState();
      resetBodySearch();
    }
    /* 打开搜索浮层：词若还在（重开 / 从别的浮层切过来），补扫一轮正文 */
    if (opening && kind === 'search') kickBodySearch(getState().searchKw, getState().searchScope);
    this.paint(opening);
  }

  /**
   * 把浮层摆到文字旁边。
   *
   * 量的是渲染后的真实尺寸（想法框会因为内容变高），再交给纯函数算：
   * 移动端贴文字下方、桌面端贴上方，放不下才翻边。
   * 尺寸拿不到（还没布局）时保留 CSS 兜底位置，不会闪到屏幕角上。
   */
  private placeAnchored(): void {
    const anchor = getState().overlay?.anchor;
    if (!anchor) return;
    const el = this.root.querySelector<HTMLElement>('.bzs-float.is-anchored');
    if (!el) return;
    const vv = window.visualViewport;
    const view =
      isMobileShell() && vv
        ? { width: vv.width, height: vv.height, top: vv.offsetTop }
        : { width: window.innerWidth, height: window.innerHeight };
    const pos = anchoredPlacement(
      anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      view,
      /* 上下只看真实承载：桌面验收时开 force-mobile 不该把「工具条在文字下方」
         也一起模拟过去——用户在桌面上要的就是鼠标习惯（贴上方）。 */
      isMobileEnv() ? 'below' : 'above',
    );
    el.setCssProps({ left: `${pos.left}px`, top: `${pos.top}px`, transform: 'none' });
  }

  /** 视口变化后的统一收口：锚点浮层重新贴字，贴底小卡避让键盘 */
  private syncPosition(): void {
    this.placeAnchored();
    const vv = window.visualViewport;
    if (!isMobileShell() || !vv) return;
    const lift = sheetLift({ innerHeight: window.innerHeight, visualHeight: vv.height });
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('.bzs-float.is-sheet'))) {
      el.setCssProps({ bottom: `calc(${10 + lift}px + env(safe-area-inset-bottom, 0px))` });
    }
  }

  /** 焦点还在弹层里的哪个输入框（重画后放回去用） */
  private activeInput(): { role: string; start: number | null; end: number | null } | null {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el || !this.root.contains(el)) return null;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return null;
    const role = el.dataset?.role;
    if (!role) return null;
    return { role, start: el.selectionStart ?? null, end: el.selectionEnd ?? null };
  }

  private restoreInput(keep: { role: string; start: number | null; end: number | null }): void {
    const el = this.root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-role="${keep.role}"]`);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (keep.start !== null && keep.end !== null) {
      try {
        el.setSelectionRange(keep.start, keep.end);
      } catch {
        /* 数字 / 颜色一类输入框不支持选区，忽略即可 */
      }
    }
  }

  private paint(refocus = true): void {
    /* 重画前把激活码输入框的现值记下来（P2-08）：粘贴一枚长码 → 点「激活」→
       同步 paint() 按旧 entitlement 重建 DOM，输入框回到空——再点一次「激活」
       发出去的是空码。 */
    const keepLicense = this.root.querySelector<HTMLInputElement>('[data-role="license"]')?.value ?? '';
    /* 整棵 DOM 换掉 = 滚动位置与光标一起归零（C7）：解锁表翻到一半点一下
       按钮，列表跳回顶部；在输入框里打字时点别的控件，键盘会收起。
       这两样都是「用户刚放好的位置」，记下来还回去。 */
    const keepScroll = this.root.querySelector<HTMLElement>('.bzs-mbody')?.scrollTop ?? 0;
    const keepInput = this.activeInput();
    this.untrap?.();
    this.untrap = null;
    this.setAccent(shellPrefs().accent);
    setHtml(this.root, overlayHtml());
    if (keepLicense) {
      const box = this.root.querySelector<HTMLInputElement>('[data-role="license"]');
      if (box && !box.value) box.value = keepLicense;
    }
    if (keepScroll) {
      const body = this.root.querySelector<HTMLElement>('.bzs-mbody');
      if (body) body.scrollTop = keepScroll;
    }
    /* 弹窗的焦点圈闭（C6）：Tab / Shift+Tab 不出这张卡。浮层（排版、工具条）
       没有遮罩，圈住反而挡住正文，只给 aria-modal 的弹窗挂。 */
    const dialog = this.root.querySelector<HTMLElement>('[aria-modal="true"]');
    if (dialog) this.untrap = trapFocus(dialog);
    /* 点遮罩空白关闭：判据交给 bindMaskDismiss（起点在遮罩 + 位移不超容差），
       在弹窗里选字拖到遮罩上松手不会再误关。每次重画都是新的遮罩元素。
       手机上「想法 / 书摘 / AI / 删除」多了一层 .bzs-text-scrim，所以这里
       要逐个绑——只绑第一个的话，第二层遮罩点了不会关。 */
    for (const scrim of Array.from(this.root.querySelectorAll<HTMLElement>('[data-role="scrim"]'))) {
      bindMaskDismiss(scrim, () => closeOverlay());
    }
    const o = getState().overlay;
    /* 先摆位再聚焦：聚焦可能让键盘立刻弹起，位置要在那之前是对的 */
    this.placeAnchored();
    /* 把焦点还给刚才那个输入框；下面几段「一打开就聚焦」的再覆盖它 */
    if (keepInput) this.restoreInput(keepInput);
    if (o?.kind === 'search') {
      const input = this.root.querySelector<HTMLInputElement>('[data-role="searchkw"]');
      input?.focus();
      const len = input?.value.length ?? 0;
      input?.setSelectionRange(len, len);
    }
    if (o?.kind === 'ai') {
      void runAiForOverlay();
    } else {
      // 离开 AI 卡就把册子清掉：下次划同一段，应该重新问一次
      aiCardReset();
    }
    /* 想法浮窗：打开就把光标放进输入框，少一次点击。
       之后的重画（亮确认条）不再抢焦点——手刚离开输入框。 */
    if (o?.kind === 'idea' && refocus) this.root.querySelector<HTMLTextAreaElement>('[data-role="idea"]')?.focus();
    if (o?.kind === 'rename') {
      const input = this.root.querySelector<HTMLInputElement>('[data-role="rename"]');
      input?.focus();
      input?.select();
    }
    // 解锁表：被拦下的那一行可能在一长串功能下面，把它滚到可见范围里
    if (o?.kind === 'unlock') {
      this.root.querySelector<HTMLElement>('.bzs-plan-row.is-cap')?.scrollIntoView({ block: 'center' });
    }
    // 书籍详情的封面：占位色块先出，真封面到了就地换图
    hydrateCovers(getShellSource()?.app, liveBooks(), this.root);

    /* 正文搜索是异步的：命中到达时只换命中列表，不整页重绘（否则输入框
       和光标会被换掉）。 */
    if (this.hitlistCb) {
      RT.body.listeners.delete(this.hitlistCb);
      this.hitlistCb = null;
    }
    if (o?.kind === 'search') {
      this.hitlistCb = () => {
        const list = this.root.querySelector<HTMLElement>('[data-role="hitlist"]');
        if (list) setHtml(list, searchResultsHtml(getState().searchKw, getState().searchScope));
      };
      RT.body.listeners.add(this.hitlistCb);
    }
  }

  destroy(): void {
    document.removeEventListener('pointerdown', this.onDocPointer, true);
    for (const off of this.disposers) off();
    this.disposers = [];
    if (this.hitlistCb) RT.body.listeners.delete(this.hitlistCb);
    this.hitlistCb = null;
    this.esc = null;
    this.untrap?.();
    this.untrap = null;
    this.root.remove();
  }
}

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
import { anchoredPlacement } from './anchored-style';
import { sheetLift } from './keyboard-inset';
import { ideaSheetActsHtml, ideaSheetBodyHtml } from './idea-sheet';
import { textToolbarHtml } from './text-toolbar';
import { HIGHLIGHT_COLORS } from '../data/notes';
import { aiAsk, type AiTask } from '../data/ai';
import type { ReaderBook } from '../data/schema';
import { collectStats } from '../data/stats';
import { cn, esc, coverHtml, ico, MAG } from './render/html';
import { bmksOf, allMarks, fmtMinutes, fmtWhen, marksOf } from './domain';
import { noteCardHtml } from './render/notes';
import { cardTemplateChipsHtml, quoteCardHtml } from './render/quote-card';
import { searchHits } from './search-hits';
import { closeOverlay, dismissesOnOutside, getState } from './state';
import { getShellSource, liveBooks, shellPrefs, shellSettings } from './source';
import { glyphOf } from './adapt';
import { hydrateCovers } from './covers';
import { CAP_LABEL, PLAN_TABLE, PURCHASE_URL, can, entitlement, tierText, type Cap, type PlanCell } from '../data/entitlement';
import { protocolUrl } from '../data/deeplink';
import { dataDirOf, normalizeDataDir } from '../core/plugin-path';
import { bindMaskDismiss } from '../core/mask-dismiss';
import { RT, pushAi } from './runtime';
import { rangeFill } from './range-fill';
import { dispatchInput } from './actions';
import { trialButtonHtml } from './group';

/* ─────────── 小工具 ─────────── */

function modal(title: string, sub: string, body: string, foot = '', cls = ''): string {
  return `<div class="bzs-scrim" data-role="scrim"><div class="bzs-modal ${cls}">
    <div class="bzs-mhead"><b>${title}</b><span class="n">${sub}</span><span class="sp"></span>
      <button class="x" data-act="close" title="关闭">${ico('x')}</button></div>
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

/* ─────────── 各弹层 ─────────── */

/**
 * 搜索命中列表（只这一段随输入替换）。
 *
 * 以前 input 里只写 RT.searchKw 就 return，而 `[data-role="hitlist"]` 从没被
 * 渲染过——用户打字时屏幕毫无变化，必须再点一下「本书 / 全库」才出结果。
 * 这里把「命中计算」交给纯函数 search-hits，顺便避免整块重绘打断中文输入法。
 */
function searchResultsHtml(kw: string, scope: 'book' | 'all' | 'text'): string {
  /* 正文搜索（新功能「书内搜索的命中定位」）：以前只能搜「已建索引」的
     书名/作者/标注，正文里的字搜不到；跨书搜索又只列文字、点了不跳。
     现在搜到就列出来，点一条直接跳到那一页。 */
  if (scope === 'text') {
    if (!kw.trim()) return `<div class="bzs-empty">输入关键词，点上面的「搜正文」。</div>`;
    if (!getShellSource()?.hasOpenReader()) return `<div class="bzs-empty">先打开一本书，再来搜正文。</div>`;
    if (RT.textSearching) return `<div class="bzs-empty">正在正文里找「${esc(kw)}」…</div>`;
    if (!RT.textHits.length) {
      return `<div class="bzs-empty">正文里没有「${esc(kw)}」<br><br><button class="bzs-btn sm" data-act="searchtext">再搜一次</button></div>`;
    }
    return `<div class="bzs-hits">${RT.textHits
      .map(
        (h) =>
          `<div class="bzs-hit" data-act="hittotext" data-cfi="${esc(h.cfi)}" role="button" tabindex="0">
            <span class="ch">${esc(h.chapterLabel || '')}</span>
            <span class="tx">${esc(h.excerpt)}</span>
          </div>`,
      )
      .join('')}</div>`;
  }
  if (!kw.trim()) return `<div class="bzs-empty">输入关键词。想搜这一本的正文，切到「正文」范围。</div>`;
  const books = (scope === 'book' ? liveBooks().filter((b) => b.id === getState().bookId) : liveBooks()).map((b) => ({
    id: b.id,
    title: b.meta.title,
    author: b.meta.author,
    marks: marksOf(b).map((m) => ({
      id: m.id,
      text: m.text,
      comment: m.comment,
      chapterTitle: m.chapterTitle,
    })),
  }));
  const { groups, total } = searchHits(books, kw);
  if (!total) return `<div class="bzs-empty">没有找到「${esc(kw)}」</div>`;
  return groups
    .map(
      (g) =>
        `<div class="bzs-hitgroup">${esc(g.title)} · ${g.total} 处</div>${g.rows
          .map((r) =>
            r.kind === 'book'
              ? `<button class="bzs-hit" data-act="openbook" data-id="${esc(r.bookId)}"><span class="loc">书籍</span>${esc(r.text)}</button>`
              : `<button class="bzs-hit" data-act="jumpmark" data-id="${esc(r.id)}" data-book="${esc(r.bookId)}"><span class="loc">${esc(r.label)}</span>${esc(r.text)}</button>`,
          )
          .join('')}`,
    )
    .join('');
}

function overlaySearch(): string {
  const scope = RT.searchScope;

  const body = `<div class="bzs-search-in">${MAG}
      <input data-role="searchkw" placeholder="搜书名、作者、章节名或标注里的字…" value="${esc(RT.searchKw)}"></div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <button class="bzs-chip${scope === 'book' ? ' on' : ''}" data-act="searchscope" data-v="book">本书</button>
      <button class="bzs-chip${scope === 'all' ? ' on' : ''}" data-act="searchscope" data-v="all">全库 · ${liveBooks().length} 本</button>
      <button class="bzs-chip${scope === 'text' ? ' on' : ''}" data-act="searchscope" data-v="text">正文</button>
      <button class="bzs-btn sm" data-act="searchtext">搜正文</button>
      <span class="bzs-mini" style="margin-left:auto">${
        scope === 'text' ? '搜这一本的正文，点结果跳到那一页' : '搜的是已建索引的内容：书名、作者、标注与想法'
      }</span>
    </div>
    <div data-role="hitlist">${searchResultsHtml(RT.searchKw, scope)}</div>`;

  return modal('搜索', '本书 / 全库 / 正文', body, '', 'wide tall');
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
    ${rng('ttsRate', '朗读语速', p.ttsRate, 0.6, 2, 0.1, '×')}
    <div class="bzs-setrow"><label>朗读跟随</label>${seg(
      'ttsFollow',
      [
        ['1', '念完续页'],
        ['0', '只念本页'],
      ],
      p.ttsFollow ? '1' : '0',
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
  const rows = [...chapters.entries()]
    .map(
      /* 行要真的能点（S-05）：样式里早就有 cursor:pointer 和 hover 铜底，
         但 DOM 上没有 data-act——看着能点、点下去整块是死的。 */
      ([title, g], i) => `<div class="row" data-act="jumpch" data-label="${esc(title)}" role="button" tabindex="0">
        <span class="no">${cn(i + 1)}</span><span class="nm">${esc(title)}</span>
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

function overlayQuote(text?: string, bookId?: string, chapterTitle?: string, template?: string): string {
  const book = bookById(bookId ?? getState().bookId);
  const t = text || RT.sel?.text || '';
  const ch = chapterTitle || RT.sel?.chapterTitle || '未命名章节';
  /* 没用过模板就用 RT.cardTpl 记着的那一版：换过一次版式之后，
     下次从别的划线打开还是同一版，不用每次都重选。 */
  const tpl = template || RT.cardTpl;
  const body = `${cardTemplateChipsHtml(tpl)}
    ${quoteCardHtml({
      text: t,
      bookTitle: book?.meta.title ?? '未命名',
      author: book?.meta.author ?? '佚名',
      chapter: ch,
      template: tpl,
    })}
    <div class="bzs-mini" style="margin-top:12px;line-height:1.9">复制后粘到任何笔记里，定位串能带你回到同一段。切换版式只改长相，不改内容。</div>`;
  const quoteMd = `「${t}」\n— ${book?.meta.title ?? ''} · ${book?.meta.author ?? ''} · ${ch}`;
  return modal(
    '书摘卡',
    '引文 · 出处 · 定位',
    body,
    `<button class="bzs-btn" data-act="copytext" data-text="${esc(quoteMd)}">复制为引用</button>${closeBtn()}`,
    'wide',
  );
}

/**
 * 写想法：贴着划线的极简输入框。
 *
 * 只有一个输入框和一个保存按钮；不重复原文、不放章节与说明。
 * 已有想法会预填，所以再点一次「写想法」就是修改。
 * 无遮罩：想法常常要对照正文写，遮住半页反而写不出来。
 */
function overlayIdea(markId?: string, bookId?: string): string {
  const found = markById(markId, bookId);
  if (!found) return bareFloat('<div class="bzs-empty">这条标注已不存在。</div>', 'bzs-idea-panel');
  const payload = { value: found.mark.comment ?? '', markId: found.mark.id, bookId: found.book.id };
  return bareFloat(`${ideaSheetBodyHtml(payload)}${ideaSheetActsHtml(payload)}`, 'bzs-idea-panel');
}

/**
 * 文字工具框：点中已有划线时贴字弹出。
 *
 * 一排控件（色点 / 写想法 / 删除）；有想法就在下面原样展示。
 * 不重复原文，也不带章节、日期、笔色说明——这些对正在操作这条线的人都是噪音。
 */
function overlayHltools(markId?: string, bookId?: string): string {
  const found = markById(markId, bookId);
  if (!found) return '';
  const { book, mark } = found;
  return bareFloat(
    textToolbarHtml({
      markId: mark.id,
      bookId: book.id,
      color: mark.color ?? 'amber',
      colors: HIGHLIGHT_COLORS,
      comment: mark.comment ?? '',
    }),
    'bzs-hltools-panel',
  );
}

/**
 * 删除确认：侧栏划线行右上角那颗 × 点下去先问一句。
 *
 * 以前是「再点一次才删」（toast 提示），但在侧栏里连点两下和「一次没点准
 * 又补一下」几乎分不出来；换成一张小卡，把删掉的是哪一段摊开写清楚。
 * 删除不可撤销，所以这里不给「不再提示」。
 */
function overlayConfirmDel(markId?: string, bookId?: string): string {
  const found = markById(markId, bookId);
  if (!found) return modal('删除划线', '', '<div class="bzs-empty">这条标注已经不在了。</div>', closeBtn());
  const { book, mark } = found;
  const body = `<div class="bzs-qcard"><div class="q">${esc(mark.text)}</div>
      <div class="loc">${esc(book.meta.title || '')} · ${esc(mark.chapterTitle ?? '')}</div></div>
    <div class="bzs-mini" style="margin-top:12px;line-height:1.9">这条划线与它的想法会一起删掉，不能撤销。</div>`;
  return modal(
    '删除这条划线？',
    esc(mark.chapterTitle ?? ''),
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn danger" data-act="delmarkdo" data-id="${mark.id}" data-book="${book.id}">删除</button>`,
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
function floatPanel(
  title: string,
  sub: string,
  body: string,
  foot = '',
  cls = '',
  anchor?: { left: number; top: number },
): string {
  return `<div class="bzs-float ${cls} ${anchor ? 'is-anchored' : 'is-sheet'}" data-role="float">
    <div class="bzs-mhead"><b>${title}</b>${sub ? `<span class="n">${sub}</span>` : ''}<span class="sp"></span>
      <button class="x" data-act="close" title="关闭">${ico('x')}</button></div>
    <div class="bzs-mbody">${body}</div>
    ${foot ? `<div class="bzs-mfoot">${foot}</div>` : ''}
  </div>`;
}

/**
 * 无头浮层：只有内容，没有标题与关闭按钮。
 * 关掉靠点外面（OverlayLayer 的文档级收口），不再多一枚 ✕。
 */
function bareFloat(body: string, cls: string): string {
  return `<div class="bzs-float ${cls} is-anchored" data-role="float">${body}</div>`;
}

/**
 * 脚注浮窗：注释号上方一小块，读完继续读，不用跳到章末再找回来。
 * 想看上下文再点「跳到原文」——那才是真的跳。
 */
function overlayFootnote(text?: string, href?: string): string {
  const body = `<div class="bzs-fntext">${esc(text ?? '')}</div>`;
  const foot = href ? `<button class="bzs-btn" data-act="jumpch" data-href="${esc(href)}">跳到原文</button><span class="sp"></span><button class="bzs-btn" data-act="close">关闭</button>` : '';
  return floatPanel('脚注', '', body, foot, '', getState().overlay?.anchor);
}

const AI_MODES: Array<{ key: AiTask; label: string }> = [
  { key: 'explain', label: '解释' },
  { key: 'translate', label: '翻译' },
  { key: 'summarize', label: '摘要' },
];

function overlayAi(text?: string, mode?: string): string {
  /* 整段包在 if 里而不是提前 return：esbuild 会连模板一起删掉，
     base 包里就不会留下「AI 助手」的界面文案。 */
  let html = '';
  if (__BZ_READER_PRO__) {
  const t = text || RT.sel?.text || '';
  const task = (AI_MODES.find((m) => m.key === mode)?.key ?? 'explain') as AiTask;
  const s = shellSettings();
  const ready = !!s.ai.baseUrl && !!s.ai.apiKey && !!s.ai.model;
  const body = `<div class="bzs-ai-tag"><span class="seal">${ico('sparkle')}</span><b>${esc(
    s.ai.model || '未配置模型',
  )} · ${
    AI_MODES.find((m) => m.key === task)?.label
  }</b></div>
    <div class="bzs-ai-quote">「${esc(t)}」</div>
    <div class="bzs-ai-body" data-role="aibody">${ready ? '正在请求…' : '还没有配置 AI 服务。到 书架 · 设置 里填好服务商、模型与密钥。'}</div>
    <div class="bzs-ai-acts">${AI_MODES.map(
      (m) => `<button class="bzs-chip${task === m.key ? ' on' : ''}" data-act="aimode" data-v="${m.key}" data-text="${esc(t)}">${m.label}</button>`,
    ).join('')}</div>`;
  html = modal(
    'AI 助手',
    '只发送选中的这一段',
    body,
    `<button class="bzs-btn" data-act="aisave" data-text="${esc(t)}">存为笔记</button>${closeBtn()}`,
    'wide',
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

function overlayTranslate(text?: string): string {
  const t = text || RT.sel?.text || '';
  const s = shellSettings();
  const ready = !!s.ai.baseUrl && !!s.ai.apiKey && !!s.ai.model;
  const body = `<div class="bzs-ai-quote">「${esc(t)}」</div>
    <div class="bzs-ai-body" data-role="aibody">${ready ? '正在翻译…' : '还没有配置 AI 服务，无法翻译。到 书架 · 设置 里配置。'}</div>
    <div class="bzs-ai-src">只发送选中的这一段 · ${esc(s.ai.model || '未配置模型')}</div>`;
  return modal('翻译', '段落 · 译成中文', body, `<button class="bzs-btn" data-act="copytext" data-text="">复制译文</button>${closeBtn()}`, 'wide');
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

function overlayReset(): string {
  return modal(
    '重置界面状态',
    '只清书架的界面设置，不动你的书与笔记',
    `<div style="font-size:13px;line-height:2;color:var(--t2)">会重置：书库视图与筛选、纸色、年度目标、默认笔色。<br>
     不会动：书、阅读进度、划线、书签、AI 配置。<br>
     阅读数据在 storage/bz-reader.json 里，要清它请直接删那个文件。</div>`,
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
        <button class="bzs-btn pri" data-act="openbook" data-id="${b.id}">开始阅读 ›</button>
        <button class="bzs-btn" data-act="fav" data-id="${b.id}">${ico('star')} ${
          getState().favIds.includes(b.id) ? '已收藏' : '收藏'
        }</button>
        <button class="bzs-btn" data-act="done" data-id="${b.id}">${
          b.reading.stats.completedTime ? '标为在读' : '标为读完'
        }</button>
      </div>
      <div class="bzs-kv"><b>阅读进度</b><span>${percent}%</span></div>
      <div class="bzs-kv"><b>累计时长</b><span>${fmtMinutes(b.reading.stats.totalReadTime || 0)}</span></div>
      <div class="bzs-kv"><b>划线 / 书签</b><span>${marks.length} 条 / ${bks.length} 枚</span></div>
      <div class="bzs-kv"><b>上次打开</b><span>${fmtWhen(b.reading.stats.lastReadTime)}</span></div>
      <div class="bzs-kv"><b>文件</b><span style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(b.fileRef.vaultPath)}</span></div>
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
  if (v === 'part') return `<i class="p">部分</i>`;
  return `<i class="n">—</i>`;
}

function overlayUnlock(mode?: string): string {
  const v = entitlement();
  const cap = (mode || 'export') as Cap;
  const paid = v.tier === 'paid';

  /* 不再在表头上写「你点的是朗读 / 基础版此项需高级版」：
     那两行字占掉了整屏最贵的空间，信息量却等于「看下面那张表」。
     做法改成：直接在表里把这一项标亮。 */
  const rows = PLAN_TABLE.map((r) => {
    const hot = !paid && r.cap === cap;
    return `<div class="bzs-plan-row${hot ? ' is-cap' : ''}">
        <span>${esc(r.name)}${r.note ? `<em>${esc(r.note)}</em>` : ''}</span>
        ${planCell('free', r.free)}${planCell('pro', r.pro)}
      </div>`;
  }).join('');

  const body = `<div class="bzs-unlock">
      <div class="bzs-plan">
        <div class="bzs-plan-row head"><span>功能</span><b>基础版</b><b>高级版</b></div>
        ${rows}
      </div>
      <div class="bzs-unlock-buy">
        <button class="bzs-btn pri" data-act="buy">去购买</button>
        ${trialButtonHtml()}
        <span class="bzs-mini">购买后拿到激活码，填在下面即可</span>
      </div>
    </div>`;

  // 激活框独占页脚整行：输入框与按钮挨着，眼睛不用在两端来回找
  const foot = `<div class="bzs-unlock-act">
      <label>已有激活码</label>
      <input data-role="license" placeholder="BZR2.…" value="${esc(v.license)}" spellcheck="false">
      <button class="bzs-btn sm pri" data-act="activate">激活</button>
    </div>`;

  return modal('高级版', paid ? '已激活' : '', body, foot, 'wide tall');
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
 * 移除书库：删记录与标注，不删文件。
 *
 * 这两件事的后果差很远——删文件是不可逆的，用户点「移除」多半只是想
 * 让它从书架上消失。所以文案里把边界写死，确认按钮也只做这一件事。
 */
function overlayRemoveBook(bookId?: string): string {
  const b = bookById(bookId);
  if (!b) return modal('移除书库', '', '<div class="bzs-empty">这本书已不在书库。</div>', closeBtn());
  const marks = marksOf(b).length;
  const body = `<div style="font-size:13px;line-height:2;color:var(--t2)">
      会把《${esc(b.meta.title || '未命名')}》从书架移除：阅读进度、${marks} 条划线、书签与想法一起删掉。<br>
      笔记库里的原文件 <code>${esc(b.fileRef.vaultPath)}</code> <b>不会</b>被删除，之后还能重新导入。
    </div>`;
  return modal(
    '移除书库',
    esc(b.meta.title || '未命名'),
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn danger" data-act="removebookdo" data-id="${b.id}">确认移除</button>`,
  );
}

function overlayMoveData(raw: string): string {
  const from = dataDirOf();
  const to = normalizeDataDir(raw);
  const body = `<div class="bzs-move">
      <div class="bzs-move-row"><b>当前目录</b><code>${esc(from)}/</code></div>
      <div class="bzs-move-row to"><b>迁移到</b><code>${esc(to)}/</code></div>
      <ul class="bzs-unlock-list">
        <li>书架、划线、书签、阅读进度与封面会整体复制到新目录</li>
        <li>复制并校验通过后才删除旧目录；中途失败会原样保留</li>
        <li>已经粘进笔记的摘录链接不受影响，仍能跳回原文</li>
      </ul>
      <div class="bzs-mini">如果新目录里已经有一份数据，同名文件会被这次迁移覆盖。</div>
    </div>`;
  return modal(
    '迁移数据目录',
    `${esc(from)} → ${esc(to)}`,
    body,
    `<span class="sp"></span><button class="bzs-btn" data-act="close">取消</button>
     <button class="bzs-btn pri" data-act="datadomigrate">确认迁移</button>`,
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
      return overlayQuote(o.text, o.bookId, o.chapterTitle, o.mode);
    case 'idea':
      return overlayIdea(o.markId, o.bookId);
    case 'hltools':
      return overlayHltools(o.markId, o.bookId);
    case 'confirmdel':
      return overlayConfirmDel(o.markId, o.bookId);
    case 'notedrop':
      return overlayConfirmDrop();
    case 'footnote':
      return overlayFootnote(o.text, o.href);
    case 'ai':
      return overlayAi(o.text, o.mode);
    case 'dict':
      return overlayDict(o.word);
    case 'translate':
      return overlayTranslate(o.text);
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
    case 'movedata':
      return overlayMoveData(o.text || '');
    case 'rename':
      return overlayRename(o.bookId);
    case 'removebook':
      return overlayRemoveBook(o.bookId);
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
 */
let aiRequestedFor = '';

/** AI 请求：弹层打开后自己发一次，结果回填到 [data-role="aibody"] */
export async function runAiForOverlay(): Promise<void> {
  const o = getState().overlay;
  if (!o || (o.kind !== 'ai' && o.kind !== 'translate')) return;
  const s = shellSettings();
  if (!s.ai.baseUrl || !s.ai.apiKey || !s.ai.model) return;
  const text = o.text || RT.sel?.text || '';
  const task: AiTask = o.kind === 'translate' ? 'translate' : ((o.mode as AiTask) || 'explain');
  const key = `${o.kind}|${task}|${text}`;
  if (key === aiRequestedFor) return;
  aiRequestedFor = key;
  const node = document.querySelector<HTMLElement>('[data-role="aibody"]');
  try {
    const res = await aiAsk(s, task, text);
    if (node) node.textContent = res.text;
    pushAi(false, `AI · ${s.ai.model}`, res.text);
  } catch (e) {
    if (node) node.textContent = (e as Error).message;
  }
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

  /**
   * 浮层（排版 / 工具条 / 脚注）没有遮罩，所以「点空白处关闭」得自己在
   * 文档级收：用捕获阶段的 pointerdown，且**不阻断**事件——点正文照样能选字、翻页。
   * 写想法不在这条路上：它是有内容要保护输入框，只认取消 / 保存 / Esc。
   */
  private onDocPointer = (e: PointerEvent): void => {
    if (!dismissesOnOutside(getState().overlay?.kind)) return;
    const t = e.target as Node | null;
    if (t && this.root.contains(t)) return;
    closeOverlay();
  };

  private onDocKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    /* 以前只关 4 种浮层，搜索/导入/导出/解锁这些有遮罩的弹层按 Esc 毫无反应。
       壳层弹层不是 Obsidian Modal，escManager 管不到这里。 */
    if (!getState().overlay) return;
    /* 输入框里的 Esc 是「放弃这次输入」，不该顺手把整个弹层关掉（P3-14）：
       写想法写到一半按 Esc，以前是连内容一起没了。 */
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      t.blur();
      return;
    }
    closeOverlay();
    e.preventDefault();
    /* 只在真的要关的时候截住（P3-14）：以前无条件 stopImmediatePropagation，
       阅读视图的 Esc（退出沉浸 / 收划词条）永远收不到。 */
    e.stopImmediatePropagation();
  };

  constructor(private onAction: (act: string, el: HTMLElement) => void) {
    this.root = document.createElement('div');
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
    document.addEventListener('keydown', this.onDocKey, true);

    this.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      /* 遮罩关闭交给 bindMaskDismiss（挂在 paint 里那层 scrim 上）：
         以前这里判 `target.dataset.role === 'scrim'`，在弹窗里选字、鼠标滑到
         遮罩上松手时 click 的 target 就是遮罩，面板被误关。 */
      const hit = target.closest<HTMLElement>('[data-act]');
      if (!hit) return;
      e.preventDefault();
      this.onAction(hit.dataset.act || '', hit);
      /* 动作改完状态后重画一次（遮罩内没有视图订阅）。
         rate 例外：它只改星星的 class，紧接着重画会按「还没保存的 rating」
         重建 DOM，星星立刻熄灭、保存下来是 0 星。 */
      if (getState().overlay && hit.dataset.act !== 'rate') this.paint();
    });

    this.root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const role = t?.dataset?.role;
      if (!role) return;
      // 搜索框就地更新命中列表：重绘会把输入框换掉，手指还在打就被打断
      if (role === 'searchkw') {
        RT.searchKw = t.value;
        const list = this.root.querySelector<HTMLElement>('[data-role="hitlist"]');
        if (list) list.innerHTML = searchResultsHtml(RT.searchKw, RT.searchScope);
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
    this.paint();
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
    el.style.left = `${pos.left}px`;
    el.style.top = `${pos.top}px`;
    el.style.transform = 'none';
  }

  /** 视口变化后的统一收口：锚点浮层重新贴字，贴底小卡避让键盘 */
  private syncPosition(): void {
    this.placeAnchored();
    const vv = window.visualViewport;
    if (!isMobileShell() || !vv) return;
    const lift = sheetLift({ innerHeight: window.innerHeight, visualHeight: vv.height });
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('.bzs-float.is-sheet'))) {
      el.style.setProperty('bottom', `calc(${10 + lift}px + env(safe-area-inset-bottom, 0px))`, 'important');
    }
  }

  private paint(): void {
    /* 重画前把激活码输入框的现值记下来（P2-08）：粘贴一枚长码 → 点「激活」→
       同步 paint() 按旧 entitlement 重建 DOM，输入框回到空——再点一次「激活」
       发出去的是空码。 */
    const keepLicense = this.root.querySelector<HTMLInputElement>('[data-role="license"]')?.value ?? '';
    this.setAccent(shellPrefs().accent);
    this.root.innerHTML = overlayHtml();
    if (keepLicense) {
      const box = this.root.querySelector<HTMLInputElement>('[data-role="license"]');
      if (box && !box.value) box.value = keepLicense;
    }
    /* 点遮罩空白关闭：判据交给 bindMaskDismiss（起点在遮罩 + 位移不超容差），
       在弹窗里选字拖到遮罩上松手不会再误关。每次重画都是新的遮罩元素。 */
    const scrim = this.root.querySelector<HTMLElement>('[data-role="scrim"]');
    if (scrim) bindMaskDismiss(scrim, () => closeOverlay());
    const o = getState().overlay;
    /* 先摆位再聚焦：聚焦可能让键盘立刻弹起，位置要在那之前是对的 */
    this.placeAnchored();
    if (o?.kind === 'search') {
      const input = this.root.querySelector<HTMLInputElement>('[data-role="searchkw"]');
      input?.focus();
      const len = input?.value.length ?? 0;
      input?.setSelectionRange(len, len);
    }
    if (o?.kind === 'ai' || o?.kind === 'translate') {
      void runAiForOverlay();
    } else {
      // 离开 AI 弹层就清掉「已请求过」的记号，下次打开同一段还要再问一次
      aiRequestedFor = '';
    }
    // 想法浮窗：打开就把光标放进输入框，少一次点击
    if (o?.kind === 'idea') this.root.querySelector<HTMLTextAreaElement>('[data-role="idea"]')?.focus();
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
  }

  destroy(): void {
    document.removeEventListener('pointerdown', this.onDocPointer, true);
    document.removeEventListener('keydown', this.onDocKey, true);
    for (const off of this.disposers) off();
    this.disposers = [];
    this.root.remove();
  }
}

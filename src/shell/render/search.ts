/* ============================================================
 * bz-reader · 搜索（shell/render/search.ts）
 *
 * 一份命中数据，两个出口、一套语汇（2026-11-16 检索台改版）：
 *   · 书架整页 viewSearch()：目录头 + 检索卡 + 空态 / 结果；
 *   · 阅读页弹窗 overlaySearch()：同一张检索卡压成紧凑版（is-compact）。
 *
 * 三个旧包袱在这一版里拆掉：
 *   1. 范围只有一份 state——书架默认全库、弹窗默认本书，各存一份
 *      （`searchScope` / `searchFloatScope`，见 state.ts）；
 *   2. 结果是一行行 12px 小字——按书成卡，卡头一枚书脊、卡内三类命中；
 *   3. 进度只有一行字——铜色进度块：翻到第几本、找到几处、正在读哪本。
 *
 * 空态的四张示例卡用**真实数据**：书名 / 章节取最近读的一本，划线 / 正文
 * 取全库最近一条标注。没有书或没有标注时退化成通用示例句，不留空。
 *
 * 正文命中仍是异步边到边追加（RT.body），所以整块结果必须能「扫描中重画」：
 * 进度块在上，已有书卡在下，两行骨架垫底。
 * ============================================================ */
import { t, type MsgKey } from '../../i18n';
import type { ReaderBook } from '../../data/schema';
import { can } from '../../data/entitlement';
import { marksOf } from '../domain';
import { highlightEscaped } from '../highlight';
import { cardVisible, searchHits, type SearchRow } from '../search-hits';
import { getState, searchScopeOf } from '../state';
import { allBooks, liveBooks } from '../source';
import { RT } from '../runtime';
import { semanticScopeFor, type SearchSurface } from '../search-semantic';
import { semanticResultsHtml, type SemanticView } from './semantic';
import { esc, ico } from './html';

/**
 * 搜索范围。
 *
 * 「本书」只在有当前书时有意义：书架页没有打开的书时，「本书」会给出
 * 「先打开一本书」的提示，而不是静默空结果（原 bug）。
 */
export type SearchScope = 'book' | 'all';

interface BookStats {
  books: number;
  marks: number;
}

function libStats(): BookStats {
  const books = liveBooks();
  return {
    books: books.length,
    marks: books.reduce((n, b) => n + (b.notes?.highlights?.length ?? 0), 0),
  };
}

function searchTargets(scope: SearchScope) {
  const state = getState();
  return (scope === 'book' ? liveBooks().filter((b) => b.id === state.bookId) : liveBooks()).map((b) => ({
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
}

/** 最近读的一本：空态示例卡的书名 / 章节从它来 */
function featureBook(): ReaderBook | null {
  const books = liveBooks();
  if (!books.length) return null;
  return books.reduce((a, b) =>
    (b.reading?.stats?.lastReadTime ?? 0) > (a.reading?.stats?.lastReadTime ?? 0) ? b : a,
  );
}

/** 最近在读：只列真正读过的，按 lastReadTime 倒序，最多两本 */
function recentBooks(limit = 2): ReaderBook[] {
  return liveBooks()
    .filter((b) => (b.reading?.stats?.lastReadTime ?? 0) > 0)
    .sort((a, b) => (b.reading?.stats?.lastReadTime ?? 0) - (a.reading?.stats?.lastReadTime ?? 0))
    .slice(0, limit);
}

/** 一本书里最近的一条标注（按 createdAt 倒序） */
function latestMarkOf(
  book: ReaderBook | null,
): { text: string; chapterTitle: string; at: number } | null {
  if (!book) return null;
  const list = book.notes?.highlights ?? [];
  let best: (typeof list)[number] | null = null;
  for (const h of list) {
    if (!best || (h.createdAt || 0) > (best.createdAt || 0)) best = h;
  }
  return best
    ? { text: best.text ?? '', chapterTitle: best.chapterTitle?.trim() ?? '', at: best.createdAt || 0 }
    : null;
}

/** 全库最近一条标注（跨书） */
function latestMark(): { book: ReaderBook; mark: { text: string; chapterTitle: string } } | null {
  let best: { book: ReaderBook; mark: { text: string; chapterTitle: string } } | null = null;
  let bestAt = -1;
  for (const book of liveBooks()) {
    const mark = latestMarkOf(book);
    if (!mark) continue;
    if (!best || mark.at >= bestAt) {
      best = { book, mark: { text: mark.text, chapterTitle: mark.chapterTitle } };
      bestAt = mark.at;
    }
  }
  return best;
}

/** 当前打开的是哪本书（弹窗头与「本书」范围的结果归属用） */
function currentBookTitle(): string {
  const id = getState().bookId;
  if (!id) return '';
  return liveBooks().find((b) => b.id === id)?.meta.title ?? '';
}

/** 截断成一行的示例文本 */
function clip(text: string, n: number): string {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

/** 把数字包成衬线粗体再塞进译文：文案里的 {n} 由语言包决定位置 */
function figure(key: MsgKey, n: number): string {
  return t(key, { n: `<b>${Math.max(0, Math.floor(n))}</b>` });
}

/** 分布条 / 书脊的色阶：第 1 本最深，第 3 本起最浅 */
function tone(index: number): string {
  if (index <= 0) return 'var(--copper)';
  if (index === 1) return 'var(--copper-2)';
  return 'var(--copper-3)';
}

/* ─────────── 检索卡 ─────────── */

/**
 * 检索卡本体：输入行 + 回车提示 + 字面/按意思。
 *
 * 整页与弹窗共用。弹窗靠 `.bzs-srchpanel.is-compact` 覆盖尺寸（见 overlay.css），
 * 这里不写第二套结构。
 *
 * 2026-11-17 起**不再给范围开关**：书架整页固定全库、阅读弹窗固定本书
 * （判据在 `state.searchScopeOf`）。少一行 chips，输入行也更宽。
 */
export function searchDeskHtml(surface: SearchSurface = 'shelf'): string {
  const { searchKw, searchMode } = getState();
  const semantic = searchMode === 'semantic';
  const ph = semantic ? t('search.semantic.ph') : t('search.ph');
  const hasKw = !!searchKw.trim();
  /* 基础版没有全库正文搜索：正文一条都不扫，不给一句说明会被当成「搜完了」。 */
  const locked =
    surface === 'shelf' && !can('crossSearch')
      ? `<span class="bzs-srch-lock">${esc(t('search.scope.allLocked'))}</span>`
      : '';
  /* 清空键一直渲染、只切 hidden：输入时宿主只换命中列表，不重画检索卡，
     按「有词才渲染」会在整轮输入里都看不到这枚 ×（真机第一版）。 */
  const clear = `<button type="button" class="bzs-desk-clear" data-act="searchclear"${hasKw ? '' : ' hidden'}><span class="bzs-sr-only">${esc(
    t('search.clear'),
  )}</span>×</button>`;
  return `<div class="bzs-desk">
    <div class="bzs-desk-in">
      <span class="bzs-desk-mag">${ico('search')}</span>
      <input class="bzs-desk-input" data-role="searchkw" spellcheck="false" autocomplete="off" placeholder="${esc(
        ph,
      )}" value="${esc(searchKw)}">
      ${clear}
    </div>
    <div class="bzs-desk-foot">
      ${locked}
      <span class="bzs-srch-sp"></span>
      <span class="bzs-srch-enter"><kbd>↵</kbd>${esc(t('search.enter'))}</span>
      <div class="bzs-srch-modes">
        <button type="button" class="${semantic ? '' : 'on'}" data-act="searchmode" data-v="literal">${esc(
          t('search.mode.literal'),
        )}</button>
        <button type="button" class="${semantic ? 'on' : ''}" data-act="searchmode" data-v="semantic">${esc(
          t('search.mode.semantic'),
        )}</button>
      </div>
    </div>
  </div>`;
}

/** 旧名字：表单与检索卡是同一块，测试和旧调用点还认它 */
export function searchFormHtml(surface: SearchSurface = 'shelf'): string {
  return searchDeskHtml(surface);
}

/* ─────────── 空态 ─────────── */

function emptyStateHtml(surface: SearchSurface): string {
  const recent = recentBooks(2);
  const feature = featureBook();
  const featureMark = latestMarkOf(feature);
  const latest = latestMark();

  const bookTitle = feature?.meta.title?.trim() ?? '';
  const chapter =
    feature?.reading?.position?.chapterTitle?.trim() || featureMark?.chapterTitle || '';
  const markText = latest?.mark.text?.trim() ?? '';
  const markShort = clip(markText, 18);
  /* 正文卡的示例：最近那条标注的章节名，其次它所在的书名 */
  const bodyDemo = latest?.mark.chapterTitle || latest?.book.meta.title?.trim() || chapter || bookTitle;

  const cards: Array<{ k: MsgKey; v: string; hint: MsgKey; kw: string }> = [
    {
      k: 'search.what.book',
      v: bookTitle ? t('search.what.bookValue', { title: bookTitle }) : t('search.what.bookDemo'),
      hint: 'search.what.bookHint',
      kw: bookTitle,
    },
    {
      k: 'search.what.chapter',
      v: chapter || t('search.what.chapterDemo'),
      hint: 'search.what.chapterHint',
      kw: chapter,
    },
    {
      k: 'search.what.mark',
      v: markShort ? t('search.what.quote', { text: markShort }) : t('search.what.markDemo'),
      hint: 'search.what.markHint',
      kw: markText.slice(0, 12),
    },
    {
      k: 'search.what.body',
      v: bodyDemo ? t('search.what.quote', { text: bodyDemo }) : t('search.what.bodyDemo'),
      hint: 'search.what.bodyHint',
      kw: bodyDemo,
    },
  ];

  const cardsHtml = cards
    .map((c) => {
      const attrs = c.kw.trim() ? ` data-act="searchfill" data-kw="${esc(c.kw.trim())}"` : ' disabled';
      return `<button type="button" class="bzs-srch-wcard"${attrs}>
        <span class="bzs-srch-wk">${esc(t(c.k))}</span>
        <span class="bzs-srch-wv">${esc(c.v)}</span>
        ${surface === 'shelf' ? `<span class="bzs-srch-wn">${esc(t(c.hint))}</span>` : ''}
        <span class="bzs-srch-wgo">↗</span>
      </button>`;
    })
    .join('');

  const what = `<div class="bzs-srch-what">
    <div class="bzs-srch-wh"><span class="bzs-srch-kick">${esc(t('search.what'))}</span><span class="bzs-srch-rule"></span></div>
    <div class="bzs-srch-wgrid">${cardsHtml}</div>
  </div>`;

  const reading =
    surface === 'shelf' && recent.length
      ? `<div class="bzs-srch-reading">
      <div class="bzs-srch-wh"><span class="bzs-srch-kick">${esc(t('search.recentReading'))}</span><span class="bzs-srch-rule"></span></div>
      ${recent
        .map((b) => {
          const pct = Math.max(0, Math.min(100, Math.round((b.reading?.position?.percent ?? 0) * 100)));
          return `<button type="button" class="bzs-srch-rrow" data-act="searchfill" data-kw="${esc(b.meta.title)}">
          <span class="bzs-srch-rspine"></span>
          <b>${esc(b.meta.title)}</b>
          <span class="bzs-srch-rloc">${esc(b.reading?.position?.chapterTitle ?? '')}</span>
          <span class="bzs-srch-rbar"><i style="width:${pct}%"></i></span>
          <span class="bzs-srch-rpct">${pct}%</span>
        </button>`;
        })
        .join('')}
    </div>`
      : '';

  return `${what}${reading}`;
}

/* ─────────── 结果 ─────────── */

function rowTag(r: SearchRow): { text: string; cls: string } {
  if (r.kind === 'book') return { text: t('search.kind.title'), cls: 'is-book' };
  if (r.via === 'comment') return { text: t('search.kind.idea'), cls: 'is-idea' };
  if (r.via === 'chapter') return { text: t('search.kind.chapter'), cls: 'is-chapter' };
  if (r.kind === 'body') return { text: t('search.kind.body'), cls: 'is-body' };
  return { text: t('search.kind.highlight'), cls: 'is-mark' };
}

function hitRowHtml(r: SearchRow, kw: string): string {
  const tag = rowTag(r);
  const loc = r.kind === 'book' || r.via === 'chapter' ? '' : r.label.trim();
  const attrs =
    r.kind === 'book'
      ? ` data-act="openbook" data-id="${esc(r.bookId)}"`
      : r.kind === 'body'
        ? ` data-act="hittotext" data-cfi="${esc(r.cfi ?? '')}" data-book="${esc(r.bookId)}"`
        : ` data-act="jumpmark" data-id="${esc(r.id)}" data-book="${esc(r.bookId)}"`;
  const go = r.kind === 'body' ? '<span class="bzs-srch-go">↗</span>' : '<span></span>';
  return `<div class="bzs-srch-hit ${tag.cls}" role="button" tabindex="0"${attrs}>
    <span class="bzs-srch-tag">${esc(tag.text)}</span>
    <span class="bzs-srch-tx">${highlightEscaped(r.text, kw)}</span>
    <span class="bzs-srch-loc">${esc(loc)}</span>
    ${go}
  </div>`;
}

interface GroupView {
  bookId: string;
  title: string;
  author: string;
  rows: SearchRow[];
}

function bookCardHtml(group: GroupView, kw: string, index: number, surface: SearchSurface): string {
  const total = group.rows.length;
  const base = surface === 'book' ? 6 : 3;
  const more = RT.body.more[`${kw}\u0001${group.bookId}`] ?? 0;
  const visible = cardVisible(total, more, base);
  const hidden = total - visible;
  const rows = group.rows.slice(0, visible).map((r) => hitRowHtml(r, kw)).join('');
  const moreBtn = hidden
    ? `<button type="button" class="bzs-srch-more" data-act="searchmore" data-book="${esc(
        group.bookId,
      )}">${esc(t('search.more', { n: hidden }))}</button>`
    : '';
  const author = group.author.trim();
  return `<section class="bzs-srch-book">
    <div class="bzs-srch-bhead">
      <span class="bzs-srch-spine" style="--tone:${tone(index)}"></span>
      <div class="bzs-srch-bt"><b>${esc(group.title)}</b>${author ? `<span>${esc(author)}</span>` : ''}</div>
      <span class="bzs-srch-cnt">${esc(t('search.count.hits', { n: total }))}</span>
      <button type="button" class="bzs-srch-open" data-act="openbook" data-id="${esc(
        group.bookId,
      )}">${esc(t('search.open'))} ↗</button>
    </div>
    <div class="bzs-srch-rows">${rows}${moreBtn}</div>
  </section>`;
}

function distHtml(groups: GroupView[]): string {
  if (groups.length < 2) return '';
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const bars = groups
    .map(
      (g, i) =>
        `<i class="bzs-srch-distseg" style="flex:${g.rows.length};--tone:${tone(i)}"></i>`,
    )
    .join('');
  const legend = groups
    .map(
      (g, i) =>
        `<span class="bzs-srch-distitem" style="--tone:${tone(i)}"><em></em>${esc(g.title)} <b>${
          g.rows.length
        }</b></span>`,
    )
    .join('');
  return `<div class="bzs-srch-dist">
    <div class="bzs-srch-distbar">${bars}</div>
    <div class="bzs-srch-distlegend">${legend}<span class="bzs-srch-disttotal">${esc(
      t('search.dist.total', { n: total }),
    )}</span></div>
  </div>`;
}

function sumHtml(hits: number, groups: number, scope: SearchScope): string {
  const second =
    scope === 'book'
      ? esc(t('search.sum.book', { title: currentBookTitle() || '—' }))
      : figure('search.sum.books', groups);
  return `<div class="bzs-srch-sum">${figure('search.sum.hits', hits)}<span class="bzs-srch-sep">·</span>${second}
    <button type="button" class="bzs-srch-clr" data-act="searchclear">${esc(t('search.clear'))}</button>
  </div>`;
}

function failedHtml(): string {
  return RT.body.failed
    .map((f) => `<div class="bzs-srch-fail">${esc(t('search.failed.one', { title: f.title }))}</div>`)
    .join('');
}

/** 正文逐本扫描的进度块 */
function progressHtml(): string {
  const b = RT.body;
  if (!b.running && !b.stopped) return '';
  const pct = b.total ? Math.max(0, Math.min(100, Math.round((b.done / b.total) * 100))) : 0;
  const bar = `<div class="bzs-srch-progbar"><i style="width:${pct}%"></i></div>`;
  if (b.stopped && !b.running) {
    return `<div class="bzs-srch-prog is-stopped">
      <div class="bzs-srch-prog-t">${esc(t('search.body.stopped', { done: b.done, total: b.total }))}</div>
      ${bar}
    </div>`;
  }
  const title = RT.body.scanTitle.trim();
  const reading = title
    ? `<div class="bzs-srch-progsub">${t('search.scan.reading', {
        title: esc(title),
        chapter: '',
      })}</div>`
    : '';
  return `<div class="bzs-srch-prog">
    <div class="bzs-srch-prog-t">${t('search.scan.head', {
      done: `<b>${b.done}</b>`,
      total: `<span class="bzs-srch-prog-of">${b.total}</span>`,
    })}<span class="bzs-srch-sep">·</span>${t('search.scan.found', {
      n: `<span class="bzs-srch-prog-n">${b.hits.length}</span>`,
    })}<button type="button" class="bzs-srch-stop" data-act="searchstop">${esc(
      t('search.body.stop'),
    )}</button></div>
    ${bar}
    ${reading}
  </div>`;
}

/** 扫描中垫在结果下面的两行骨架：一眼看出还在长 */
function ghostHtml(): string {
  return `<section class="bzs-srch-book is-ghost">
    <div class="bzs-srch-bhead"><span class="bzs-srch-spine" style="--tone:var(--line-2)"></span><div class="bzs-srch-bt"><b>${esc(
      t('search.scan.ghost'),
    )}</b></div></div>
    <div class="bzs-srch-rows">
      <div class="bzs-srch-ghost"><i></i><i></i><i></i></div>
      <div class="bzs-srch-ghost"><i></i><i></i><i></i></div>
    </div>
  </section>`;
}

function missHtml(kw: string, failed: boolean): string {
  const reason = failed ? t('search.noHitRest', { kw }) : t('search.noHit', { kw });
  return `<div class="bzs-srch-miss">
    <div class="bzs-srch-mark">“</div>
    <h3>${esc(reason)}</h3>
    <p>${esc(t('search.miss.lead'))}</p>
    <div class="bzs-srch-acts">
      <button type="button" class="is-pri" data-act="searchmode" data-v="semantic">${esc(
        t('search.miss.semantic', { kw }),
      )}</button>
      <button type="button" data-act="searchclear">${esc(t('search.clear'))}</button>
    </div>
  </div>`;
}

/**
 * 搜索表单 + 结果（整页与弹窗共用）。
 *
 * `scope` 保留在签名里兼容旧调用；真正的范围按出口归一（`searchScopeOf`）：
 * 书架整页全库、阅读弹窗本书。传进来的值只影响不了结果——旧状态残留
 * 「弹窗按全库」时真机上就出过「书内入口挂着全库正文结果」。
 */
export function searchResultsHtml(
  kw: string,
  _scope: SearchScope,
  surface: SearchSurface = 'shelf',
): string {
  const scope = searchScopeOf(surface);
  const q = kw.trim();
  const state = getState();
  if (state.searchMode === 'semantic') {
    const s = RT.semantic;
    /* 输入框里已经是新词、语义结果还停在旧词，或者这一轮是另一个入口搜的
       （书架搜全库 / 书内只搜当前书），或者书内入口已经换了书：都按
       「还没搜」处理，不要把别处的旧结果挂在这个入口下面。 */
    const sameBook = surface !== 'book' || s.bookId === String(state.bookId ?? '');
    const fresh = s.kw === q && s.scope === semanticScopeFor(surface) && sameBook;
    const view: SemanticView = {
      kw: q,
      running: s.running && fresh,
      ran: s.ran && fresh,
      hits: fresh ? s.hits : [],
      problem: fresh ? s.problem : null,
      books: fresh ? s.books : 0,
    };
    if (!q) return emptyStateHtml(surface);
    /* 语义命中可能来自「移出书架」但没删的书：画像还在，结果就该能点开。
       与命令面板的按意思搜同一口径（全库、只排除失联文件）。 */
    const semanticBooks = allBooks().filter(
      (b) => !(b.fileRef as { fileMissing?: boolean } | undefined)?.fileMissing,
    );
    return semanticResultsHtml(view, semanticBooks, surface, !!state.bookId);
  }
  if (!q) return emptyStateHtml(surface);
  if (scope === 'book' && !state.bookId) {
    return `<div class="bzs-empty">${esc(t('search.needBook'))}</div>`;
  }

  /* 快结果：同步算，立刻画 */
  const { groups } = searchHits(searchTargets(scope), q);
  const merged: GroupView[] = groups.map((g) => ({
    bookId: g.bookId,
    title: g.title,
    author: liveBooks().find((b) => b.id === g.bookId)?.meta.author ?? '',
    rows: g.rows.slice(),
  }));
  const byBook = new Map(merged.map((g) => [g.bookId, g]));

  /* 正文命中：异步边到边追加。词对不上说明是上一轮的残留，不画 */
  const bodyHits = RT.body.kw === q ? RT.body.hits : [];
  for (const h of bodyHits) {
    let g = byBook.get(h.bookId);
    if (!g) {
      g = {
        bookId: h.bookId,
        title: h.bookTitle,
        author: liveBooks().find((b) => b.id === h.bookId)?.meta.author ?? '',
        rows: [],
      };
      merged.push(g);
      byBook.set(h.bookId, g);
    }
    g.rows.push({
      kind: 'body',
      bookId: h.bookId,
      id: '',
      label: h.chapterLabel,
      text: h.excerpt,
      via: 'body',
      cfi: h.cfi,
    });
  }

  /* 命中最多的书排前面：分布条的深浅顺序与书卡顺序必须是同一个 */
  const books = merged.filter((g) => g.rows.length).sort((a, b) => b.rows.length - a.rows.length);
  const hits = books.reduce((n, g) => n + g.rows.length, 0);
  const progress = progressHtml();
  const fails = failedHtml();
  const cards = books.map((g, i) => bookCardHtml(g, q, i, surface)).join('');

  if (!hits) {
    if (RT.body.running) {
      return `${progress}${fails}<div class="bzs-empty">${esc(t('search.body.finding', { kw: q }))}</div>${ghostHtml()}`;
    }
    /* 有书没搜成时不能说「没有找到」——用户会以为整库都搜过了 */
    return `${progress}${fails}${missHtml(q, RT.body.failed.length > 0)}`;
  }

  /* 扫描中先只给进度和已有结果：这一屏的「总数」还在变，统计行会跳 */
  if (RT.body.running) return `${progress}${fails}${cards}${ghostHtml()}`;
  return `${progress}${sumHtml(hits, books.length, scope)}${distHtml(books)}${fails}${cards}`;
}

/**
 * 书架整页搜索。
 *
 * 结构只有三段：目录头（搜索 / 本书数·划线数）、检索卡、结果区。
 * 没有「搜索」按钮——边打边出，与弹窗版一致。
 */
export function viewSearch(): string {
  const { searchKw } = getState();
  const scope = searchScopeOf('shelf');
  const stats = libStats();
  return `<div class="bzs-searchpage">
    <div class="bzs-srch-head"><h2>${esc(t('shelf.act.search'))}</h2><p>${esc(
      t('search.head.stats', { books: stats.books, marks: stats.marks }),
    )}</p><span class="bzs-srch-rule"></span></div>
    ${searchDeskHtml('shelf')}
    <div class="bzs-hits" data-role="hitlist">${searchResultsHtml(searchKw, scope, 'shelf')}</div>
  </div>`;
}

/* ============================================================
 * bz-reader · 搜索（shell/render/search.ts）
 *
 * 一份命中列表，两个出口：
 *   · 书架整页（S1 定稿：搜索不再走浮层；2026-11-08 起和书库共用同一条头栏，
 *     当前那颗搜索图标亮着，再点一次回去）
 *   · 阅读页右上那颗浮层（书内 / 全库 / 正文，边读边搜）
 *
 * 两个出口共用同一个表单与同一个结果渲染，避免「同一件事长两副样子」。
 * 状态只有一份：ShellState.searchKw / searchScope，切页不丢词。
 * ============================================================ */
import { marksOf } from '../domain';
import { searchHits } from '../search-hits';
import { getState } from '../state';
import { getShellSource, liveBooks } from '../source';
import { RT } from '../runtime';
import { esc, MAG } from './html';

/**
 * 搜索范围。
 *
 * 「本书」只在阅读页有意义——书架没有当前书，进去时默认全库；
 * 若用户上次在阅读页选了「本书」，回到书架会搜不到东西，所以
 * 书架打开搜索时强制切到 all（见 actions.ts 的 study 分支）。
 *
 * 「正文」是 review-1104 加的口径：搜的是当前这一本的正文，
 * 命中带 CFI，点一条直接跳过去（见 view/reader-view.ts 的 searchText）。
 */
export type SearchScope = 'book' | 'all' | 'text';

const SCOPES: Array<{ value: Exclude<SearchScope, 'text'> | 'text'; label: string }> = [
  { value: 'book', label: '本书' },
  { value: 'all', label: '全库' },
  { value: 'text', label: '正文' },
];

function searchTargets(scope: 'book' | 'all') {
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

export function searchResultsHtml(kw: string, scope: SearchScope): string {
  /* 正文搜索（新功能「书内搜索的命中定位」）：以前只能搜「已建索引」的
     书名/作者/标注，正文里的字搜不到；跨书搜索又只列文字、点了不跳。
     现在搜到就列出来，点一条直接跳到那一页。 */
  if (scope === 'text') {
    if (!kw.trim()) return `<div class="bzs-empty">输入关键词，点「搜正文」。</div>`;
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
  if (!kw.trim()) return `<div class="bzs-empty">输入关键词。想搜正文全文，切到「正文」范围。</div>`;
  const { groups, total } = searchHits(searchTargets(scope), kw);
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

/** 搜索表单本体：输入框 + 范围切换。整页与浮层共用 */
export function searchFormHtml(): string {
  const { searchKw, searchScope } = getState();
  const books = liveBooks().length;
  return `<div class="bzs-search-in">${MAG}
      <input data-role="searchkw" placeholder="搜书名、作者、章节名或标注里的字…" value="${esc(searchKw)}"></div>
    <div class="bzs-searchbar">
      ${SCOPES.map(
        (s) =>
          `<button class="bzs-chip${searchScope === s.value ? ' on' : ''}" data-act="searchscope" data-v="${s.value}">${
            s.value === 'all' ? `${s.label} · ${books} 本` : s.label
          }</button>`,
      ).join('')}
      <button class="bzs-btn sm" data-act="searchtext">搜正文</button>
      <span class="bzs-mini">${
        searchScope === 'text' ? '搜这一本的正文，点结果跳到那一页' : '搜的是已建索引的内容：书名、作者、标注与想法'
      }</span>
    </div>`;
}

/**
 * 书架整页搜索。
 *
 * 结构只有两段：表单贴在顶部（书架页宽，输入框能吃满一行），
 * 结果在下面滚动。没有「搜索」按钮——边打边出，与浮层版一致。
 */
export function viewSearch(): string {
  const { searchKw, searchScope } = getState();
  return `<div class="bzs-searchpage">
    ${searchFormHtml()}
    <div class="bzs-hits" data-role="hitlist">${searchResultsHtml(searchKw, searchScope)}</div>
  </div>`;
}

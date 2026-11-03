/* ============================================================
 * bz-reader · 搜索（shell/render/search.ts）
 *
 * 一份命中列表，两个出口：
 *   · 书架整页（S1 定稿：搜索不再走浮层，头栏换成「← 返回 + 标题」）
 *   · 阅读页右上那颗浮层（书内 / 全库，边读边搜）
 *
 * 两个出口共用同一个表单与同一个结果渲染，避免「同一件事长两副样子」。
 * 状态只有一份：ShellState.searchKw / searchScope，切页不丢词。
 * ============================================================ */
import { marksOf } from '../domain';
import { searchHits } from '../search-hits';
import { getState } from '../state';
import { liveBooks } from '../source';
import { esc, MAG } from './html';

/**
 * 搜索范围。
 *
 * 「本书」只在阅读页有意义——书架没有当前书，进去时默认全库；
 * 若用户上次在阅读页选了「本书」，回到书架会搜不到东西，所以
 * 书架打开搜索时强制切到 all（见 actions.ts 的 study 分支）。
 */
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

export function searchResultsHtml(kw: string, scope: 'book' | 'all'): string {
  if (!kw.trim()) return `<div class="bzs-empty">输入关键词。想搜正文全文，用 Obsidian 自带的全文搜索更快。</div>`;
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
      <button class="bzs-chip${searchScope === 'book' ? ' on' : ''}" data-act="searchscope" data-v="book">本书</button>
      <button class="bzs-chip${searchScope === 'all' ? ' on' : ''}" data-act="searchscope" data-v="all">全库 · ${books} 本</button>
      <span class="bzs-mini">搜的是已建索引的内容：书名、作者、标注与想法</span>
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

/* ============================================================
 * bz-reader · 搜索（shell/render/search.ts）
 *
 * 一份命中列表，两个出口：
 *   · 书架整页（S1 定稿：搜索不再走浮层；2026-11-08 起和书库共用同一条头栏，
 *     当前那颗搜索图标亮着，再点一次回去）
 *   · 阅读页右上那颗浮层（本书 / 全库，边读边搜）
 *
 * 两个出口共用同一个表单与同一个结果渲染，避免「同一件事长两副样子」。
 * 状态只有一份：ShellState.searchKw / searchScope，切页不丢词。
 *
 * 2026-11-08（fix/search-body）：
 *   · 去掉「正文」范围与「搜正文」按钮——正文已并入本书 / 全库；
 *   · 正文命中异步到达（RT.body），先出书名/作者/章节名/标注的快结果；
 *   · 关键词在结果里高亮，想法命中显示想法本身；
 *   · 文案全部走 i18n（新增的 17 条，见 src/i18n/zh.ts 的 search.* 段）。
 * ============================================================ */
import { t } from '../../i18n';
import { marksOf } from '../domain';
import { highlightEscaped } from '../highlight';
import { searchHits, type SearchRow } from '../search-hits';
import { getState } from '../state';
import { liveBooks } from '../source';
import { RT } from '../runtime';
import { esc, MAG } from './html';

/**
 * 搜索范围。
 *
 * 「本书」只在有当前书时有意义：书架页没有打开的书时，「本书」会给出
 * 「先打开一本书」的提示，而不是静默空结果（原 bug）。
 */
export type SearchScope = 'book' | 'all';

const SCOPES: Array<{ value: SearchScope; key: 'search.scope.book' | 'search.scope.all' }> = [
  { value: 'book', key: 'search.scope.book' },
  { value: 'all', key: 'search.scope.all' },
];

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

/** 行首小字：说清楚这一行为什么命中 */
function rowTag(r: SearchRow): string {
  if (r.kind === 'book') return t('search.kind.book');
  if (r.kind === 'body') return r.label.trim() || t('search.kind.body');
  if (r.via === 'comment') return t('search.kind.idea');
  if (r.via === 'chapter') return t('search.kind.chapter');
  return r.label.trim() || t('search.kind.mark');
}

/**
 * 一条命中。
 *
 * 2026-11-09：外层从 `<button>` 换成 `<div role="button" tabindex="0">`。
 * iOS 的 WebKit 对「多行内容的按钮」渲染有 bug（WebKit 219372 ：内容被裁成
 * 单行，或行与行叠在一起）——真机上整页结果糊成一片正是这个。div 照旧能
 * 拿到 `[data-act]` 的点击委托，键盘可达性由书架页的 keydown 委托负责。
 */
function rowHtml(r: SearchRow, kw: string): string {
  const tag = `<span class="loc">${esc(rowTag(r))}</span>`;
  const body = highlightEscaped(r.text, kw);
  const open = 'class="bzs-hit" role="button" tabindex="0"';
  if (r.kind === 'book') {
    return `<div ${open} data-act="openbook" data-id="${esc(r.bookId)}">${tag}${body}</div>`;
  }
  if (r.kind === 'body') {
    return `<div ${open} data-act="hittotext" data-cfi="${esc(r.cfi ?? '')}" data-book="${esc(r.bookId)}">${tag}${body}</div>`;
  }
  return `<div ${open} data-act="jumpmark" data-id="${esc(r.id)}" data-book="${esc(r.bookId)}">${tag}${body}</div>`;
}

/** 正文搜索的进度 / 停止行 */
function progressHtml(): string {
  const b = RT.body;
  if (b.noBook || !b.running) {
    if (b.stopped) {
      return `<div class="bzs-srch-prog"><span>${t('search.body.stopped', { done: b.done, total: b.total })}</span></div>`;
    }
    return '';
  }
  return `<div class="bzs-srch-prog"><span>${t('search.body.searching', {
    done: b.done,
    total: b.total,
    n: b.hits.length,
  })}</span><button class="bzs-btn sm" data-act="searchstop">${t('search.body.stop')}</button></div>`;
}

export function searchResultsHtml(kw: string, scope: SearchScope): string {
  const q = kw.trim();
  if (!q) return `<div class="bzs-empty">${t('search.empty')}</div>`;
  if (scope === 'book' && !getState().bookId) {
    return `<div class="bzs-empty">${t('search.needBook')}</div>`;
  }

  /* 快结果：同步算，立刻画 */
  const { groups } = searchHits(searchTargets(scope), q);
  const merged = groups.map((g) => ({ bookId: g.bookId, title: g.title, rows: g.rows.slice(), total: g.total }));
  const byBook = new Map(merged.map((g) => [g.bookId, g]));

  /* 正文命中：异步边到边追加。词对不上说明是上一轮的残留，不画 */
  const bodyHits = RT.body.kw === q ? RT.body.hits : [];
  for (const h of bodyHits) {
    let g = byBook.get(h.bookId);
    if (!g) {
      g = { bookId: h.bookId, title: h.bookTitle, rows: [], total: 0 };
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
    g.total += 1;
  }

  const hits = merged.reduce((n, g) => n + g.total, 0);
  const progress = progressHtml();
  const heads = merged
    .filter((g) => g.rows.length)
    .map(
      (g) =>
        `<div class="bzs-hitgroup">${esc(t('search.group', { title: g.title, n: g.total }))}</div>${g.rows
          .map((r) => rowHtml(r, q))
          .join('')}`,
    )
    .join('');

  if (!hits) {
    if (RT.body.noBook) return `<div class="bzs-empty">${t('search.needBook')}</div>`;
    if (RT.body.running) return `${progress}<div class="bzs-empty">${t('search.body.finding', { kw: q })}</div>`;
    return `${progress}<div class="bzs-empty">${t('search.noHit', { kw: q })}</div>`;
  }
  return `${progress}${heads}`;
}

/** 搜索表单本体：输入框 + 范围切换。整页与浮层共用 */
export function searchFormHtml(): string {
  const { searchKw, searchScope } = getState();
  const books = liveBooks().length;
  return `<div class="bzs-search-in">${MAG}
      <input data-role="searchkw" placeholder="${esc(t('search.ph'))}" value="${esc(searchKw)}">${
        searchKw.trim()
          ? `<button class="bzs-srch-clear" data-act="searchclear" title="${esc(t('search.clear'))}" aria-label="${esc(
              t('search.clear'),
            )}">×</button>`
          : ''
      }</div>
    <div class="bzs-searchbar">
      ${SCOPES.map(
        (s) =>
          `<button class="bzs-chip${searchScope === s.value ? ' on' : ''}" data-act="searchscope" data-v="${s.value}">${
            s.value === 'all' ? esc(t('search.scope.allCount', { n: books })) : esc(t(s.key))
          }</button>`,
      ).join('')}
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

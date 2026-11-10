/* ============================================================
 * bz-reader · 按意思搜全库（ui/semantic-panel.ts）
 *
 * 跨书语义搜索的入口面板（2026-11-10）。与跨书全文搜索共用同一套外壳样式
 * （`bzr-xs-*`），但底下不是引擎：一次嵌入请求 + 每本画像的余弦。
 *
 * 三条体验取舍：
 *   · 回车才搜：一次嵌入要钱，边打字边搜等于每敲一个字扣一次费；
 *   · 结果按书分组：用户要的是「哪几本书讲过」，不是一长串散块；
 *   · 点一条跳原文：画像没有 CFI，落到书里后再用这一段的开头在书内搜一次
 *     ——定位交给已有的全文搜索，不另造一套坐标。
 * ============================================================ */
import type { App } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import { semanticSearch, type SemanticHit } from '../data/book-search';
import { clear, el } from './dom';
import { uiModal } from '../core/ui/modal';
import { t } from '../i18n';

export interface SemanticSearchDeps {
  app: App;
  books: ReaderBook[];
  /** 点一条命中：打开那本书并尽量落到这一段 */
  onJump: (book: ReaderBook, hit: SemanticHit) => void;
}

/** 结果行里最多露多少字：够认出是哪一段，又不至于把面板撑成阅读器 */
const ROW_CHARS = 90;

export function openSemanticSearch(deps: SemanticSearchDeps): void {
  const root = el('div', 'bzr-xs bzr-sem');
  const bar = el('div', 'bzr-xs-bar');
  const input = el('input');
  input.type = 'search';
  input.placeholder = t('search.semantic.ph');
  const go = el('button', 'bzr-btn is-primary', t('search.semantic.go'));
  go.type = 'button';
  bar.append(input, go);

  const status = el('div', 'bzr-xs-status', t('search.semantic.hint'));
  const hits = el('div', 'bzr-xs-hits');
  root.append(bar, status, hits);

  let seq = 0;
  let running = false;

  function rowText(chunk: string): string {
    const flat = String(chunk ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    return flat.length > ROW_CHARS ? `${flat.slice(0, ROW_CHARS)}…` : flat;
  }

  async function run(): Promise<void> {
    const q = input.value.trim();
    if (!q || running) return;
    const my = ++seq;
    running = true;
    go.disabled = true;
    clear(hits);
    status.textContent = t('search.semantic.searching');

    const res = await semanticSearch(deps.app, q);
    if (my !== seq) return;
    running = false;
    go.disabled = false;

    if (res.problem) {
      status.textContent = res.problem;
      return;
    }
    if (!res.hits.length) {
      status.textContent = t('search.semantic.empty', { n: res.books });
      return;
    }
    status.textContent = t('search.semantic.found', { n: res.hits.length, books: res.books });

    /* 按书分组：接口已按分数排好，这里只把同书的归到一起，不重排 */
    const byBook = new Map<string, SemanticHit[]>();
    for (const hit of res.hits) {
      const list = byBook.get(hit.bookId) ?? [];
      list.push(hit);
      byBook.set(hit.bookId, list);
    }
    for (const [bookId, list] of byBook) {
      const book = deps.books.find((b) => b.id === bookId);
      const group = el('div', 'bzr-xs-group');
      const title = book?.meta.title || list[0]?.title || t('common.untitled');
      group.appendChild(el('span', 'bzr-xs-group-t', title));
      for (const hit of list) {
        const row = el('div', 'bzr-xs-hit');
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        if (hit.chapter) row.appendChild(el('span', 'bzr-xs-loc', hit.chapter));
        row.appendChild(document.createTextNode(rowText(hit.chunk)));
        const jump = (): void => {
          if (!book) return;
          close();
          deps.onJump(book, hit);
        };
        row.addEventListener('click', jump);
        row.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          jump();
        });
        group.appendChild(row);
      }
      hits.appendChild(group);
    }
  }

  go.addEventListener('click', () => void run());
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void run();
  });

  const { close } = uiModal({
    content: root,
    className: 'bzr-xs-popup',
    title: t('search.semantic.title'),
    head: true,
    maxWidth: 560,
    autofocus: false,
    onClose: () => {
      seq += 1;
    },
  });
  window.setTimeout(() => input.focus(), 0);
}

/* ============================================================
 * bz-reader · 书架（ui/shelf.ts）
 *
 * 全屏弹窗，网格陈列 vault 里认得的所有书。不复制、不搬移文件——
 * 书放在哪就留在哪，我们只记路径与进度。
 *
 * 数据流：开弹窗 → 扫 vault → 与仓储合并（新书入库、缺失的标灰）→ 渲染。
 * 扫描是「读文件列表」，不读内容，几千个文件也不卡。
 * ============================================================ */
import type { App } from 'obsidian';
import type { BookFormat, ReaderBook } from '../data/schema';
import { BookRepo, formatOf, scanVault, titleFromPath } from '../data/book-repo';
import type { ReaderStore } from '../data/store';
import { uiModal } from '../core/ui/modal';
import { clear, el, percentLabel } from './dom';

export interface ShelfDeps {
  app: App;
  repo: BookRepo;
  store: ReaderStore;
  formats: BookFormat[];
  onOpen: (book: ReaderBook) => void;
}

export interface ShelfHandle {
  close: () => void;
  refresh: () => void;
}

export function openShelf(deps: ShelfDeps): ShelfHandle {
  const { app, repo, store, formats, onOpen } = deps;

  const root = el('div', 'bzr-shelf');
  const head = el('div', 'bzr-shelf-head');
  const title = el('div', 'bzr-shelf-title', '书库');
  const count = el('span', 'bzr-shelf-count', '');
  const search = el('input', 'bzr-shelf-search');
  search.type = 'search';
  search.placeholder = '搜索书名';
  const spacer = el('div', 'bzr-shelf-spacer');
  head.append(title, count, spacer, search);

  const body = el('div', 'bzr-shelf-body');
  root.append(head, body);

  const { popup, close } = uiModal({
    content: root,
    className: 'bzr-shelf-popup',
    maxWidth: 1120,
    autofocus: false,
    onClose: () => {
      void store.flush();
    },
  });

  let keyword = '';

  function syncFromVault(): void {
    const files = scanVault(app, formats);
    const existing = new Set(files.map((f) => f.path));
    for (const f of files) {
      const fmt = formatOf(f.path) as BookFormat;
      repo.ensure(f.path, fmt, f.size);
    }
    repo.markMissing(existing);
    store.touch();
  }

  function render(): void {
    clear(body);
    const all = repo.recent();
    const list = keyword
      ? all.filter((b) => b.meta.title.toLowerCase().includes(keyword) || b.fileRef.vaultPath.toLowerCase().includes(keyword))
      : all;

    count.textContent = all.length ? `${all.length}` : '';

    if (!list.length) {
      const empty = el('div', 'bzr-shelf-empty');
      empty.append(
        el('div', 'bzr-shelf-empty-title', all.length ? '没有匹配的书' : '书库是空的'),
        el(
          'div',
          'bzr-shelf-empty-desc',
          all.length ? '换个关键词试试' : `把 ${formats.map((f) => f.toUpperCase()).join(' / ')} 文件放进笔记库，这里会自动出现`,
        ),
      );
      body.appendChild(empty);
      return;
    }

    const grid = el('div', 'bzr-book-grid');
    for (const book of list) grid.appendChild(renderCard(book));
    body.appendChild(grid);
  }

  function renderCard(book: ReaderBook): HTMLElement {
    const missing = (book.fileRef as { fileMissing?: boolean }).fileMissing;
    const card = el('div', 'bzr-book-card' + (missing ? ' is-missing' : ''));
    card.tabIndex = 0;

    const cover = el('div', 'bzr-book-cover');
    cover.appendChild(el('span', 'bzr-book-cover-title', book.meta.title));
    if (missing) cover.appendChild(el('span', 'bzr-book-cover-badge', '文件已移走'));

    const meta = el('div', 'bzr-book-meta');
    meta.appendChild(el('div', 'bzr-book-title', book.meta.title));
    meta.appendChild(el('div', 'bzr-book-author', book.meta.author || titleFromPath(book.fileRef.vaultPath).split('/').pop() || ''));
    const bar = el('div', 'bzr-book-progress');
    const fill = el('div', 'bzr-book-progress-fill');
    fill.style.width = `${Math.round((book.reading.position.percent || 0) * 100)}%`;
    bar.appendChild(fill);
    meta.appendChild(bar);
    meta.appendChild(el('div', 'bzr-book-percent', percentLabel(book.reading.position.percent)));

    card.append(cover, meta);

    const open = (): void => {
      if (missing) return;
      close();
      onOpen(book);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    return card;
  }

  search.addEventListener('input', () => {
    keyword = search.value.trim().toLowerCase();
    render();
  });

  syncFromVault();
  render();
  popup.classList.add('bzr-shelf-ready');

  return {
    close,
    refresh: () => {
      syncFromVault();
      render();
    },
  };
}

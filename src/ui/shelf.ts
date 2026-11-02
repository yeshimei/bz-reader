/* ============================================================
 * bz-reader · 书架（ui/shelf.ts）
 *
 * 全屏弹窗，网格 / 列表两种陈列方式。不复制、不搬移文件——
 * 书放在哪就留在哪，我们只记路径与进度（导入动作只负责把文件**写进** vault）。
 *
 * 数据流：开弹窗 → 扫 vault → 与仓储合并（新书入库、缺失的标灰）→ 渲染。
 * 扫描是「读文件列表」，不读内容，几千个文件也不卡。
 * ============================================================ */
import type { App } from 'obsidian';
import type { BookFormat, ReaderBook } from '../data/schema';
import { BookRepo, formatOf, scanVault, titleFromPath } from '../data/book-repo';
import { pickAndImport } from '../data/importer';
import type { ReaderStore } from '../data/store';
import { uiModal } from '../core/ui/modal';
import { notify } from '../core/notice';
import { clear, durationLabel, el, percentLabel } from './dom';

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

type Filter = 'all' | 'reading' | 'unread' | 'done';
type ViewMode = 'grid' | 'list';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'reading', label: '在读' },
  { value: 'unread', label: '未读' },
  { value: 'done', label: '读完' },
];

function stateOf(book: ReaderBook): Filter {
  const p = book.reading.position.percent || 0;
  if (p >= 0.999) return 'done';
  if (p > 0) return 'reading';
  return 'unread';
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
  const viewBtn = el('button', 'bzr-shelf-tool', '列表');
  viewBtn.type = 'button';
  const importBtn = el('button', 'bzr-shelf-tool', '导入');
  importBtn.type = 'button';
  head.append(title, count, spacer, search, viewBtn, importBtn);

  const filters = el('div', 'bzr-shelf-filters');
  const body = el('div', 'bzr-shelf-body');
  root.append(head, filters, body);

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
  let filter: Filter = 'all';
  let mode: ViewMode = 'grid';

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

  function visibleBooks(): ReaderBook[] {
    const all = repo.recent();
    return all.filter((b) => {
      if (filter !== 'all' && stateOf(b) !== filter) return false;
      if (!keyword) return true;
      return (
        b.meta.title.toLowerCase().includes(keyword) ||
        (b.meta.author || '').toLowerCase().includes(keyword) ||
        b.fileRef.vaultPath.toLowerCase().includes(keyword)
      );
    });
  }

  function renderFilters(): void {
    clear(filters);
    const all = repo.all();
    for (const f of FILTERS) {
      const n = f.value === 'all' ? all.length : all.filter((b) => stateOf(b) === f.value).length;
      const b = el('button', 'bzr-chip' + (f.value === filter ? ' is-on' : ''));
      b.type = 'button';
      b.textContent = n ? `${f.label} ${n}` : f.label;
      b.addEventListener('click', () => {
        filter = f.value;
        render();
      });
      filters.appendChild(b);
    }
  }

  function render(): void {
    renderFilters();
    clear(body);
    const list = visibleBooks();
    count.textContent = repo.all().length ? `${repo.all().length} 本` : '';

    if (!list.length) {
      const empty = el('div', 'bzr-shelf-empty');
      empty.append(
        el('div', 'bzr-shelf-empty-title', repo.all().length ? '没有匹配的书' : '书库是空的'),
        el(
          'div',
          'bzr-shelf-empty-desc',
          repo.all().length
            ? '换个关键词或筛选条件试试'
            : `把 ${formats.map((f) => f.toUpperCase()).join(' / ')} 放进笔记库，或者点右上角「导入」`,
        ),
      );
      body.appendChild(empty);
      return;
    }

    if (filter === 'all' && !keyword) {
      const recent = repo.recent(1)[0];
      if (recent && (recent.reading.position.percent || 0) > 0) body.appendChild(renderContinue(recent));
    }

    const wrap = el('div', mode === 'grid' ? 'bzr-book-grid' : 'bzr-book-list');
    for (const book of list) wrap.appendChild(mode === 'grid' ? renderCard(book) : renderRow(book));
    body.appendChild(wrap);
  }

  function renderContinue(book: ReaderBook): HTMLElement {
    const box = el('button', 'bzr-continue');
    box.type = 'button';
    const label = el('span', 'bzr-continue-label', '继续阅读');
    const name = el('span', 'bzr-continue-title', book.meta.title);
    const pct = el('span', 'bzr-continue-pct', percentLabel(book.reading.position.percent));
    box.append(label, name, pct);
    box.addEventListener('click', () => openBook(book));
    return box;
  }

  function openBook(book: ReaderBook): void {
    if ((book.fileRef as { fileMissing?: boolean }).fileMissing) return;
    close();
    onOpen(book);
  }

  function metaLines(book: ReaderBook): HTMLElement {
    const meta = el('div', 'bzr-book-meta');
    meta.appendChild(el('div', 'bzr-book-title', book.meta.title));
    const author = book.meta.author || '';
    if (author) meta.appendChild(el('div', 'bzr-book-author', author));
    const bar = el('div', 'bzr-book-progress');
    const fill = el('div', 'bzr-book-progress-fill');
    fill.style.width = `${Math.round((book.reading.position.percent || 0) * 100)}%`;
    bar.appendChild(fill);
    meta.appendChild(bar);
    const tail = el('div', 'bzr-book-percent', percentLabel(book.reading.position.percent));
    const spent = book.reading.stats.totalReadTime;
    if (spent > 0) tail.textContent += ` · ${durationLabel(spent)}`;
    meta.appendChild(tail);
    return meta;
  }

  function renderCard(book: ReaderBook): HTMLElement {
    const missing = (book.fileRef as { fileMissing?: boolean }).fileMissing;
    const card = el('div', 'bzr-book-card' + (missing ? ' is-missing' : ''));
    card.tabIndex = 0;

    const cover = el('div', 'bzr-book-cover');
    cover.appendChild(el('span', 'bzr-book-cover-title', book.meta.title));
    if (missing) cover.appendChild(el('span', 'bzr-book-cover-badge', '文件已移走'));
    card.append(cover, metaLines(book));

    card.addEventListener('click', () => openBook(book));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openBook(book);
      }
    });
    return card;
  }

  function renderRow(book: ReaderBook): HTMLElement {
    const missing = (book.fileRef as { fileMissing?: boolean }).fileMissing;
    const row = el('div', 'bzr-book-row' + (missing ? ' is-missing' : ''));
    row.tabIndex = 0;
    const badge = el('span', 'bzr-book-format', book.fileRef.format.toUpperCase());
    row.append(badge, metaLines(book));
    row.addEventListener('click', () => openBook(book));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openBook(book);
      }
    });
    return row;
  }

  search.addEventListener('input', () => {
    keyword = search.value.trim().toLowerCase();
    render();
  });

  viewBtn.addEventListener('click', () => {
    mode = mode === 'grid' ? 'list' : 'grid';
    viewBtn.textContent = mode === 'grid' ? '列表' : '网格';
    render();
  });

  importBtn.addEventListener('click', () => {
    if (importBtn.disabled) return;
    importBtn.disabled = true;
    void (async () => {
      try {
        const written = await pickAndImport(app, formats);
        if (written && written.length) {
          syncFromVault();
          render();
          notify(`已导入 ${written.length} 本`, 'success');
        }
      } catch (e) {
        notify(`导入失败：${(e as Error)?.message || '未知错误'}`, 'error');
      } finally {
        importBtn.disabled = false;
      }
    })();
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

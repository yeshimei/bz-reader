/* ============================================================
 * bz-reader · 书架（ui/shelf.ts）
 *
 * 书库是一个浮在笔记上的弹窗，不是页签——它是一次「找书」的短暂动作，
 * 找到就关。顶部只留四件事：搜索、视图切换、导入、数量。
 *
 * 桌面与移动是两套排版（不是同一套缩窄）：
 *   桌面 640×420：头行四件事 + 筛选胶囊 + 继续阅读条 + 五列书墙
 *   移动 满屏：大标题 + 继续阅读卡 + 三列书墙 + 悬浮胶囊导航
 * 数据与交互共用一份，只有 DOM 骨架分叉。
 *
 * 不复制、不搬移文件——书放在哪就留在哪，我们只记路径与进度。
 * ============================================================ */
import { Platform, type App } from 'obsidian';
import type { BookFormat, ReaderBook } from '../data/schema';
import { BookRepo, formatOf, scanVault } from '../data/book-repo';
import { openImport } from './import-panel';
import type { ReaderStore } from '../data/store';
import { normalizePrefs } from '../data/prefs';
import { uiModal } from '../core/ui/modal';
import { notify } from '../core/notice';
import { clear, coverColors, durationLabel, el, bookCover, percentLabel, searchIcon } from './dom';
import { createPrefsPanel } from './prefs-panel';

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
  const mobile = Platform.isMobile;

  const root = el('div', 'bzr-shelf' + (mobile ? ' is-mobile' : ''));
  let keyword = '';
  let filter: Filter = 'all';
  let mode: ViewMode = 'grid';

  /* ── 桌面骨架 ── */
  const head = el('div', 'bzr-shelf-head');
  const count = el('span', 'bzr-shelf-count', '');
  const search = el('input', 'bzr-shelf-search');
  search.type = 'search';
  search.placeholder = '搜索书名';
  const viewBtn = el('button', 'bzr-tool', '列表');
  viewBtn.type = 'button';
  const importBtn = el('button', 'bzr-tool is-primary', '导入');
  importBtn.type = 'button';
  head.append(el('div', 'bzr-shelf-title', '书库'), count, el('div', 'bzr-shelf-spacer'), search, viewBtn, importBtn);

  const chips = el('div', 'bzr-shelf-chips');
  const body = el('div', 'bzr-shelf-body');
  root.append(head, chips, body);

  /* ── 移动骨架 ── */
  const mCount = el('span', 'n', '');
  const mSearchRow = el('div', 'bzr-ms-search');
  mSearchRow.style.display = 'none';
  const mSearch = el('input');
  mSearch.type = 'search';
  mSearch.placeholder = '搜索书名';
  mSearchRow.appendChild(mSearch);
  const mBody = el('div', 'bzr-ms-body');
  const mshelf = el('div', 'bzr-mshelf');
  if (mobile) {
    const mh = el('div', 'bzr-ms-h');
    const searchAct = el('button', 'bzr-ms-act');
    searchAct.type = 'button';
    searchAct.setAttribute('aria-label', '搜索书名');
    searchAct.appendChild(searchIcon());
    const importAct = el('button', 'bzr-ms-act', '＋');
    importAct.type = 'button';
    importAct.setAttribute('aria-label', '导入书籍');
    mh.append(el('h1', '', '书架'), mCount, el('span', 'sp'), searchAct, importAct);

    mshelf.append(mh, mSearchRow, mBody);
    mshelf.appendChild(buildTabbar());
    root.append(mshelf);

    searchAct.addEventListener('click', () => {
      const on = mSearchRow.style.display === 'none';
      mSearchRow.style.display = on ? 'flex' : 'none';
      if (on) mSearch.focus();
      else {
        mSearch.value = '';
        keyword = '';
        render();
      }
    });
    importAct.addEventListener('click', openImportPanel);
    mSearch.addEventListener('input', () => {
      keyword = mSearch.value.trim().toLowerCase();
      render();
    });
  }

  const { close } = uiModal({
    content: root,
    className: 'bzr-shelf-popup' + (mobile ? ' is-mobile' : ''),
    autofocus: false,
    onClose: () => {
      void store.flush();
    },
  });

  /* ─────────────────── 数据 ─────────────────── */

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
    return repo.recent().filter((b) => {
      if (filter !== 'all' && stateOf(b) !== filter) return false;
      if (!keyword) return true;
      return (
        b.meta.title.toLowerCase().includes(keyword) ||
        (b.meta.author || '').toLowerCase().includes(keyword) ||
        b.fileRef.vaultPath.toLowerCase().includes(keyword)
      );
    });
  }

  function isMissing(book: ReaderBook): boolean {
    return !!(book.fileRef as { fileMissing?: boolean }).fileMissing;
  }

  function openBook(book: ReaderBook): void {
    if (isMissing(book)) return;
    close();
    onOpen(book);
  }

  /* ─────────────────── 移动：底部导航 ─────────────────── */

  function buildTabbar(): HTMLElement {
    const bar = el('div', 'bzr-mtabbar');
    const item = (label: string, on: boolean, action: () => void): HTMLElement => {
      const b = el('b', on ? 'is-on' : '');
      b.append(el('i'), document.createTextNode(label));
      b.addEventListener('click', action);
      return b;
    };
    bar.append(
      item('书架', true, () => mBody.scrollTo({ top: 0, behavior: 'smooth' })),
      item('导入', false, openImportPanel),
      // 统计是高级版能力：基础版不藏入口，点一次说明一次
      item('统计', false, () => notify('阅读统计是高级版功能', 'info')),
      item('设置', false, openShelfPrefs),
    );
    return bar;
  }

  function openShelfPrefs(): void {
    let prefs = normalizePrefs(store.get().prefs ?? undefined);
    const panel = createPrefsPanel(prefs, (patch) => {
      prefs = normalizePrefs({ ...prefs, ...patch });
      store.get().prefs = prefs;
      store.touch();
    });
    panel.root.classList.add('is-inline');
    uiModal({
      content: panel.root,
      className: 'bzr-shelf-prefs-popup',
      title: '阅读排版',
      head: true,
      onClose: () => void store.flush(),
    });
  }

  /* ─────────────────── 渲染 ─────────────────── */

  function renderChips(): void {
    clear(chips);
    const all = repo.all();
    for (const f of FILTERS) {
      const n = f.value === 'all' ? all.length : all.filter((b) => stateOf(b) === f.value).length;
      const b = el('button', 'bzr-chip' + (f.value === filter ? ' is-on' : ''), f.label);
      b.type = 'button';
      if (n) b.appendChild(el('u', '', String(n)));
      b.addEventListener('click', () => {
        filter = f.value;
        render();
      });
      chips.appendChild(b);
    }
  }

  function metaBlock(book: ReaderBook): HTMLElement {
    const meta = el('div', 'meta');
    meta.appendChild(el('div', 'mt', book.meta.title));
    if (book.meta.author) meta.appendChild(el('div', 'ma', book.meta.author));
    let pct = percentLabel(book.reading.position.percent);
    const spent = book.reading.stats.totalReadTime;
    if (spent > 0 && pct !== '已读完' && pct !== '未读') pct += ` · ${durationLabel(spent)}`;
    meta.appendChild(el('div', 'mp', pct));
    return meta;
  }

  function coverFor(book: ReaderBook): HTMLElement {
    return bookCover({
      title: book.meta.title,
      author: book.meta.author,
      percent: book.reading.position.percent || 0,
    });
  }

  function bookCard(book: ReaderBook, withMeta: boolean): HTMLElement {
    const card = el('div', 'bzr-book' + (isMissing(book) ? ' is-missing' : ''));
    card.tabIndex = 0;
    card.appendChild(coverFor(book));
    if (withMeta) card.appendChild(metaBlock(book));
    card.addEventListener('click', () => openBook(book));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openBook(book);
      }
    });
    return card;
  }

  function bookRow(book: ReaderBook): HTMLElement {
    const row = el('div', 'bzr-row' + (isMissing(book) ? ' is-missing' : ''));
    row.tabIndex = 0;
    row.append(el('span', 'bzr-row-fmt', book.fileRef.format.toUpperCase()), metaBlock(book));
    row.addEventListener('click', () => openBook(book));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openBook(book);
      }
    });
    return row;
  }

  function continueBar(book: ReaderBook, variant: 'desktop' | 'mobile'): HTMLElement {
    const pct = book.reading.position.percent || 0;
    const box = el('button', variant === 'desktop' ? 'bzr-cont' : 'bzr-ms-cont');
    box.type = 'button';

    if (variant === 'desktop') {
      box.append(
        el('span', 'bzr-cont-lb', '继续阅读'),
        el('span', 'bzr-cont-tt', book.meta.title),
        el('span', 'bzr-cont-pc', `${Math.round(pct * 100)}%`),
      );
    } else {
      const { c1, c2 } = coverColors(book.meta.title);
      const cover = el('div', 'cc', book.meta.title);
      cover.style.setProperty('--c1', c1);
      cover.style.setProperty('--c2', c2);
      const info = el('div', 'ci');
      const line = el('div', 'cp');
      const fill = el('i');
      fill.style.width = `${Math.round(pct * 100)}%`;
      line.appendChild(fill);
      const chapter = book.reading.position.chapterTitle || '上次读到的位置';
      info.append(
        el('div', 'cl', '继续阅读'),
        el('div', 'ct', book.meta.title),
        line,
        el('div', 'cn', `${chapter} · ${Math.round(pct * 100)}%`),
      );
      box.append(cover, info);
    }
    box.addEventListener('click', () => openBook(book));
    return box;
  }

  function emptyBox(): HTMLElement {
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
    return empty;
  }

  function render(): void {
    const total = repo.all().length;
    const list = visibleBooks();
    count.textContent = total ? `${total} 本` : '';
    mCount.textContent = total ? `${total} 本` : '';

    if (mobile) {
      clear(mBody);
      if (!list.length) {
        mBody.appendChild(emptyBox());
        return;
      }
      const recent = repo.recent(1)[0];
      if (filter === 'all' && !keyword && recent && (recent.reading.position.percent || 0) > 0) {
        mBody.appendChild(continueBar(recent, 'mobile'));
      }
      const grid = el('div', 'bzr-ms-grid');
      for (const book of list) grid.appendChild(bookCard(book, true));
      mBody.appendChild(grid);
      return;
    }

    renderChips();
    clear(body);
    if (!list.length) {
      body.appendChild(emptyBox());
      return;
    }
    if (filter === 'all' && !keyword) {
      const recent = repo.recent(1)[0];
      if (recent && (recent.reading.position.percent || 0) > 0) body.appendChild(continueBar(recent, 'desktop'));
    }
    if (mode === 'grid') {
      const grid = el('div', 'bzr-grid');
      for (const book of list) grid.appendChild(bookCard(book, true));
      body.appendChild(grid);
    } else {
      const rows = el('div', 'bzr-rows');
      for (const book of list) rows.appendChild(bookRow(book));
      body.appendChild(rows);
    }
  }

  function openImportPanel(): void {
    openImport({
      app,
      repo,
      store,
      formats,
      onDone: () => {
        syncFromVault();
        render();
      },
    });
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

  importBtn.addEventListener('click', openImportPanel);

  syncFromVault();
  render();

  return {
    close,
    refresh: () => {
      syncFromVault();
      render();
    },
  };
}

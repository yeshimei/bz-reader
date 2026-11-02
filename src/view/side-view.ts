/* ============================================================
 * bz-reader · 阅读侧栏（view/side-view.ts）
 *
 * 两级页面，住 Obsidian 左侧栏的一个 leaf：
 *   ① 书库页（默认）：衬线大题 + 搜索井 + 书列；导入/统计/全文沉在页脚，
 *      头行不再挤一排动作钮（2026-11-03 用户反馈：顶栏挤 + 动作该在下面）。
 *   ② 书页：点书行进来——顶部「‹ 书库」返回 + 书名，下面目录/书签/划线
 *      三页签；进书页的同时书会在阅读视图打开（点书 = 进书）。
 * 它们都是「阅读的坐标」：书库是书之间挪，其余三块是书里挪。分成四个
 * leaf 用户很快会有一列没人看的页签，所以一个 leaf 内部换页。
 *
 * 它不 import 引擎、不 import pro 面板：
 *   - 目录/划线认两份快照（toc-state / notes-state）；
 *   - 书库认注入源（shelf-state，plugin 在 onload 时接好线）。
 * 谁先 onOpen 都行，书关了就显示空态而不是崩。
 *
 * 移动端不走这里：手机上的左侧栏是滑出式抽屉，长目录翻起来太费劲，
 * 那边仍是整屏抽屉（ui/toc.ts）与全屏书架弹窗（ui/shelf.ts）。
 * ============================================================ */
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { FoliateTOCItem } from '../types/foliate';
import type { ReaderBook } from '../data/schema';
import type { BookRepo } from '../data/book-repo';
import { coverUrl } from '../data/cover';
import { clear, el, bookCover, setCoverImage } from '../ui/dom';
import { getToc, jumpTo, subscribeToc } from './toc-state';
import { exportNotes, getNotes, jumpToCfi, subscribeNotes } from './notes-state';
import { getShelfPro, getShelfSource, subscribeShelf } from './shelf-state';
import { renderBookmarkList, renderHighlightList } from '../ui/note-list';

export const VIEW_TYPE_TOC = 'bz-reader-toc';

/** 对外语义：书库 / 书内三块。setTab 保留这套入参（ribbon / 命令 / 阅读页在用） */
export type SideTab = 'shelf' | 'toc' | 'bookmarks' | 'highlights';

type BookTab = Exclude<SideTab, 'shelf'>;

const BOOK_TABS: Array<{ key: BookTab; label: string }> = [
  { key: 'toc', label: '目录' },
  { key: 'bookmarks', label: '书签' },
  { key: 'highlights', label: '划线' },
];

export class SideView extends ItemView {
  /** 当前页：书库 or 某本书 */
  private page: 'shelf' | 'book' = 'shelf';
  /** 书页内的页签 */
  private tab: BookTab = 'toc';
  /** 书页在讲哪本书（书行点击时记下；setTab 进来时从快照取） */
  private bookId = '';
  private headEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private footEl: HTMLElement | null = null;
  private tabNodes = new Map<BookTab, HTMLButtonElement>();
  private exportBtn: HTMLButtonElement | null = null;
  private rows: Array<{ label: string; node: HTMLElement }> = [];
  private lastTocRef: FoliateTOCItem[] | null = null;
  private lastRenderedBook = '';
  private lastActive = '';
  private shelfKeyword = '';
  /** 书库封面惰性加载：滚到哪解到哪（解一本要开一次 zip，50 本全解首屏会卡） */
  private coverObserver: IntersectionObserver | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TOC;
  }

  getDisplayText(): string {
    return '阅读';
  }

  getIcon(): string {
    return 'list';
  }

  /** 外部（ribbon / 命令 / 阅读页的回书架）指定落点；没开着的 leaf 也会被传进来 */
  setTab(tab: SideTab): void {
    if (tab === 'shelf') {
      this.page = 'shelf';
    } else {
      this.page = 'book';
      this.tab = tab;
      // 外部指名书内页签但本视图还没有书的上下文时，从快照里认领
      if (!this.bookId) this.bookId = getToc()?.bookId ?? getNotes()?.bookId ?? '';
    }
    if (this.bodyEl) this.render();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('bzr-tocv-content');
    this.buildShell();
    this.register(subscribeToc(() => this.render()));
    if (__BZ_READER_PRO__) this.register(subscribeNotes(() => this.render()));
    this.register(subscribeShelf(() => this.render()));
    this.render();
  }

  private buildShell(): void {
    this.contentEl.empty();
    const root = el('div', 'bzr-tocv');
    this.headEl = el('div', 'bzr-tocv-h');
    this.bodyEl = el('div', 'bzr-tocv-b');
    this.footEl = el('div', 'bzr-tocv-f');
    root.append(this.headEl, this.bodyEl, this.footEl);
    this.contentEl.appendChild(root);
  }

  /* ─────────────────── 渲染 ─────────────────── */

  private render(): void {
    const head = this.headEl;
    const body = this.bodyEl;
    const foot = this.footEl;
    if (!head || !body || !foot) return;
    this.stopWatchingCovers();
    if (this.page === 'shelf') {
      this.renderShelfHead(head);
      this.renderShelf(body);
      this.renderShelfFoot(foot);
    } else {
      this.renderBookHead(head, foot);
      this.renderBookBody(body);
    }
  }

  /* ─────────────────── ① 书库页 ─────────────────── */

  private renderShelfHead(head: HTMLElement): void {
    clear(head);
    head.classList.remove('is-book');
    head.classList.add('is-shelf');
    const source = getShelfSource();
    const n = source ? allCount(source.repo) : 0;
    const title = el('b', 'bzr-tocv-title', '书 库');
    title.addEventListener('click', () => {
      // 点题回顶：长书列滚到底再点题，不该一动不动
      this.bodyEl?.scrollTo({ top: 0, behavior: 'smooth' });
    });
    head.append(title, el('span', 'bzr-tocv-count', n ? `${n} 本` : ''));
  }

  /** 页脚：导入 / 统计 / 全文 沉底（原型把全局动作放页脚，头行只留标题） */
  private renderShelfFoot(foot: HTMLElement): void {
    clear(foot);
    foot.classList.remove('is-empty');
    foot.classList.add('is-shelf');
    const source = getShelfSource();
    const pro = getShelfPro();
    if (pro) {
      // pro 动作由 plugin 注入（base 里这个 if 整块不存在，模块也摇掉了）
      const xs = el('button', 'bzr-tocv-fact', '全 文') as HTMLButtonElement;
      xs.type = 'button';
      xs.title = '在全部书里搜索';
      xs.addEventListener('click', () => getShelfPro()?.openCrossSearch());
      const stats = el('button', 'bzr-tocv-fact', '统 计') as HTMLButtonElement;
      stats.type = 'button';
      stats.title = '阅读统计';
      stats.addEventListener('click', () => getShelfPro()?.openStats());
      foot.append(stats, xs);
    }
    const imp = el('button', 'bzr-tocv-fact', '导 入') as HTMLButtonElement;
    imp.type = 'button';
    imp.title = '把书导入书库';
    imp.addEventListener('click', () => getShelfSource()?.openImport());
    imp.disabled = !source;
    foot.appendChild(imp);
  }

  private renderShelf(list: HTMLElement): void {
    const source = getShelfSource();
    if (!source) {
      this.emptyState(list, '书库还没就绪，稍等一下');
      return;
    }
    // 每次进书库页都重扫一遍笔记库：文件挪走/新放进来的书要在这里现身
    source.syncVault();
    const all = source.repo.all();
    const kw = this.shelfKeyword.trim().toLowerCase();
    const books = booksOf(this.shelfKeyword, all);

    clear(list);
    this.rows = [];
    this.lastTocRef = null;
    this.lastRenderedBook = '';

    const wrap = el('div', 'bzr-shv');
    const well = el('div', 'bzr-shv-well');
    well.appendChild(searchGlyph());
    const input = el('input') as HTMLInputElement;
    input.type = 'search';
    input.spellcheck = false;
    input.placeholder = '搜索书名 / 作者';
    input.value = this.shelfKeyword;
    input.addEventListener('input', () => {
      this.shelfKeyword = input.value;
      this.renderShelfBooks(list, source.repo, booksOf(input.value, all));
    });
    well.appendChild(input);
    wrap.appendChild(well);
    list.appendChild(wrap);
    this.renderShelfBooks(list, source.repo, books);
  }

  private renderShelfBooks(list: HTMLElement, repo: BookRepo, books: ReaderBook[]): void {
    // 只重画列表部分：搜索框（wrap 里）不动，输入时不丢焦点
    const wrap = list.querySelector('.bzr-shv');
    if (!wrap) return;
    wrap.querySelector('.bzr-shv-body')?.remove();
    const body = el('div', 'bzr-shv-body');
    wrap.appendChild(body);

    const recent = repo.recent(1)[0];
    if (!this.shelfKeyword.trim() && recent && (recent.reading.position.percent || 0) > 0) {
      body.appendChild(this.continueRow(recent));
    }
    if (!books.length) {
      body.appendChild(el('div', 'bzr-tocv-empty', allCount(repo) ? '没有匹配的书' : `书架是空的。把 epub / txt 放进笔记库，或点页脚「导入」`));
      return;
    }
    const rows = el('div', 'bzr-bkl');
    for (const book of books) rows.appendChild(this.shelfRow(book));
    body.appendChild(rows);
    this.watchCovers(rows);
  }

  /** 继续阅读：最近一本读到一半的书（原型 .bkrow 的加高版）。点 = 进书页 + 打开 */
  private continueRow(book: ReaderBook): HTMLElement {
    const pct = book.reading.position.percent || 0;
    const row = el('button', 'bzr-bkrow is-cont');
    row.type = 'button';
    row.appendChild(this.coverBox(book));
    const info = el('div', 'bi');
    info.appendChild(el('b', '', book.meta.title));
    this.rowSub(info, book);
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${Math.round(pct * 100)}%`;
    bar.appendChild(fill);
    info.appendChild(bar);
    row.appendChild(info);
    row.appendChild(el('span', 'pct', `${Math.round(pct * 100)}%`));
    row.addEventListener('click', () => this.enterBook(book));
    return row;
  }

  /** 书行：小封面 + 书名 + 出处小字 + 细进度线 + 衬线百分数（原型 .bkrow） */
  private shelfRow(book: ReaderBook): HTMLElement {
    const pct = book.reading.position.percent || 0;
    const missing = !!(book.fileRef as { fileMissing?: boolean }).fileMissing;
    const row = el('button', 'bzr-bkrow' + (missing ? ' is-missing' : ''));
    row.type = 'button';
    if (missing) row.disabled = true;
    row.appendChild(this.coverBox(book));
    const info = el('div', 'bi');
    info.appendChild(el('b', '', book.meta.title));
    this.rowSub(info, book);
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${Math.round(pct * 100)}%`;
    bar.appendChild(fill);
    info.appendChild(bar);
    row.appendChild(info);
    row.appendChild(el('span', 'pct', pct > 0 ? `${Math.round(pct * 100)}%` : '—'));
    row.addEventListener('click', () => {
      if (missing) return;
      this.enterBook(book);
    });
    return row;
  }

  /** 书名的第二行：作者；没有作者就退到文件名——同名导入的两本书靠它分清 */
  private rowSub(info: HTMLElement, book: ReaderBook): void {
    const sub =
      book.meta.author?.trim() ||
      book.fileRef.vaultPath.split('/').pop() ||
      '';
    if (sub) info.appendChild(el('span', 'sub', sub));
  }

  /** 点书 = 进书：阅读视图打开这本书，侧栏切到它的书页 */
  private enterBook(book: ReaderBook): void {
    this.bookId = book.id;
    this.page = 'book';
    this.tab = 'toc';
    getShelfSource()?.openBook(book);
    this.render();
  }

  private coverBox(book: ReaderBook): HTMLElement {
    const cover = bookCover({
      title: book.meta.title,
      author: book.meta.author,
      percent: book.reading.position.percent || 0,
    });
    cover.dataset.coverBook = book.id;
    return cover;
  }

  private watchCovers(scope: HTMLElement): void {
    this.coverObserver?.disconnect();
    if (typeof IntersectionObserver === 'undefined') return;
    this.coverObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const box = entry.target as HTMLElement;
          this.coverObserver?.unobserve(box);
          const id = box.dataset.coverBook;
          if (!id) continue;
          const source = getShelfSource();
          const book = source?.repo.byId(id);
          if (!book) continue;
          void coverUrl(source!.app, book).then((url) => {
            if (url) setCoverImage(box, url);
          });
        }
      },
      { rootMargin: '200px' },
    );
    for (const box of Array.from(scope.querySelectorAll<HTMLElement>('[data-cover-book]'))) {
      this.coverObserver.observe(box);
    }
  }

  private stopWatchingCovers(): void {
    this.coverObserver?.disconnect();
    this.coverObserver = null;
  }

  /* ─────────────────── ② 书页（目录 / 书签 / 划线） ─────────────────── */

  private bookInCharge(): ReaderBook | null {
    const source = getShelfSource();
    if (!source) return null;
    return source.repo.byId(this.bookId) ?? null;
  }

  private renderBookHead(head: HTMLElement, foot: HTMLElement): void {
    clear(head);
    clear(foot);
    foot.classList.remove('is-shelf');
    foot.classList.add('is-empty'); // 书页没有全局页脚
    head.classList.remove('is-shelf');
    head.classList.add('is-book');
    const book = this.bookInCharge();
    const snap = getToc();
    if (!book && snap && snap.bookId) this.bookId = snap.bookId;

    // 头两行：①返回 + 书名 + 作者/导出 ②目录/书签/划线页签
    const row = el('div', 'bzr-tocv-hr');
    const back = el('button', 'bzr-tocv-back', '‹ 书库') as HTMLButtonElement;
    back.type = 'button';
    back.title = '返回书库';
    back.addEventListener('click', () => {
      this.page = 'shelf';
      this.render();
    });
    row.appendChild(back);
    row.appendChild(el('b', 'bzr-tocv-title', book ? book.meta.title : '阅读'));
    if (book?.meta.author?.trim()) {
      row.appendChild(el('span', 'bzr-tocv-count', book.meta.author.trim()));
    }
    if (__BZ_READER_PRO__) {
      this.exportBtn = el('button', 'bzr-tocv-back is-act', '导出') as HTMLButtonElement;
      this.exportBtn.type = 'button';
      this.exportBtn.title = '把这本书的划线导出成一份笔记';
      this.exportBtn.addEventListener('click', () => exportNotes());
      row.appendChild(this.exportBtn);
    }
    const tabs = el('div', 'bzr-side-tabs');
    this.tabNodes.clear();
    // 基础版只有目录；书签/划线是高级版页签，不给它长出来（点了也是空态）
    const defs = __BZ_READER_PRO__ ? BOOK_TABS : BOOK_TABS.filter((t) => t.key === 'toc');
    for (const def of defs) {
      const b = el('button', 'bzr-side-tab', def.label) as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => {
        if (this.tab === def.key) return;
        this.tab = def.key;
        this.renderBookBody(this.bodyEl!);
      });
      this.tabNodes.set(def.key, b);
      tabs.appendChild(b);
    }
    head.append(row, tabs);
  }

  private paintTabStates(): void {
    const counts: Partial<Record<BookTab, number>> = {};
    const toc = getToc();
    const notes = __BZ_READER_PRO__ ? getNotes() : null;
    counts.toc = toc && (!this.bookId || toc.bookId === this.bookId) ? countToc(toc.items) : 0;
    counts.bookmarks =
      notes && (!this.bookId || notes.bookId === this.bookId) ? notes.bookmarks.length : 0;
    counts.highlights =
      notes && (!this.bookId || notes.bookId === this.bookId) ? notes.highlights.length : 0;
    for (const [key, node] of this.tabNodes) {
      node.classList.toggle('is-on', key === this.tab);
      const n = counts[key] ?? 0;
      if (!n) {
        node.querySelector<HTMLElement>('.n')?.remove();
        continue;
      }
      let badge = node.querySelector<HTMLElement>('.n');
      if (!badge) {
        badge = el('span', 'n');
        node.appendChild(badge);
      }
      badge.textContent = String(n);
    }
    // 导出只对书签/划线有意义：目录页签下收起来
    if (this.exportBtn) this.exportBtn.style.display = this.tab === 'toc' ? 'none' : '';
  }

  private renderBookBody(list: HTMLElement): void {
    if (!list) return;
    this.paintTabStates();
    if (this.tab === 'toc') this.renderToc(list);
    else if (this.tab === 'bookmarks') this.renderBookmarks(list);
    else this.renderHighlights(list);
  }

  /* ── 目录 ── */

  private renderToc(list: HTMLElement): void {
    const snap = getToc();
    if (!snap || (this.bookId && snap.bookId !== this.bookId)) {
      this.emptyState(list, '打开一本书，目录会出现在这里');
      return;
    }
    // 同一本书、同一份目录：只挪高亮，别重建——重建会把正在滚的列表弹回顶部
    if (snap.bookId === this.lastRenderedBook && snap.items === this.lastTocRef) {
      this.lastActive = ''; // 强制重设，否则同 label 时会被提前 return
      this.setActive(snap.activeLabel);
      return;
    }
    this.lastRenderedBook = snap.bookId;
    this.lastTocRef = snap.items;
    this.rows = [];
    clear(list);
    if (!snap.items.length) {
      list.appendChild(el('div', 'bzr-tocv-empty', '这本书没有目录'));
      return;
    }
    this.renderLevel(snap.items, 0, list);
    this.lastActive = '';
    this.setActive(snap.activeLabel);
    // 换书之后把当前章滚进视野（长目录一开就停在第 1 章等于没做）
    const active = list.querySelector('.bzr-chap.is-on');
    if (active) active.scrollIntoView({ block: 'center' });
  }

  private renderLevel(items: FoliateTOCItem[], depth: number, parent: HTMLElement): number {
    let n = 0;
    for (const item of items) {
      const cls = depth === 0 ? 'bzr-chap' : depth === 1 ? 'bzr-chap d1' : 'bzr-chap d2';
      const row = el('button', cls);
      row.type = 'button';
      row.appendChild(el('span', 'no', numCn(n)));
      row.appendChild(el('span', 't', item.label || '（未命名章节）'));
      row.title = item.label || '';
      row.addEventListener('click', () => {
        if (item.href) jumpTo(item.href);
      });
      parent.appendChild(row);
      this.rows.push({ label: item.label, node: row });
      n += 1;
      if (item.subitems?.length) n += this.renderLevel(item.subitems, depth + 1, parent);
    }
    return n;
  }

  private setActive(label: string): void {
    if (label === this.lastActive) return;
    this.lastActive = label;
    for (const row of this.rows) row.node.classList.toggle('is-on', !!label && row.label === label);
  }

  /* ── 书签 / 划线 ── */

  private renderBookmarks(list: HTMLElement): void {
    // 守卫必须是 if 包裹式：早退式（if (!PRO) return; …）后面的代码在 esbuild
    // 的引用图里仍算「被引用」，note-list 会漏进 base 包（实测 0.21.5）
    if (__BZ_READER_PRO__) {
      this.lastTocRef = null;
      this.lastRenderedBook = '';
      clear(list);
      this.rows = [];
      const snap = getNotes();
      if (!snap || (this.bookId && snap.bookId !== this.bookId)) {
        list.appendChild(el('div', 'bzr-tocv-empty', '打开一本书，书签会出现在这里'));
        return;
      }
      renderBookmarkList(list, snap.bookmarks, {
        onJump: (cfi) => jumpToCfi(cfi),
        onRemove: snap.removeBookmark,
      });
    }
  }

  private renderHighlights(list: HTMLElement): void {
    if (__BZ_READER_PRO__) {
      this.lastTocRef = null;
      this.lastRenderedBook = '';
      clear(list);
      this.rows = [];
      const snap = getNotes();
      if (!snap || (this.bookId && snap.bookId !== this.bookId)) {
        list.appendChild(el('div', 'bzr-tocv-empty', '打开一本书，划线会出现在这里'));
        return;
      }
      renderHighlightList(list, snap.highlights, {
        onJump: (cfi) => jumpToCfi(cfi),
        onRemove: snap.removeHighlight,
      });
    }
  }

  private emptyState(list: HTMLElement, text: string): void {
    clear(list);
    this.rows = [];
    this.lastTocRef = null;
    this.lastRenderedBook = '';
    list.appendChild(el('div', 'bzr-tocv-empty', text));
  }
}

/* ─────────────────── 小工具 ─────────────────── */

function booksOf(kw: string, all: ReaderBook[]): ReaderBook[] {
  const k = kw.trim().toLowerCase();
  const source = getShelfSource();
  const ordered = source ? source.repo.recent() : all;
  if (!k) return ordered;
  return ordered.filter(
    (b) =>
      b.meta.title.toLowerCase().includes(k) ||
      (b.meta.author || '').toLowerCase().includes(k) ||
      b.fileRef.vaultPath.toLowerCase().includes(k),
  );
}

function allCount(repo: BookRepo): number {
  return repo.all().length;
}

/** ⌕：搜索井里的线条放大镜（dom.ts 的 tocIcon 是给头栏钮用的，这里要小一号） */
function searchGlyph(): HTMLElement {
  const i = el('i', 'bzr-shv-glyph');
  return i;
}

/** 章序号：目录条目前那枚衬线小字（原型 .chaprow .no） */
function numCn(n: number): string {
  const digits = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n <= 0) return String(n + 1);
  const idx = n + 1;
  if (idx <= 10) return idx === 10 ? '十' : digits[idx - 1];
  if (idx < 20) return `十${digits[idx - 11]}`;
  if (idx < 100) {
    const tens = Math.floor(idx / 10);
    const ones = idx % 10;
    return `${digits[tens - 1]}十${ones ? digits[ones - 1] : ''}`;
  }
  return String(idx);
}

function countToc(items: FoliateTOCItem[]): number {
  let n = 0;
  for (const i of items) {
    n += 1;
    if (i.subitems?.length) n += countToc(i.subitems);
  }
  return n;
}

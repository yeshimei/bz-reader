/* ============================================================
 * bz-reader · 阅读视图（view/reader-view.ts）
 *
 * 一个标准的 Obsidian `ItemView`：有 tab、能被拖到侧栏、能被布局记住、
 * 关掉再开能回到原处。不再是 Modal —— 弹窗会盖住笔记，读完想对照
 * 一眼原文得先关书；改成原生视图之后，书和笔记可以并排开着。
 *
 * 一屏 = 三条横栏 + 中间正文：
 *   头：返回 / 书名·章节 / 目录 · 搜索 · 排版
 *   中：foliate 渲染区（点左 30% 上一页、右 30% 下一页、中间收放工具栏）
 *   脚：上一页 / 进度 + 剩余时间 / 下一页
 *
 * 关书时的结算顺序不能反：
 *   先结算会话 → 再落最后位置 → 再 flush 落盘 → 最后 destroy 引擎。
 * 反过来的话 destroy 先拆掉 iframe，relocate 不再触发，
 * 最后那次进度就丢了（表现是「读到 80% 关掉，重开回到 60%」）。
 * ============================================================ */
import { ItemView, Platform, type App, type WorkspaceLeaf } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import type { ReaderStore } from '../data/store';
import type { BookRepo } from '../data/book-repo';
import { normalizePrefs, type ReaderPrefs } from '../data/prefs';
import { ActivityTracker } from '../engine/activity';
import { EngineHost, type RelocateInfo } from '../engine/host';
import { notify } from '../core/notice';
import { durationLabel, el, percentLabel } from '../ui/dom';
import { createTocPanel } from '../ui/toc';
import { createPrefsPanel } from '../ui/prefs-panel';
import { createSearchPanel } from '../ui/search-panel';

export const VIEW_TYPE_READER = 'bz-reader-view';

/** 视图需要的最小插件面——不 import 插件类，避免 plugin ↔ view 循环依赖 */
export interface ReaderHostApi {
  app: App;
  store: ReaderStore;
  repo: BookRepo;
  /** 书内「返回书库」用 */
  openShelf: () => void;
}

const COMPLETE_THRESHOLD = 0.99;

const ICON_BACK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>';
const ICON_TOC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h13"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>';
const ICON_TYPE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h10M9 6v12M15 11h5M17.5 11v7"/></svg>';
const ICON_CHEVRON_L = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>';
const ICON_CHEVRON_R = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6 6 6-6 6"/></svg>';

function iconBtn(label: string, svg: string, extra = ''): HTMLButtonElement {
  const b = el('button', 'bzr-icon-btn' + (extra ? ' ' + extra : ''));
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = svg;
  return b;
}

export class ReaderView extends ItemView {
  private api: ReaderHostApi;
  private bookId = '';
  private book: ReaderBook | null = null;
  private mounted = false;
  private mounting = false;
  private closed = false;
  private teardown = (): void => undefined;

  private host: EngineHost;
  private tracker = new ActivityTracker();
  private prefs: ReaderPrefs;
  private stage: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private chapterEl: HTMLElement | null = null;
  private progressText: HTMLElement | null = null;
  private remainText: HTMLElement | null = null;
  private railFill: HTMLElement | null = null;
  private toc: ReturnType<typeof createTocPanel> | null = null;
  private search: ReturnType<typeof createSearchPanel> | null = null;
  private prefsPanel: ReturnType<typeof createPrefsPanel> | null = null;
  private tapHandler: (zone: 'left' | 'middle' | 'right') => void = () => undefined;

  constructor(leaf: WorkspaceLeaf, api: ReaderHostApi) {
    super(leaf);
    this.api = api;
    this.host = new EngineHost(api.app);
    this.prefs = normalizePrefs(api.store.get().prefs ?? undefined);
  }

  getViewType(): string {
    return VIEW_TYPE_READER;
  }

  getDisplayText(): string {
    return this.book?.meta.title || '阅读';
  }

  /** 插件用它判断「这本书是不是已经开着」 */
  get currentBookId(): string {
    return this.bookId;
  }

  getIcon(): string {
    return 'book-open';
  }

  /** 状态里只存书 id：路径会因改名而变，id 是 djb2(路径)，改名后同样会变，
   *  但至少书库记录与之一致。靠 id 找不到时上层会退回最近在读。 */
  getState(): Record<string, unknown> {
    return { bookId: this.bookId };
  }

  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const s = (state ?? {}) as { bookId?: string };
    if (typeof s.bookId === 'string') this.bookId = s.bookId;
    await super.setState(state, result);
    await this.maybeMount();
  }

  async onOpen(): Promise<void> {
    this.buildShell();
    await this.maybeMount();
  }

  async onClose(): Promise<void> {
    this.teardown();
    this.teardown = () => undefined;
    await this.settle();
    this.contentEl.empty();
  }

  /** 插件被卸载时 ItemView 不保证走 onClose，由 plugin 兜底调一次（幂等） */
  async forceClose(): Promise<void> {
    await this.settle();
  }

  /* ─────────────────── 骨架 ─────────────────── */

  private buildShell(): void {
    if (this.stage) return;
    this.contentEl.addClass('bzr-view-content');
    this.contentEl.empty();

    const root = el('div', 'bzr-reader');
    root.tabIndex = -1;
    // 手机上默认沉浸：头尾栏浮在上面，点一下中间才出来
    if (Platform.isMobile) root.classList.add('is-bare');

    const head = el('div', 'bzr-reader-head');
    const back = iconBtn('返回笔记', ICON_BACK, 'bzr-reader-back');
    const titles = el('div', 'bzr-reader-titles');
    const title = el('div', 'bzr-reader-title', '');
    const chapter = el('div', 'bzr-reader-chapter', '');
    titles.append(title, chapter);
    const spacer = el('div', 'bzr-reader-spacer');
    const tocBtn = iconBtn('目录', ICON_TOC);
    const searchBtn = iconBtn('搜索本章', ICON_SEARCH);
    const prefsBtn = iconBtn('排版', ICON_TYPE);
    head.append(back, titles, spacer, tocBtn, searchBtn, prefsBtn);

    const stage = el('div', 'bzr-reader-stage');
    const rail = el('div', 'bzr-reader-rail');
    const railFill = el('div', 'bzr-reader-rail-fill');
    rail.appendChild(railFill);
    stage.appendChild(rail);

    // 桌面端鼠标翻页：左右边缘的半透明箭头，hover 淡入（触屏设备隐藏）
    const flipPrev = iconBtn('上一页', ICON_CHEVRON_L, 'bzr-flip bzr-flip-prev');
    const flipNext = iconBtn('下一页', ICON_CHEVRON_R, 'bzr-flip bzr-flip-next');
    stage.append(flipPrev, flipNext);

    const foot = el('div', 'bzr-reader-foot');
    const prevBtn = el('button', 'bzr-reader-nav', '上一页');
    prevBtn.type = 'button';
    const meta = el('div', 'bzr-reader-meta');
    const progressText = el('span', 'bzr-reader-progress-text', '');
    const remainText = el('span', 'bzr-reader-remain', '');
    meta.append(progressText, remainText);
    const nextBtn = el('button', 'bzr-reader-nav', '下一页');
    nextBtn.type = 'button';
    foot.append(prevBtn, meta, nextBtn);

    root.append(head, stage, foot);
    this.contentEl.appendChild(root);

    this.stage = stage;
    this.titleEl = title;
    this.chapterEl = chapter;
    this.progressText = progressText;
    this.remainText = remainText;
    this.railFill = railFill;

    const prefsPanel = createPrefsPanel(this.prefs, (patch) => {
      this.prefs = normalizePrefs({ ...this.prefs, ...patch });
      this.host.applyPrefs(this.prefs);
      this.api.store.get().prefs = this.prefs;
      this.api.store.touch();
    });
    const search = createSearchPanel({
      search: (q) => this.host.search(q, { chapterOnly: true }),
      onPick: (cfi) => {
        void this.host.goToCfi(cfi);
        search.hide();
      },
      onClose: () => undefined,
    });
    const toc = createTocPanel((href) => {
      void this.host.goToHref(href);
    });
    root.append(toc.root, search.root, prefsPanel.root);
    this.toc = toc;
    this.search = search;
    this.prefsPanel = prefsPanel;

    const anyPanelOpen = (): boolean => toc.isOpen() || search.isOpen() || prefsPanel.isOpen();
    const closePanels = (): void => {
      toc.hide();
      search.hide();
      prefsPanel.hide();
    };

    const turn = (dir: 'prev' | 'next'): void => {
      const p = dir === 'prev' ? this.host.prev() : this.host.next();
      void p.then(() => this.tracker.touch());
    };

    prevBtn.addEventListener('click', () => turn('prev'));
    nextBtn.addEventListener('click', () => turn('next'));
    flipPrev.addEventListener('click', () => turn('prev'));
    flipNext.addEventListener('click', () => turn('next'));

    back.addEventListener('click', () => {
      // 原生视图的「返回」= 关掉这个 tab，回到打开书之前的那一页
      this.leaf.detach();
    });

    tocBtn.addEventListener('click', () => {
      const open = toc.isOpen();
      closePanels();
      if (!open) toc.show();
    });
    searchBtn.addEventListener('click', () => {
      const open = search.isOpen();
      closePanels();
      if (!open) search.show();
    });
    prefsBtn.addEventListener('click', () => {
      const open = prefsPanel.isOpen();
      closePanels();
      if (!open) prefsPanel.show();
    });

    this.teardown = () => {
      closePanels();
    };

    const onKey = (e: KeyboardEvent): void => {
      if (this.closed) return;
      // 只在阅读视图是当前活动叶子时接管键盘，否则会抢掉别的笔记里的方向键
      if (this.api.app.workspace.getActiveViewOfType(ReaderView) !== this) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') {
        if (anyPanelOpen()) {
          e.preventDefault();
          e.stopPropagation();
          closePanels();
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        turn('prev');
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        turn('next');
      } else if (e.key === 't' || e.key === 'T') {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        const open = toc.isOpen();
        closePanels();
        if (!open) toc.show();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const prevTeardown = this.teardown;
    this.teardown = () => {
      prevTeardown();
      document.removeEventListener('keydown', onKey, true);
    };

    // 点正文：左右翻页，中间收放工具栏；任何面板开着时点击先关面板
    this.tapHandler = (zone) => {
      if (anyPanelOpen()) {
        closePanels();
        return;
      }
      if (zone === 'left') turn('prev');
      else if (zone === 'right') turn('next');
      else root.classList.toggle('is-bare');
    };
  }

  /* ─────────────────── 装载书 ─────────────────── */

  private async maybeMount(): Promise<void> {
    // setState 可能先于 onOpen 到达：骨架还没建，等 onOpen 再挂
    if (!this.stage) return;
    if (this.mounted || this.mounting || !this.bookId) return;
    const book = this.api.repo.byId(this.bookId);
    if (!book) {
      this.renderFault('这本书不在书库里', '它可能被移出书架了。回书库重新打开一次。');
      return;
    }
    if ((book.fileRef as { fileMissing?: boolean }).fileMissing) {
      this.renderFault('找不到这本书的文件', `书库记录还在，但 ${book.fileRef.vaultPath} 已经不在了。`);
      return;
    }

    this.mounting = true;
    this.book = book;
    this.prefs = normalizePrefs(this.api.store.get().prefs ?? undefined);
    if (this.titleEl) {
      this.titleEl.textContent = book.meta.title;
      this.titleEl.title = book.meta.title;
    }
    this.updateFoot(book.reading.position.percent || 0, 0);
    if (this.chapterEl && book.reading.position.chapterTitle) {
      this.chapterEl.textContent = book.reading.position.chapterTitle;
    }

    try {
      await this.host.mount(this.stage as HTMLElement, book.fileRef.vaultPath, {
        prefs: this.prefs,
        onRelocate: (info) => this.saveRelocate(info),
        onTap: (zone) => this.tapHandler(zone),
        onTurn: (dir) => {
          const p = dir === 'prev' ? this.host.prev() : this.host.next();
          void p.then(() => this.tracker.touch());
        },
        onFontSize: (size) => {
          this.prefs = normalizePrefs({ ...this.prefs, fontSize: size });
          this.host.applyPrefs(this.prefs);
          this.api.store.get().prefs = this.prefs;
          this.api.store.touch();
          this.prefsPanel?.refresh(this.prefs);
        },
        onReady: (_b, m) => {
          if (m.title) book.meta.title = m.title;
          if (m.author) book.meta.author = m.author;
          if (m.wordCount) book.meta.wordCount = m.wordCount;
          if (this.titleEl) {
            this.titleEl.textContent = book.meta.title;
            this.titleEl.title = book.meta.title;
          }
          this.toc?.setItems(this.host.toc());
          // tab 标题跟着书名走
          this.app.workspace.trigger('layout-change');
          this.api.store.touch();
        },
      });
      await this.host.start(book.reading.position.cfi, book.reading.position.percent || 0);
      this.tracker.begin(book.reading.position.percent);
      if (!book.reading.stats.startReadTime) book.reading.stats.startReadTime = Date.now();
      this.api.store.touch();
      this.updateFoot(book.reading.position.percent || 0, 0);
      this.mounted = true;
    } catch (e) {
      this.mounting = false;
      this.renderFault('这本书打不开', (e as Error)?.message || '格式不受支持');
      notify((e as Error)?.message || '这本书打不开', 'error');
      return;
    }
    this.mounting = false;
  }

  private renderFault(title: string, desc: string): void {
    const stage = this.stage;
    if (!stage) return;
    stage.empty();
    const box = el('div', 'bzr-view-fault');
    box.append(el('div', 'bzr-view-fault-title', title), el('div', 'bzr-view-fault-desc', desc));
    const back = el('button', 'bzr-btn', '回书库');
    back.type = 'button';
    back.addEventListener('click', () => this.api.openShelf());
    box.appendChild(back);
    stage.appendChild(box);
  }

  /* ─────────────────── 进度与会话 ─────────────────── */

  private updateFoot(percent: number, remainingSeconds: number): void {
    if (this.progressText) this.progressText.textContent = percentLabel(percent);
    if (this.remainText) this.remainText.textContent = remainingSeconds > 0 ? `剩 ${durationLabel(remainingSeconds)}` : '';
    if (this.railFill) this.railFill.style.width = `${Math.max(0, Math.min(100, percent * 100))}%`;
  }

  private saveRelocate(info: RelocateInfo): void {
    const book = this.book;
    if (!book) return;
    book.reading.position.percent = info.percent;
    if (info.cfi) book.reading.position.cfi = info.cfi;
    book.reading.position.chapterIndex = info.chapterIndex;
    book.reading.position.chapterTitle = info.chapterTitle;
    book.reading.stats.lastReadTime = Date.now();
    if (!book.reading.stats.startReadTime) book.reading.stats.startReadTime = Date.now();
    if (info.percent >= COMPLETE_THRESHOLD && !book.reading.stats.completedTime) {
      book.reading.stats.completedTime = Date.now();
    }
    book.updatedAt = Date.now();
    if (info.chapterTitle && this.chapterEl) {
      this.chapterEl.textContent = info.chapterTitle;
      this.toc?.setActive(info.chapterTitle);
    }
    this.updateFoot(info.percent, info.remainingSeconds);
    this.tracker.touch(info.percent);
    this.api.store.touch();
  }

  private async settle(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const book = this.book;
    if (book) {
      const session = this.tracker.end();
      if (session) {
        book.reading.sessions.push({ ...session, percent: book.reading.position.percent });
        book.reading.stats.totalReadTime += session.durationSeconds;
        book.reading.stats.lastReadTime = Date.now();
      }
      book.updatedAt = Date.now();
    }
    try {
      this.host.clearSearch();
    } catch {
      /* 引擎已拆时 clearSearch 无意义 */
    }
    await this.api.store.flush().catch(() => undefined);
    await this.host.destroy().catch(() => undefined);
  }
}

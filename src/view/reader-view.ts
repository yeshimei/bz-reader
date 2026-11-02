/* ============================================================
 * bz-reader · 阅读视图（view/reader-view.ts）
 *
 * 一个标准的 Obsidian `ItemView`：有 tab、能被拖到侧栏、能被布局记住、
 * 关掉再开能回到原处。不再是 Modal —— 弹窗会盖住笔记，读完想对照
 * 一眼原文得先关书；改成原生视图之后，书和笔记可以并排开着。
 *
 * 一屏 = 三条横栏 + 中间正文（桌面）：
 *   头 44px：‹ / 书名 / 章节 / 目录 · 搜索 · Aa
 *   中：foliate 渲染区（点左 30% 上一页、右 30% 下一页、中间收放工具栏）
 *   脚 34px：上一页 / 32% · 剩 6 小时 / 下一页，最下沿一条 2px 进度线
 *
 * 移动端是另一套：默认没工具栏，点中间浮出上下两条（浮在正文之上，
 * 正文一毫米都不挪），底栏四项：目录 / 进度 / 搜索 / 排版。
 *
 * 栏框颜色跟随当前阅读主题（--rear-* 写在根节点上），这样「翻页时
 * 界面不动、只有字在换」——白底书忽然顶着一条黑栏是最刺眼的破功点。
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
import { resolveTheme } from '../engine/theme';
import { notify } from '../core/notice';
import { durationLabel, el, searchIcon, tocIcon, trackRow } from '../ui/dom';
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
  private rootEl: HTMLElement | null = null;
  // 注意：不能叫 titleEl —— 那是 View 基类的页签标题元素，子类同名字段会把它覆盖成 null，
  // Obsidian 的 ItemView.load() 里 this.titleEl.setText(...) 就会炸成「打不开视图」。
  private bookTitleEl: HTMLElement | null = null;
  private chapterEl: HTMLElement | null = null;
  private percentEl: HTMLElement | null = null;
  private remainEl: HTMLElement | null = null;
  private railFill: HTMLElement | null = null;
  private toc: ReturnType<typeof createTocPanel> | null = null;
  private search: ReturnType<typeof createSearchPanel> | null = null;
  private prefsPanel: ReturnType<typeof createPrefsPanel> | null = null;
  private progressSheet: HTMLElement | null = null;
  private progressPercent: HTMLElement | null = null;
  private progressRemain: HTMLElement | null = null;
  private progressSlider: ReturnType<typeof trackRow> | null = null;
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

    const mobile = Platform.isMobile;
    const root = el('div', 'bzr-reader' + (mobile ? ' is-mobile' : ''));
    root.tabIndex = -1;
    // 手机上默认沉浸：两条栏浮在上面，点一下中间才出来
    if (mobile) root.classList.add('is-bare');

    /* 头栏 */
    const back = el('button', 'bzr-rback', '‹');
    back.type = 'button';
    back.setAttribute('aria-label', '返回笔记');
    back.title = '返回笔记';
    const title = el('div', 'bzr-rtitle', '');
    const chapter = el('div', 'bzr-rchap', '');
    const tocBtn = el('button', 'bzr-ric');
    tocBtn.type = 'button';
    tocBtn.title = '目录';
    tocBtn.setAttribute('aria-label', '目录');
    tocBtn.appendChild(tocIcon());
    const searchBtn = el('button', 'bzr-ric');
    searchBtn.type = 'button';
    searchBtn.title = '搜索本章';
    searchBtn.setAttribute('aria-label', '搜索本章');
    searchBtn.appendChild(searchIcon());
    const prefsBtn = el('button', 'bzr-ric', 'Aa');
    prefsBtn.type = 'button';
    prefsBtn.title = '排版';
    prefsBtn.setAttribute('aria-label', '排版');
    const headEl = el('div', 'bzr-rhead');
    headEl.append(back, title, chapter, el('div', 'bzr-rspacer'), tocBtn, searchBtn, prefsBtn);

    /* 正文区 */
    const stage = el('div', 'bzr-stage');
    const flipPrev = el('button', 'bzr-flip is-prev', '‹');
    flipPrev.type = 'button';
    flipPrev.setAttribute('aria-label', '上一页');
    const flipNext = el('button', 'bzr-flip is-next', '›');
    flipNext.type = 'button';
    flipNext.setAttribute('aria-label', '下一页');
    const bodyEl = el('div', 'bzr-rbody');
    bodyEl.append(stage, flipPrev, flipNext);

    /* 脚栏（桌面） */
    const prevBtn = el('button', 'bzr-rnav', '上一页');
    prevBtn.type = 'button';
    const nextBtn = el('button', 'bzr-rnav', '下一页');
    nextBtn.type = 'button';
    const percent = el('b', '', '0%');
    const remain = el('span', '', '');
    const meta = el('div', 'bzr-rmeta');
    meta.append(percent, remain);
    const footEl = el('div', 'bzr-rfoot');
    footEl.append(prevBtn, meta, nextBtn);

    /* 底栏（移动）：目录 / 进度 / 搜索 / 排版 */
    const mb = el('div', 'bzr-mbot');
    const mItem = (label: string): HTMLElement => {
      const b = el('b');
      b.append(el('i'), document.createTextNode(label));
      return b;
    };
    const mToc = mItem('目录');
    const mProgress = mItem('进度');
    const mSearch = mItem('搜索');
    const mPrefs = mItem('排版');
    mb.append(mToc, mProgress, mSearch, mPrefs);

    const rail = el('div', 'bzr-rrail');
    const railFill = el('i');
    rail.appendChild(railFill);

    /* 面板 */
    const toc = createTocPanel((href) => {
      void this.host.goToHref(href);
    });
    const search = createSearchPanel({
      search: async (q) => {
        const hits = await this.host.search(q, { chapterOnly: true });
        return hits.map((h) => ({ cfi: h.cfi, excerpt: h.excerpt, chapterLabel: h.chapterLabel }));
      },
      onPick: (cfi) => {
        void this.host.goToCfi(cfi);
        search.hide();
        this.tracker.touch();
      },
      onClose: () => undefined,
    });
    const prefsPanel = createPrefsPanel(this.prefs, (patch) => this.applyPrefs({ ...this.prefs, ...patch }));

    root.append(headEl, bodyEl, footEl, mb, rail, toc.scrim, toc.root, search.root, prefsPanel.root);
    if (mobile) {
      const sheet = this.buildProgressSheet();
      root.appendChild(sheet.root);
      this.progressSheet = sheet.root;
    }
    this.contentEl.appendChild(root);

    this.rootEl = root;
    this.stage = stage;
    this.bookTitleEl = title;
    this.chapterEl = chapter;
    this.percentEl = percent;
    this.remainEl = remain;
    this.railFill = railFill;
    this.toc = toc;
    this.search = search;
    this.prefsPanel = prefsPanel;

    this.applyChrome();

    const anyPanelOpen = (): boolean =>
      toc.isOpen() || search.isOpen() || prefsPanel.isOpen() || !!this.progressSheet?.classList.contains('is-open');
    const closePanels = (): void => {
      toc.hide();
      search.hide();
      prefsPanel.hide();
      this.progressSheet?.classList.remove('is-open');
    };
    const openToc = (): void => {
      const open = toc.isOpen();
      closePanels();
      if (!open) toc.show();
    };
    const openSearch = (): void => {
      const open = search.isOpen();
      closePanels();
      if (!open) search.show();
    };
    const openPrefs = (): void => {
      const open = prefsPanel.isOpen();
      closePanels();
      if (!open) prefsPanel.show();
    };
    const openProgress = (): void => {
      const open = !!this.progressSheet?.classList.contains('is-open');
      closePanels();
      if (!open) {
        this.syncProgressSheet();
        this.progressSheet?.classList.add('is-open');
      }
    };

    const turn = (dir: 'prev' | 'next'): void => {
      const p = dir === 'prev' ? this.host.prev() : this.host.next();
      void p.then(() => this.tracker.touch());
    };

    prevBtn.addEventListener('click', () => turn('prev'));
    nextBtn.addEventListener('click', () => turn('next'));
    flipPrev.addEventListener('click', () => turn('prev'));
    flipNext.addEventListener('click', () => turn('next'));
    mToc.addEventListener('click', openToc);
    mSearch.addEventListener('click', openSearch);
    mPrefs.addEventListener('click', openPrefs);
    mProgress.addEventListener('click', openProgress);

    back.addEventListener('click', () => {
      // 原生视图的「返回」= 关掉这个 tab，回到打开书之前的那一页
      this.leaf.detach();
    });

    tocBtn.addEventListener('click', openToc);
    searchBtn.addEventListener('click', openSearch);
    prefsBtn.addEventListener('click', openPrefs);

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
        openToc();
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

    // Obsidian 明暗切换时，跟随主题的阅读栏框要跟着变
    this.registerEvent(this.api.app.workspace.on('css-change', () => this.applyChrome()));
  }

  /** 移动端进度 sheet：整书跳转（章内定位靠翻页，不靠滑杆） */
  private buildProgressSheet(): { root: HTMLElement } {
    const root = el('div', 'bzr-prefs bzr-progress-sheet');
    const grab = el('div', 'bzr-msheet-grab');
    const title = el('div', 'bzr-msheet-title', '进度');
    const big = el('div', 'bzr-progress-big');
    const pct = el('b', '', '0%');
    const remain = el('span', '', '');
    big.append(pct, remain);

    const slider = trackRow({
      label: '位置',
      min: 0,
      max: 100,
      step: 1,
      value: 0,
      format: (v) => `${v}%`,
      onInput: (v) => {
        if (pct) pct.textContent = `${v}%`;
      },
    });
    // 松手才跳：拖动过程中每帧重排整本书，会卡成幻灯片
    slider.input.addEventListener('change', () => {
      void this.host.goToPercent(Number(slider.input.value) / 100);
      root.classList.remove('is-open');
    });

    root.append(grab, title, big, slider.row);
    this.progressPercent = pct;
    this.progressRemain = remain;
    this.progressSlider = slider;
    return { root };
  }

  private syncProgressSheet(): void {
    const p = this.book?.reading.position.percent || 0;
    const v = Math.round(p * 100);
    if (this.progressPercent) this.progressPercent.textContent = `${v}%`;
    if (this.progressRemain) {
      this.progressRemain.textContent = this.lastRemaining > 60 ? `剩 ${durationLabel(this.lastRemaining)}` : '';
    }
    this.progressSlider?.set(v);
  }

  private lastRemaining = 0;

  /** 栏框跟随阅读主题：只改根节点上的两个变量，全树跟着走 */
  private applyChrome(): void {
    const root = this.rootEl;
    if (!root) return;
    const theme = resolveTheme(this.prefs.theme);
    root.style.setProperty('--rear-bg', theme.bgColor);
    root.style.setProperty('--rear-fg', theme.textColor);
  }

  private applyPrefs(patch: Partial<ReaderPrefs>): void {
    this.prefs = normalizePrefs({ ...this.prefs, ...patch });
    this.host.applyPrefs(this.prefs);
    this.api.store.get().prefs = this.prefs;
    this.api.store.touch();
    this.prefsPanel?.refresh(this.prefs);
    this.applyChrome();
  }

  /* ─────────────────── 装载书 ─────────────────── */

  /** 书名出来之后刷新页签标题（ItemView 自己不会重新读 getDisplayText） */
  private syncTabTitle(): void {
    const leaf = this.leaf as unknown as { updateHeader?: () => void };
    leaf.updateHeader?.();
  }

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
    this.applyChrome();
    if (this.bookTitleEl) {
      this.bookTitleEl.textContent = book.meta.title;
      this.bookTitleEl.title = book.meta.title;
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
        onFontSize: (size) => this.applyPrefs({ fontSize: size }),
        onReady: (_b, m) => {
          if (m.title) book.meta.title = m.title;
          if (m.author) book.meta.author = m.author;
          if (m.wordCount) book.meta.wordCount = m.wordCount;
          if (this.bookTitleEl) {
            this.bookTitleEl.textContent = book.meta.title;
            this.bookTitleEl.title = book.meta.title;
          }
          this.toc?.setItems(this.host.toc());
          // 页签标题跟着书名走。用 leaf 自己的 updateHeader（内部 API，没有就跳过）；
          // 不要 trigger('layout-change')——那会让 Obsidian 在视图还没装完时重排整块布局
          this.syncTabTitle();
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
    this.lastRemaining = remainingSeconds;
    const p = Math.max(0, Math.min(1, percent));
    if (this.percentEl) this.percentEl.textContent = `${Math.round(p * 100)}%`;
    if (this.remainEl) {
      this.remainEl.textContent =
        remainingSeconds > 60 ? `剩 ${durationLabel(remainingSeconds)}` : '';
    }
    if (this.railFill) this.railFill.style.width = `${p * 100}%`;
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

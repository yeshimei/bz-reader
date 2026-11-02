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
import { normalizeSettings } from '../data/settings';
import { exportBookNotes } from '../data/export';
import {
  addHighlight,
  bookmarkAt,
  bookmarksOf,
  colorCss,
  findHighlight,
  highlightsOf,
  removeBookmark,
  removeHighlight,
  setHighlightColor,
  setHighlightComment,
  toggleBookmark,
  type HighlightColorName,
} from '../data/notes';
import { ActivityTracker } from '../engine/activity';
import { EngineHost, type Rect, type RelocateInfo, type SelectionInfo } from '../engine/host';
import { resolveTheme } from '../engine/theme';
import { notify } from '../core/notice';
import { bookmarkIcon, durationLabel, el, fullscreenIcon, searchIcon, tocIcon, trackRow } from '../ui/dom';
import { createAnnotLayer, type AnnotLayer } from '../ui/annot';
import { createFootnoteLayer, type FootnoteLayer } from '../ui/footnote';
import { createTocPanel } from '../ui/toc';
import { createPrefsPanel } from '../ui/prefs-panel';
import { createSearchPanel } from '../ui/search-panel';
import { clearToc, patchToc, setToc } from './toc-state';
import { clearNotes, getNotes, setNotes } from './notes-state';
import { VIEW_TYPE_TOC } from './side-view';

export const VIEW_TYPE_READER = 'bz-reader-view';

/** 视图需要的最小插件面——不 import 插件类，避免 plugin ↔ view 循环依赖 */
export interface ReaderHostApi {
  app: App;
  store: ReaderStore;
  repo: BookRepo;
  /** 书内「返回书架」用 */
  openShelf: () => void;
  /** 桌面端：把目录放进 Obsidian 左侧栏（已开则只切过去） */
  openTocSidebar: () => void;
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
  /** 脚注浮层：基础能力，两版都有 */
  private footnote: FootnoteLayer | null = null;
  private tapHandler: (zone: 'left' | 'middle' | 'right') => void = () => undefined;

  /* 标注（高级版）：书签按钮、划词浮层、当前这一页的定位 */
  private annot: AnnotLayer | null = null;
  private bookmarkBtn: HTMLButtonElement | null = null;
  private selection: SelectionInfo | null = null;
  /** 上次划词的时间：点色点的瞬间，iframe 里的选区长按会先塌掉，
   *  这条时间戳让「刚选的那段」还能被用上（超过 10s 就当失效） */
  private selectionAt = 0;
  private lastCfi = '';
  private lastPercent = 0;
  private lastChapterTitle = '';

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
   *  但至少书架记录与之一致。靠 id 找不到时上层会退回最近在读。 */
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
    searchBtn.title = __BZ_READER_PRO__ ? '搜索（本章 / 全书）' : '搜索本章';
    searchBtn.setAttribute('aria-label', searchBtn.title);
    searchBtn.appendChild(searchIcon());
    const prefsBtn = el('button', 'bzr-ric', 'Aa');
    prefsBtn.type = 'button';
    prefsBtn.title = '排版';
    prefsBtn.setAttribute('aria-label', '排版');
    const headEl = el('div', 'bzr-rhead');
    headEl.append(back, title, chapter, el('div', 'bzr-rspacer'), tocBtn, searchBtn, prefsBtn);

    // 全屏（两版都有）：工具栏全部藏掉，正文吃满。再点中间或 Esc 回来。
    // 移动端默认就是沉浸态（is-bare），点中间本来就收放，不重复给按钮。
    if (!mobile) {
      const fullBtn = el('button', 'bzr-ric') as HTMLButtonElement;
      fullBtn.type = 'button';
      fullBtn.title = '全屏';
      fullBtn.setAttribute('aria-label', '全屏');
      fullBtn.appendChild(fullscreenIcon());
      fullBtn.addEventListener('click', () => root.classList.toggle('is-bare'));
      headEl.insertBefore(fullBtn, prefsBtn);
    }

    // 书签按钮排在目录左边：它是「对当前这一页做点什么」，和目录/搜索/排版
    // 那组「打开一块面板」分开站。
    if (__BZ_READER_PRO__) {
      const mark = el('button', 'bzr-ric bzr-ric-mark') as HTMLButtonElement;
      mark.type = 'button';
      mark.title = '加书签';
      mark.setAttribute('aria-label', '加书签');
      mark.appendChild(bookmarkIcon());
      mark.addEventListener('click', () => this.toggleBookmark());
      headEl.insertBefore(mark, tocBtn);
      this.bookmarkBtn = mark;
    }

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
    const toc = createTocPanel(
      (href) => {
        void this.host.goToHref(href);
      },
      // 基础版不给 notes：抽屉里就只长目录一个页签
      __BZ_READER_PRO__ ? { notes: () => getNotes() } : {},
    );
    const search = createSearchPanel({
      search: async (q, scope, onHit) => {
        const hits = await this.host.search(q, {
          chapterOnly: scope === 'chapter',
          onHit: (h) => onHit({ cfi: h.cfi, excerpt: h.excerpt, chapterLabel: h.chapterLabel }),
        });
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
    const footnote = createFootnoteLayer({
      onClose: () => undefined,
      onJump: (href) => {
        void this.host.goToHref(href);
        this.tracker.touch();
      },
    });

    root.append(headEl, bodyEl, footEl, mb, rail, toc.scrim, toc.root, search.root, prefsPanel.root, footnote.root);
    if (mobile) {
      const sheet = this.buildProgressSheet();
      root.appendChild(sheet.root);
      this.progressSheet = sheet.root;
    }
    if (__BZ_READER_PRO__) {
      this.annot = createAnnotLayer({
        onCreate: (input) => this.createHighlight(input),
        onChangeColor: (id, color) => this.applyHighlightColor(id, color),
        onChangeComment: (id, text) => this.applyHighlightComment(id, text),
        onRemove: (id) => this.deleteHighlight(id),
        onClose: () => undefined,
      });
      root.appendChild(this.annot.root);
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
    this.footnote = footnote;

    this.applyChrome();

    const anyPanelOpen = (): boolean =>
      toc.isOpen() ||
      search.isOpen() ||
      prefsPanel.isOpen() ||
      !!this.annot?.isOpen() ||
      !!this.footnote?.isOpen() ||
      !!this.progressSheet?.classList.contains('is-open');
    const closePanels = (): void => {
      toc.hide();
      search.hide();
      prefsPanel.hide();
      this.annot?.hide();
      this.footnote?.hide();
      this.progressSheet?.classList.remove('is-open');
    };
    const openToc = (): void => {
      // 桌面：目录在 Obsidian 左侧栏里，不遮正文；移动：整屏抽屉（左侧栏在手机上是
      // 滑出式抽屉，翻长目录太费劲，不如直接铺满）
      if (!Platform.isMobile) {
        this.api.openTocSidebar();
        return;
      }
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
      // 只在「阅读视图或它的目录侧栏」是当前活动叶子时接管键盘，否则会抢掉
      // 别的笔记里的方向键。目录也算进来是因为：从侧栏点完章节，手还在方向键上，
      // 这时候按 ← → 必须还能翻页。
      if (!this.ownsKeyboard()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') {
        if (anyPanelOpen()) {
          e.preventDefault();
          e.stopPropagation();
          closePanels();
        }
        // 全屏也归 Esc 收：桌面 is-bare = 工具栏全隐藏（移动端按不到键盘，不影响它的默认沉浸态）
        root.classList.remove('is-bare');
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        // 竖排从右往左读，「往左」是下一页——方向键跟内容走，不跟屏幕走
        turn(this.host.contentVertical ? 'next' : 'prev');
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        turn(this.host.contentVertical ? 'prev' : 'next');
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

    // 点正文：左右翻页，中间收放工具栏；任何面板开着时点击先关面板。
    // 竖排从右往左读，下一页在左边——zone 到方向的映射跟着内容走。
    this.tapHandler = (zone) => {
      if (anyPanelOpen()) {
        closePanels();
        return;
      }
      if (zone === 'middle') {
        root.classList.toggle('is-bare');
        return;
      }
      const nextIsLeft = this.host.contentVertical;
      if (zone === 'left') turn(nextIsLeft ? 'next' : 'prev');
      else turn(nextIsLeft ? 'prev' : 'next');
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

  /** 键盘归谁：自己这条 leaf，或自己的目录侧栏（点完章节接着按方向键要还得翻页） */
  private ownsKeyboard(): boolean {
    const ws = this.api.app.workspace;
    const active = ws.activeLeaf as unknown as { view?: { getViewType?: () => string } } | null;
    if (!active) return false;
    if (active === (this.leaf as unknown as typeof active)) return true;
    return active.view?.getViewType?.() === VIEW_TYPE_TOC;
  }

  /** 书名出来之后刷新页签标题（ItemView 自己不会重新读 getDisplayText） */
  private syncTabTitle(): void {
    const leaf = this.leaf as unknown as { updateHeader?: () => void };
    leaf.updateHeader?.();
  }

  /**
   * 把目录交给左侧栏。桌面端开书后自动展开一次——目录是阅读的一等公民，
   * 每本书都要手动点一次才出来，等于默认没有。
   */
  private publishToc(): void {
    const book = this.book;
    if (!book) return;
    setToc({
      bookId: book.id,
      bookTitle: book.meta.title,
      items: this.host.toc(),
      activeLabel: book.reading.position.chapterTitle || '',
      jump: (href) => {
        void this.host.goToHref(href);
        this.tracker.touch();
      },
    });
    if (!Platform.isMobile) this.api.openTocSidebar();
  }

  private async maybeMount(): Promise<void> {
    // setState 可能先于 onOpen 到达：骨架还没建，等 onOpen 再挂
    if (!this.stage) return;
    if (this.mounted || this.mounting || !this.bookId) return;
    const book = this.api.repo.byId(this.bookId);
    if (!book) {
      this.renderFault('这本书不在书架上', '它可能被移出书架了。回书架重新打开一次。');
      return;
    }
    if ((book.fileRef as { fileMissing?: boolean }).fileMissing) {
      this.renderFault('找不到这本书的文件', `书架记录还在，但 ${book.fileRef.vaultPath} 已经不在了。`);
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
        // 基础版不接划词：连监听都不挂，选区变化照旧归浏览器
        onSelect: __BZ_READER_PRO__ ? (info) => this.handleSelection(info) : undefined,
        onAnnotTap: __BZ_READER_PRO__ ? (info) => this.openHighlight(info) : undefined,
        // 脚注两版都给：注释号点了没反应属于「坏了」，不是「付费功能」
        onFootnote: (info) => {
          if (!info) {
            this.footnote?.hide();
            return;
          }
          this.footnote?.show(info);
        },
        onReady: (_b, m) => {
          if (m.title) book.meta.title = m.title;
          if (m.author) book.meta.author = m.author;
          if (m.wordCount) book.meta.wordCount = m.wordCount;
          if (this.bookTitleEl) {
            this.bookTitleEl.textContent = book.meta.title;
            this.bookTitleEl.title = book.meta.title;
          }
          this.toc?.setItems(this.host.toc());
          this.publishToc();
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
      this.refreshAnnotations();
      this.publishNotes();
      this.syncBookmarkBtn();
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
    const back = el('button', 'bzr-btn', '回书架');
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
    this.lastPercent = info.percent;
    if (info.cfi) this.lastCfi = info.cfi;
    if (info.chapterTitle) this.lastChapterTitle = info.chapterTitle;
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
      patchToc({ activeLabel: info.chapterTitle });
    }
    this.updateFoot(info.percent, info.remainingSeconds);
    this.tracker.touch(info.percent);
    this.syncBookmarkBtn();
    this.api.store.touch();
  }

  /* ─────────────────── 标注 · 书签 ─────────────────── */

  /**
   * 划词回调。选区消失时传 null —— 那时浮层必须收掉，
   * 否则用户点了别处，浮层还挂在半空中等着他。
   */
  private handleSelection(info: SelectionInfo | null): void {
    if (!__BZ_READER_PRO__) return;
    if (!info) {
      // 只收那条小色条：鼠标按住色点那一下，iframe 的选区会先塌。
      // 卡片形态（正在写想法）绝不能因为选区塌了就跟着消失——点一下输入框
      // 本身就会让 iframe 失焦，那样用户打到一半的批注当场没。
      if (this.annot?.isOpen() && !this.annot.isCard()) this.annot.hide();
      return;
    }
    this.selection = info;
    this.selectionAt = Date.now();
    this.annot?.showForSelection(info);
  }

  private createHighlight(input: { color: HighlightColorName; comment?: string }): void {
    if (!__BZ_READER_PRO__) return;
    const book = this.book;
    const sel = this.selection;
    if (!book || !sel) return;
    if (Date.now() - this.selectionAt > 10_000) {
      this.selection = null;
      return;
    }
    addHighlight(book, {
      text: sel.text,
      cfiRange: sel.cfiRange,
      chapterIndex: sel.chapterIndex,
      chapterTitle: this.lastChapterTitle || book.reading.position.chapterTitle,
      color: input.color,
      comment: input.comment,
    });
    this.selection = null;
    this.host.clearSelection();
    this.refreshAnnotations();
    this.publishNotes();
    this.api.store.touch();
  }

  private applyHighlightColor(id: string, color: HighlightColorName): void {
    if (!__BZ_READER_PRO__) return;
    const book = this.book;
    if (!book) return;
    if (!setHighlightColor(book, id, color)) return;
    this.refreshAnnotations();
    this.publishNotes();
    this.api.store.touch();
  }

  private applyHighlightComment(id: string, comment: string): void {
    if (!__BZ_READER_PRO__) return;
    const book = this.book;
    if (!book) return;
    if (!setHighlightComment(book, id, comment)) return;
    this.publishNotes();
    this.api.store.touch();
  }

  private deleteHighlight(id: string): void {
    if (!__BZ_READER_PRO__) return;
    const book = this.book;
    if (!book) return;
    if (!removeHighlight(book, id)) return;
    this.refreshAnnotations();
    this.publishNotes();
    this.api.store.touch();
  }

  /** 点中已有划线：把那条数据找出来，交给浮层展示 */
  private openHighlight(info: { cfiRange: string; anchor: Rect }): void {
    if (!__BZ_READER_PRO__) return;
    const book = this.book;
    if (!book) return;
    const h = findHighlight(book, info.cfiRange);
    if (!h) return;
    this.selection = null;
    this.annot?.showForHighlight(h, info.anchor);
  }

  /**
   * 书签开关。cfi 用的是最近一次 relocate 的定位——就是「当前这一页的左上角那行」。
   * 所以书签是**页级的**：同一页再回来能高亮，翻过去就知道这里存过一条。
   */
  private toggleBookmark(): void {
    if (!__BZ_READER_PRO__) return;
    const book = this.book;
    if (!book) return;
    if (!this.lastCfi) {
      notify('这一页还没定位好，翻一下再试', 'info');
      return;
    }
    const added = toggleBookmark(book, {
      cfi: this.lastCfi,
      percent: this.lastPercent,
      chapterTitle: this.lastChapterTitle,
    });
    this.syncBookmarkBtn();
    this.publishNotes();
    this.api.store.touch();
    notify(added ? '已加书签' : '已移除书签', 'info', 1600);
  }

  private syncBookmarkBtn(): void {
    if (!__BZ_READER_PRO__) return;
    const btn = this.bookmarkBtn;
    const book = this.book;
    if (!btn || !book) return;
    const on = !!bookmarkAt(book, this.lastCfi);
    btn.classList.toggle('is-on', on);
    btn.title = on ? '移除书签' : '加书签';
    btn.setAttribute('aria-label', btn.title);
  }

  /** 把书里的划线全量交给引擎重画（引擎只重画当前章节，其余等翻到再补） */
  private refreshAnnotations(): void {
    if (!__BZ_READER_PRO__) return;
    const book = this.book;
    if (!book) return;
    this.host.setAnnotations(
      highlightsOf(book)
        .filter((h) => !!h.cfiRange)
        .map((h) => ({ cfiRange: h.cfiRange as string, color: colorCss(h.color), chapterIndex: h.chapterIndex })),
    );
  }

  /** 侧栏的标注页数据。数组要复制一份新的引用，否则侧栏以为没变 */
  private publishNotes(): void {
    if (!__BZ_READER_PRO__) return;
    const book = this.book;
    if (!book) return;
    setNotes({
      bookId: book.id,
      bookTitle: book.meta.title,
      highlights: highlightsOf(book),
      bookmarks: bookmarksOf(book),
      jump: (cfi) => {
        void this.host.goToCfi(cfi);
        this.tracker.touch();
      },
      removeHighlight: (id) => this.deleteHighlight(id),
      removeBookmark: (id) => {
        const b = this.book;
        if (!b) return;
        if (!removeBookmark(b, id)) return;
        this.syncBookmarkBtn();
        this.publishNotes();
        this.api.store.touch();
      },
      exportNotes: () => void this.exportNotes(),
    });
    this.toc?.refresh();
  }

  /**
   * 把这本书的划线/书签导出成一份笔记。
   *
   * 导完不自动打开文件：用户可能只是想同步一下，突然被拽走一个 tab
   * 比什么都不发生更烦。要的是路径——提示里给全，想看自己点。
   */
  private async exportNotes(): Promise<void> {
    if (!__BZ_READER_PRO__) return;
    const book = this.book;
    if (!book) return;
    const settings = normalizeSettings(this.api.store.get().settings ?? undefined);
    try {
      const res = await exportBookNotes(this.api.app, book, settings);
      if (!res) {
        notify('这本书还没有划线或书签', 'info');
        return;
      }
      // 写盘之后立刻落一次数据：导出不改数据，但用户刚做过动作，顺手把待写的改动压下去
      void this.api.store.flush();
      notify(`已导出 ${res.highlights} 条划线 → ${res.path}`, 'success');
    } catch (e) {
      notify(`导出失败：${(e as Error)?.message || '写文件出错'}`, 'error');
    }
  }

  private async settle(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // 书关了，左侧栏的目录与标注跟着回到空态（保留 leaf，下次开书直接复用）
    clearToc();
    clearNotes();
    this.annot?.reset();
    this.selection = null;
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

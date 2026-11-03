/* ============================================================
 * bz-reader · 阅读视图（view/reader-view.ts）
 *
 * 只做三件事：
 *   1. 把 foliate 引擎挂进画布（mount / destroy / 定位）
 *   2. 画原型那一套 chrome：悬浮工具条 + 底部进度条 + 划词色点条
 *   3. 把阅读进度与会话写回 store
 *
 * 2026-11-03 重做：**删掉全部旧界面**——旧的目录抽屉、搜索面板、排版面板、
 * 标注浮层（那套「文字工具框」）、移动端底栏与进度 sheet 全部移除。
 * 目录/书签/划线在左侧栏，搜索/排版/书摘/AI 在全局弹层层，划词条用壳层样式。
 * 这一版只有一条界面语言，不再有第二套。
 * ============================================================ */
import { ItemView, Menu, setIcon, type WorkspaceLeaf } from 'obsidian';
import { EngineHost, type FootnoteInfo, type Rect, type RelocateInfo, type SelectionInfo } from '../engine/host';
import { resolveTheme } from '../engine/theme';
import { normalizePrefs, type ReaderPrefs } from '../data/prefs';
import type { ReaderBook } from '../data/schema';
import type { LinkTarget } from '../data/deeplink';
import {
  HIGHLIGHT_COLORS,
  colorCss,
  highlightsOf,
  addHighlight,
  findHighlight,
  toggleBookmark,
  bookmarkAt,
} from '../data/notes';
import { ActivityTracker } from '../engine/activity';
import { can } from '../data/entitlement';
import { speak, type SpeakHandle } from '../core/speak';
import { notify } from '../core/notice';
import { isMobileShell } from '../core/mobile';
import { dlog } from '../core/debug-log';
import { envSummary, probeBlobIframe } from '../core/diagnose';
import { el } from '../ui/dom';
import { setToc, clearToc, getToc, patchToc } from './toc-state';
import { VIEW_TYPE_TOC } from './side-view';

/* 注意：本类为了给 Obsidian 存 view 状态，重写了 getState()。
   所以在类内部直接写 getState() 拿到的是**视图自己的** {bookId}，
   不是壳层状态。壳层那套必须用下面这两个别名，否则会静默拿错对象
   （表现：主题不跟随、侧栏与排版面板以为没打开书）。 */
import {
  closeOverlay,
  getState as getShellState,
  isFloatOverlay,
  setState as setShellState,
  subscribe,
  notify as notifyShell,
} from '../shell/state';
import { openOverlay } from '../shell/state';
import { anchoredPlacement } from '../shell/anchored-style';
import { RT, onNotesChanged } from '../shell/runtime';
import { getShellSource } from '../shell/source';
import { dispatchAction, createMark, requireCap } from '../shell/actions';

export const VIEW_TYPE_READER = 'bzr-reader-view';

/** 命令面板可触发的阅读动作（plugin.ts 注册命令时用这个类型） */
export type ReaderCommand = 'next' | 'prev' | 'focus' | 'fullscreen' | 'bookmark' | 'typography' | 'bookmap' | 'tts' | 'help';

/** 读到 99% 以上就算读完，不必真翻到最后一页的最后一个字 */
const COMPLETE_THRESHOLD = 0.99;

/** 阅读视图对外暴露给插件的能力（开书、开侧栏、拿 store） */
export interface ReaderHostApi {
  app: import('obsidian').App;
  store: import('../data/store').ReaderStore;
  repo: import('../data/book-repo').BookRepo;
  openShelf: () => void;
  openTocSidebar: (tab?: 'toc' | 'bookmarks' | 'highlights' | 'ai') => void;
}

export class ReaderView extends ItemView {
  private api: ReaderHostApi;
  private bookId = '';
  private pendingCfi = '';
  private book: ReaderBook | null = null;
  private mounted = false;
  private mounting = false;
  private closed = false;
  private teardown = (): void => undefined;

  private host: EngineHost;
  private tracker = new ActivityTracker();
  private prefs: ReaderPrefs;

  private rootEl: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private selbar: HTMLElement | null = null;
  private selbarHideTimer: number | null = null;
  private pagesEl: HTMLElement | null = null;
  /** 挂进宿主头栏的动作（按 id 索引，重画时复用） */
  private headerEls = new Map<string, HTMLElement>();
  /** 手机上自绘的书名元素（宿主那个在窄屏会被挤成 0 宽） */
  private headTitleEl: HTMLElement | null = null;
  /** 沉浸：藏掉宿主上下两条栏 */
  private immersive = false;
  /** 真机诊断角标（临时） */
  private probeEl: HTMLElement | null = null;
  private tapCount = 0;
  private lastZone = '-';
  private lastPct = 0;
  private lastTurnAt = 0;
  private lastKeyBefore = '';
  private lastKeyAfter = '';
  /** 每次发版手动改，和 manifest 一起确认手机跑的是哪一版 */
  private static readonly BUILD_TAG = '0.1.5+1357';

  /* 并排对照：副卷自己一套引擎，主卷的进度与标注一概不受影响 */
  private parallelOn = false;
  private parallelId = '';
  private host2: EngineHost | null = null;
  private stage2: HTMLElement | null = null;

  /* 朗读：交给系统语音，不额外引依赖。翻页即停，避免「翻过去了还在念上一页」 */
  private speaking = false;
  private voice: SpeakHandle | null = null;

  private tapHandler: (
    zone: 'prev' | 'next',
    info?: {
      x: number;
      y: number;
      width: number;
      source: string;
      scrollLeft: number;
      within: number;
      screenX: number;
    },
  ) => void = () => undefined;

  private selection: SelectionInfo | null = null;
  private selectionAt = 0;
  /** 「选中即划」自己收选区时会再冒一次空选区事件，这一次不该把条子收掉 */
  private suppressSelClear = false;
  private lastCfi = '';
  private lastPercent = 0;
  private lastChapterTitle = '';
  private offShell: (() => void) | null = null;
  private offNotes: (() => void) | null = null;
  /** 双击/两指判定留下的延时翻页句柄（当前实现不再用，留着给手势扩展） */
  private pendingTurn: number | null = null;
  private lastTapAt = 0;

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

  getIcon(): string {
    return 'book-open';
  }

  get currentBookId(): string {
    return this.bookId;
  }

  getState(): Record<string, unknown> {
    return { bookId: this.bookId };
  }

  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const s = (state ?? {}) as { bookId?: string; cfi?: string };
    if (typeof s.bookId === 'string') this.bookId = s.bookId;
    if (typeof s.cfi === 'string' && s.cfi) this.pendingCfi = s.cfi;
    await super.setState(state, result);
    await this.maybeMount();
  }

  jumpTo(cfi: string): void {
    if (!cfi) return;
    if (this.bookId && this.book) {
      void this.host.goToCfi(cfi);
      this.tracker.touch();
      return;
    }
    this.pendingCfi = cfi;
    void this.maybeMount();
  }

  /**
   * 从笔记里的位置链接落回原文，返回是否真的定位到了。
   *
   * 三级降级，因为「同一本书换了个文件」是真实会发生的（重新下载、换排版版）：
   *   1. CFI 精确跳 —— 99% 走这条
   *   2. CFI 失效 → 全书搜链接里带的原文片段，落到第一个命中
   *   3. 再不行 → 按链接里的百分比落个大概位置
   * 全失败才返回 false，由调用方给一句「已停在上次的位置」。
   */
  async locateFromLink(t: LinkTarget): Promise<boolean> {
    if (!this.book) return false;

    if (t.cfi) {
      try {
        await this.host.goToCfi(t.cfi);
        this.tracker.touch();
        return true;
      } catch {
        /* CFI 认不出，往下兜 */
      }
    }

    if (t.text) {
      try {
        const hits = await this.host.search(t.text);
        const cfi = hits.find((h) => !!h.cfi)?.cfi;
        if (cfi) {
          await this.host.goToCfi(cfi);
          this.tracker.touch();
          return true;
        }
      } catch {
        /* 搜不到，继续 */
      }
    }

    if (t.pct !== undefined) {
      await this.host.goToPercent(t.pct);
      return true;
    }
    return false;
  }

  async onOpen(): Promise<void> {
    this.buildShell();
    await this.maybeMount();
  }

  async onClose(): Promise<void> {
    this.teardown();
    this.toggleImmersive(false);
    this.cancelPendingTurn();
    this.headTitleEl?.remove();
    this.headTitleEl = null;
    this.headerEls.forEach((node) => node.remove());
    this.headerEls.clear();
    this.teardown = () => undefined;
    this.offShell?.();
    this.offShell = null;
    /* 标注变更订阅也要解：以前只解了 offShell，每开一本书就多一个永不释放的
       监听，关书后 emitNotesChanged 还会打到已经 destroy 的 host 上。 */
    this.offNotes?.();
    this.offNotes = null;
    this.stopTts();
    await this.closeParallel();
    await this.settle();
    this.contentEl.empty();
  }

  async forceClose(): Promise<void> {
    await this.settle();
  }

  /* ─────────────────── 骨架（原型 chrome） ─────────────────── */

  private buildShell(): void {
    if (this.stage) return;
    this.contentEl.addClass('bzr-view-content');
    this.contentEl.empty();

    const mobile = isMobileShell();
    const root = el('div', `bzs-shell bzs-reader${mobile ? ' is-mobile' : ''}`);
    root.tabIndex = -1;
    root.dataset.bzaccent = this.prefs.accent;

    /* 头/底两条自绘栏都撤了：动作挂进 Obsidian 原生头栏，进度看侧栏目录，
       省下来的纵向像素全部给正文。 */
    const stage = el('div', 'bzs-stage');
    const pages = el('div', 'bzs-rpages is-hosted');
    pages.append(stage);
    root.append(pages);
    this.contentEl.appendChild(root);

    this.rootEl = root;
    this.stage = stage;
    this.pagesEl = pages;

    const turn = (dir: 'prev' | 'next'): void => {
      this.stopTts();
      const p = dir === 'prev' ? this.host.prev() : this.host.next();
      void p.then(() => this.tracker.touch());
    };

    /* 点正文：移动端左右翻页；两指同时按切换沉浸（判定在引擎侧）。
       翻页延后由 host 的队列保证，这里只管按区定方向。 */
    this.tapHandler = (zone, info) => {
      /* 浮层开着时，点正文只关浮层，不翻页。
         iframe 里的点按不冒泡到宿主文档，document 级收口收不到，
         必须在阅读视图这一层补上——否则「点任何地方关掉」在手机上不成立。 */
      const shown = getShellState().overlay;
      if (shown && isFloatOverlay(shown.kind)) {
        closeOverlay();
        return;
      }
      const now = Date.now();
      this.tapCount += 1;
      dlog('tap', {
        zone,
        src: info?.source ?? '?',
        x: info ? Math.round(info.x) : -1,
        w: info ? Math.round(info.width) : -1,
        sx: info ? Math.round(info.scrollLeft) : -1,
        in: info ? Math.round(info.within) : -1,
        scr: info ? Math.round(info.screenX) : -1,
        key: this.host.pageKey,
        vertical: this.host.contentVertical,
      });
      this.lastZone = zone === 'prev' ? 'U' : 'D';
      /* 连点就连续翻：去重已经在引擎侧按手势做过，这里不再压时间窗 */
      this.lastTurnAt = now;
      if (!isMobileShell()) {
        this.renderProbe();
        return;
      }
      /* 浮层开着时点正文 = 关掉浮层，不翻页。浮层在宿主层、正文在 iframe 里，
         document 级 pointerdown 收不到 iframe 内的事件，只能在这里兜住。 */
      if (isFloatOverlay(getShellState().overlay?.kind)) {
        closeOverlay();
        this.renderProbe();
        return;
      }
      /* 上面 = 上一页，下面 = 下一页（分区在引擎侧按屏幕纵坐标判） */
      const dir: 'prev' | 'next' = zone;
      this.lastKeyBefore = this.host.pageKey;
      this.lastKeyAfter = '';
      this.stopTts();
      /* 只翻一次：turn() 和这里各发一次的话，一按就是两页 */
      dlog('turn', { dir, from: this.lastKeyBefore });
      const p = dir === 'prev' ? this.host.prev() : this.host.next();
      void p.then(() => {
        this.lastKeyAfter = this.host.pageKey;
        dlog('turn.done', { dir, to: this.lastKeyAfter });
        this.tracker.touch();
        this.renderProbe();
      });
      this.renderProbe();
    };

    const onKey = (e: KeyboardEvent): void => {
      if (this.closed || !this.ownsKeyboard()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case 'Escape':
          if (this.immersive) this.toggleImmersive(false);
          this.hideSelbar();
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          turn(this.host.contentVertical ? 'next' : 'prev');
          break;
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          turn(this.host.contentVertical ? 'prev' : 'next');
          break;
        case 'f':
          e.preventDefault();
          this.toggleImmersive();
          break;
        case 'b':
          e.preventDefault();
          this.toggleBookmark();
          break;
        case 't':
          e.preventDefault();
          dispatchAction('typography', this.rootEl ?? document.body);
          break;
        case 'm':
          e.preventDefault();
          dispatchAction('bookmap', this.rootEl ?? document.body);
          break;
        case 's':
          e.preventDefault();
          this.api.openTocSidebar('toc');
          break;
        case 'r':
          e.preventDefault();
          this.toggleTts();
          break;
        case 'g':
          e.preventDefault();
          getShellSource()?.openStudy('library');
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', onKey, true);
    this.teardown = () => document.removeEventListener('keydown', onKey, true);

    /* 皮肤跟着壳层状态走：跟随宿主时宿主换主题，这里也重画 */
    const syncTheme = (): void => this.applyChrome();
    this.offShell = subscribe(syncTheme);
    this.offNotes = onNotesChanged(() => this.refreshAfterNotesChange());
    this.registerEvent(this.api.app.workspace.on('css-change', () => this.applyChrome()));
    /* 宿主重建头栏 / 换 tab 时，书名与动作都会掉，得补一遍 */
    this.registerEvent(this.api.app.workspace.on('layout-change', () => this.mountHeader()));
    this.registerEvent(
      this.api.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf === this.leaf) this.mountHeader();
      }),
    );

    this.mountHeader();
    this.syncToolState();
  }

  /* ─────────────────── 宿主头栏（书名 / 动作） ─────────────────── */

  /**
   * 书名与动作都挂在 Obsidian 原生头栏里，阅读区不再多一行。
   *
   * 手机：书名放左侧（自绘一个元素，因为宿主那个在窄屏被挤成 0 宽），
   *       右侧放 3 个动作 + 宿主自己的 ⋮（其余插件图标用 CSS 藏掉）。
   * 桌面：书名用宿主原生的，动作 5 个塞进 .view-actions。
   */
  private mountHeader(): void {
    const header = this.containerEl.querySelector<HTMLElement>('.view-header');
    if (!header) {
      this.renderProbe();
      return;
    }
    if (isMobileShell()) this.mountTitleInHeader(header);
    else this.applyHeaderTitle(header);
    this.ensureHeaderActions(header);
    this.renderProbe();
  }

  /** 手机：书名挂在左侧按钮后面，用 flex 抢宽度 */
  private mountTitleInHeader(header: HTMLElement): void {
    const book = this.book;
    if (!book) return;
    if (!this.headTitleEl || !this.headTitleEl.isConnected) {
      const el0 = document.createElement('div');
      el0.className = 'bzr-head-title';
      const left = header.querySelector<HTMLElement>('.view-header-left');
      if (left) left.insertAdjacentElement('afterend', el0);
      else header.insertBefore(el0, header.firstElementChild);
      this.headTitleEl = el0;
    }
    if (this.headTitleEl.textContent !== book.meta.title) {
      this.headTitleEl.textContent = book.meta.title;
      this.headTitleEl.setAttribute('title', book.meta.title);
    }
  }

  /** 桌面：书名顶上原生标题（「阅读」只是书还没解析出来时的兜底） */
  private applyHeaderTitle(header: HTMLElement): void {
    const title = this.book?.meta.title;
    if (!title) return;
    const el0 = header.querySelector<HTMLElement>('.view-header-title');
    if (!el0 || el0.textContent === title) return;
    el0.textContent = title;
    el0.setAttribute('title', title);
    /* 只在文本真的不一致时调，避免 updateHeader → layout-change → 这里 的循环 */
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
  }

  /**
   * 头栏动作。
   *
   * 手机 3 个（目录/搜索/书签），插在宿主 ⋮ 所在容器的开头，⋮ 保持在最右；
   * 其他插件（Commander 等）的图标由 CSS 在阅读时隐藏，关掉书自动恢复。
   * 桌面 5 个，走 .view-actions。
   */
  private ensureHeaderActions(header: HTMLElement): void {
    const mobile = isMobileShell();
    const box =
      header.querySelector<HTMLElement>('.view-actions') ??
      header.querySelector<HTMLElement>('.nav-buttons-container') ??
      header;
    if (!box) return;

    const spec: Array<{ id: string; icon: string; label: string; run: () => void }> = [
      { id: 'toc', icon: 'list', label: '目录（s）', run: () => this.api.openTocSidebar('toc') },
      {
        id: 'search',
        icon: 'search',
        label: '搜索',
        run: () => dispatchAction('search', this.rootEl ?? document.body),
      },
      { id: 'mark', icon: 'bookmark', label: '记书签（b）', run: () => this.toggleBookmark() },
    ];
    if (!mobile) {
      spec.push({
        id: 'type',
        icon: 'type',
        label: '排版（t）',
        run: () => dispatchAction('typography', this.rootEl ?? document.body),
      });
      spec.push({ id: 'para', icon: 'columns-2', label: '并排对照', run: () => void this.toggleParallel() });
    }

    const fresh: HTMLElement[] = [];
    for (const item of spec) {
      const found = box.querySelector<HTMLElement>(`[data-bzr-action="${item.id}"]`);
      if (found) {
        this.headerEls.set(item.id, found);
        continue;
      }
      const btn = document.createElement('div');
      btn.className = 'clickable-icon view-action bzr-action';
      btn.dataset.bzrAction = item.id;
      btn.setAttribute('aria-label', item.label);
      btn.setAttribute('aria-label-position', 'top');
      setIcon(btn, item.icon);
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        item.run();
      });
      this.headerEls.set(item.id, btn);
      fresh.push(btn);
    }
    /* 全部动作插到最前面：视觉顺序 = 我们的动作，然后宿主的 ⋮。
       手机上放 3 个（横向像素最贵），桌面 5 个（排版 / 并排对照也要可见）。 */
    if (fresh.length) box.prepend(...fresh);
    this.trimHeaderActions(box, isMobileShell() ? 3 : 5);
  }

  /**
   * 头栏右侧：别人的图标收起来，我们的最多 3 颗，⋮ 始终保留。
   *
   * 真机上别的插件（Commander 等）也会往这一排塞按钮，谁家的 DOM 都可能变，
   * 所以不靠猜选择器：挂上自己那三颗，再数「确实可见的其它图标」，
   * 先尝试把它们收掉（阅读时它们没有用，还挤掉书名），收不掉就按名额
   * 从右往左裁自己的。⋮ 永远保留——全部折叠动作都在它里面。
   */
  private trimHeaderActions(box: HTMLElement, maxIcons: number): void {
    const kids = Array.from(box.children) as HTMLElement[];
    const visible = (el: HTMLElement): boolean =>
      el.offsetParent !== null && getComputedStyle(el).display !== 'none';
    const isOurs = (el: HTMLElement): boolean => el.classList.contains('bzr-action');

    const othersAll = kids.filter((el) => !isOurs(el) && visible(el));
    /* 最右那颗是宿主的 ⋮，不占名额，也不能收 */
    const dots = othersAll[othersAll.length - 1];
    const others = othersAll.filter((el) => el !== dots);
    for (const el of others) el.style.display = 'none';

    const stillOthers = others.filter(visible).length;
    const slots = Math.max(0, maxIcons - stillOthers);
    const ours = kids.filter(isOurs);
    ours.forEach((el, i) => {
      el.style.display = i < slots ? '' : 'none';
    });
  }

  /** 真机角标（临时诊断）：版本、头栏探针、上一次点击的章页变化 */
  private renderProbe(): void {
    if (!isMobileShell() || !this.rootEl) return;
    if (!this.probeEl) {
      const box = document.createElement('div');
      box.className = 'bzr-probe';
      this.rootEl.appendChild(box);
      this.probeEl = box;
    }
    const header = this.containerEl.querySelector<HTMLElement>('.view-header');
    const title = header?.querySelector<HTMLElement>('.view-header-title');
    const acts = header?.querySelectorAll('.bzr-action').length ?? 0;
    /* pg = 页面里跑的 paginator 是不是打过「点按不吸附」补丁的那一版 */
    const pg = (globalThis as unknown as { __bzrPaginatorGuard?: boolean }).__bzrPaginatorGuard;
    this.probeEl.textContent =
      `bz ${ReaderView.BUILD_TAG} · pg${pg ? '✓' : '✗'} hdr${header ? '✓' : '✗'} ttl${title ? '✓' : '✗'} act${acts}` +
      ` · tap${this.tapCount}${this.lastZone} ${this.lastKeyBefore || '-'}→${this.lastKeyAfter || '…'}` +
      ` ${Math.round(this.lastPct * 100)}%`;
  }

  /** 沉浸：藏掉宿主的上头栏与下导航条，再按一次还原 */
  private toggleImmersive(force?: boolean): void {
    this.immersive = force ?? !this.immersive;
    dlog('immersive', { on: this.immersive });
    document.body.classList.toggle('bzr-immersive', this.immersive);
  }

  private cancelPendingTurn(): void {
    if (this.pendingTurn === null) return;
    window.clearTimeout(this.pendingTurn);
    this.pendingTurn = null;
  }

  /**
   * 命令面板入口。
   *
   * 键盘上的每个动作都在 plugin 里注册成了一条命令（用户可以去 Obsidian
   * 「快捷键」里改键），命令最终落回这里——与按键走同一套实现，
   * 免得「按 f 有用、点命令没用」这种两套行为。
   */
  runCommand(kind: ReaderCommand): void {
    switch (kind) {
      case 'next':
        void this.host.next().then(() => this.tracker.touch());
        break;
      case 'prev':
        void this.host.prev().then(() => this.tracker.touch());
        break;
      case 'focus':
      case 'fullscreen':
        this.toggleImmersive();
        break;
      case 'bookmark':
        this.toggleBookmark();
        break;
      case 'tts':
        this.toggleTts();
        break;
      case 'typography':
      case 'bookmap':
      case 'help': {
        const host = this.rootEl;
        if (host) dispatchAction(kind, host);
        break;
      }
      default:
        break;
    }
  }

  /** 开关类动作的「亮着」状态只有一处真相，别在各处手动加 class */
  private syncToolState(): void {
    const root = this.rootEl;
    this.headerEls.get('para')?.classList.toggle('is-active', this.parallelOn);
    root?.classList.toggle('is-parallel', this.parallelOn);
  }

  /* ─────────────────── 更多菜单（手机专用） ─────────────────── */

  /**
   * 头栏放不下的动作挂进宿主自己的 ⋮ 菜单。
   *
   * `onPaneMenu` 是 View 的公开钩子：桌面是头栏最右那颗 ⋮，手机是底部动作
   * 面板（带安全区、返回键关闭）。这样不用自造弹层，也不会和宿主抢层级。
   */
  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu?.(menu, source);
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle('目录')
        .setIcon('list')
        .onClick(() => this.api.openTocSidebar('toc')),
    );
    menu.addItem((i) =>
      i
        .setTitle('搜索')
        .setIcon('search')
        .onClick(() => dispatchAction('search', this.rootEl ?? document.body)),
    );
    menu.addItem((i) =>
      i
        .setTitle('记书签')
        .setIcon('bookmark')
        .onClick(() => this.toggleBookmark()),
    );
    menu.addItem((i) =>
      i
        .setTitle('排版')
        .setIcon('type')
        .onClick(() => dispatchAction('typography', this.rootEl ?? document.body)),
    );
    menu.addItem((i) =>
      i
        .setTitle(this.parallelOn ? '关闭并排对照' : '并排对照')
        .setIcon('columns-2')
        .onClick(() => void this.toggleParallel()),
    );
    const other = this.parallelId ? this.api.repo.byId(this.parallelId) : null;
    menu.addItem((i) =>
      i
        .setTitle(`对照书籍：${other?.meta.title ?? '未选'}`)
        .setIcon('book')
        .onClick((evt) => this.openParallelPicker(evt instanceof MouseEvent ? evt : undefined)),
    );
    menu.addItem((i) =>
      i
        .setTitle(this.speaking ? '停止朗读' : '朗读')
        .setIcon('volume-2')
        .onClick(() => this.toggleTts()),
    );
    menu.addItem((i) =>
      i
        .setTitle('Book Map')
        .setIcon('map')
        .onClick(() => dispatchAction('bookmap', this.rootEl ?? document.body)),
    );
    menu.addItem((i) =>
      i
        .setTitle(this.immersive ? '退出沉浸' : '沉浸模式')
        .setIcon('maximize')
        .onClick(() => this.toggleImmersive()),
    );
    menu.addItem((i) =>
      i
        .setTitle('返回书架')
        .setIcon('library')
        .onClick(() => getShellSource()?.openStudy('library')),
    );
  }

  /** 二级菜单：选对照的另一本书。最多列 12 本，再多让用户先筛书架。 */
  private openParallelPicker(ev?: MouseEvent): void {
    const books = this.api.store
      .get()
      .books.filter((b) => b.id !== this.bookId && !(b.fileRef as { fileMissing?: boolean }).fileMissing);

    const menu = new Menu();
    if (!books.length) {
      menu.addItem((i) => i.setTitle('书架上还没有别的书').setDisabled(true));
    }
    for (const b of books.slice(0, 12)) {
      menu.addItem((i) =>
        i
          .setTitle(b.meta.title)
          .setChecked(b.id === this.parallelId)
          .onClick(() => {
            this.parallelId = b.id;
            // 已经开着并排就重开一次，否则只是记住选择、下次生效
            if (this.parallelOn) void this.closeParallel().then(() => this.toggleParallel());
          })
      );
    }
    /* 没有坐标时不能落在 (0,0)：手机上会被状态栏/刘海裁掉一半，
       看起来像「点了没反应」。退回阅读区右上方。 */
    const fallback = (): { x: number; y: number } => {
      const r = this.rootEl?.getBoundingClientRect();
      return { x: (r?.left ?? 0) + (r?.width ?? 320) - 24, y: (r?.top ?? 0) + 72 };
    };
    menu.showAtPosition(ev ? { x: ev.clientX, y: ev.clientY } : fallback());
  }

  /* ─────────────────── 并排对照 ─────────────────── */

  private async toggleParallel(): Promise<void> {
    // 关闭永远放行；只有「开启」才要高级版
    if (this.parallelOn) {
      await this.closeParallel();
      return;
    }
    if (!requireCap('parallel')) return;
    const book = this.book;
    const pages = this.pagesEl;
    if (!book || !pages) return;

    const others = this.api.store
      .get()
      .books.filter((b) => b.id !== book.id && !(b.fileRef as { fileMissing?: boolean }).fileMissing);
    if (!others.length) {
      notify('书架上只有这一本，并排对照需要另一本书');
      return;
    }
    const other = others.find((b) => b.id === this.parallelId) ?? others[0];
    this.parallelId = other.id;
    this.fillParallelSelect(others, other.id);

    const stage2 = el('div', 'bzs-stage bzs-stage-2');
    stage2.append(el('span', 'bzs-plabel', other.meta.title));
    const inner = el('div', 'bzs-stage-in');
    stage2.append(inner);
    pages.classList.add('is-parallel');
    pages.append(stage2);
    this.stage2 = stage2;

    const host2 = new EngineHost(this.api.app);
    this.host2 = host2;
    try {
      await host2.mount(inner, other.fileRef.vaultPath, {
        prefs: this.prefs,
        onTap: (zone) => {
          void (zone === 'prev' ? host2.prev() : host2.next());
        },
        onTurn: (dir) => {
          void (dir === 'prev' ? host2.prev() : host2.next());
        },
      });
      this.parallelOn = true;
    } catch (e) {
      this.host2 = null;
      stage2.remove();
      this.stage2 = null;
      pages.classList.remove('is-parallel');
      notify(`并排没打开：${(e as Error).message}`);
      return;
    }
    this.syncToolState();
  }

  private fillParallelSelect(books: ReaderBook[], id: string): void {
    const sel = this.rootEl?.querySelector<HTMLSelectElement>('.bzs-rpara');
    if (!sel) return;
    sel.empty();
    for (const b of books) {
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.meta.title;
      if (b.id === id) o.selected = true;
      sel.appendChild(o);
    }
  }

  private async closeParallel(): Promise<void> {
    this.parallelOn = false;
    const host2 = this.host2;
    this.host2 = null;
    this.stage2?.remove();
    this.stage2 = null;
    this.pagesEl?.classList.remove('is-parallel');
    this.syncToolState();
    await host2?.destroy();
  }

  /* ─────────────────── 朗读 ─────────────────── */

  private toggleTts(): void {
    // 停止永远放行，避免读起来之后关不掉
    if (this.speaking) {
      this.stopTts();
      return;
    }
    if (!requireCap('tts')) return;
    const text = this.host.currentText();
    if (!text) {
      notify('这一页没有可朗读的文字');
      return;
    }
    const done = (): void => {
      this.speaking = false;
      this.voice = null;
      this.syncToolState();
    };
    // 基础版包里 speak() 是空实现，返回 null —— 那就是「这个包没有朗读」
    const handle = speak(text, done);
    if (!handle) {
      notify('这个环境不支持语音朗读');
      return;
    }
    this.voice = handle;
    this.speaking = true;
    this.syncToolState();
  }

  private stopTts(): void {
    if (!this.speaking) return;
    this.speaking = false;
    this.voice?.stop();
    this.voice = null;
    this.syncToolState();
  }

  /** 强调色 → data-bzaccent；底色、文字、边框全部来自 Obsidian 变量 */
  private applyChrome(): void {
    const root = this.rootEl;
    if (!root) return;
    if (root.dataset.bzaccent !== this.prefs.accent) root.dataset.bzaccent = this.prefs.accent;
  }

  /* ─────────────────── 划词条 ─────────────────── */

  /** 选区消失后延迟收起：点工具条会让 iframe 失焦、选区塌掉，立刻收会把点击吞掉 */
  private scheduleSelbarHide(): void {
    if (!this.selbar) return;
    if (this.selbarHideTimer !== null) window.clearTimeout(this.selbarHideTimer);
    this.selbarHideTimer = window.setTimeout(() => {
      this.selbarHideTimer = null;
      this.hideSelbar();
    }, 320);
  }

  private hideSelbar(): void {
    if (this.selbarHideTimer !== null) {
      window.clearTimeout(this.selbarHideTimer);
      this.selbarHideTimer = null;
    }
    this.selbar?.remove();
    this.selbar = null;
    this.selection = null;
    RT.sel = null;
    RT.selMarkId = '';
  }

  /** 选区 → 壳层载荷。划词条上的动作全靠它，必须先落这里再落标注 */
  private setSel(info: SelectionInfo): void {
    const book = this.book;
    if (!book) return;
    RT.sel = {
      /* 整段选区的矩形：想法 / 书摘贴的是「整段文字」，不是第一行——
         跨行时用第一行会把下面几行盖住；宽高也带上，贴边才贴得准。 */
      anchor: {
        left: info.bounds.left,
        top: info.bounds.top,
        width: info.bounds.width,
        height: info.bounds.height,
      },
      text: info.text,
      bookId: book.id,
      chapterTitle: this.lastChapterTitle || book.reading.position.chapterTitle || '',
      cfiRange: info.cfiRange,
    };
  }

  /**
   * 划词条的 DOM 用壳层样式（.bzs-selbar 在 overlay.css 里），
   * 位置按 host 给出的宿主视口坐标换算到本视图内。
   *
   * `markId` 有值时说明这条线已经画上了（手机上选中即划）：色点变成
   * 「改这条的颜色」，当前色加圈，点完不收起条子，可以连着试几个色。
   */
  private showSelbar(info: SelectionInfo, markId?: string): void {
    const root = this.rootEl;
    if (!root) return;
    this.hideSelbar();
    this.setSel(info);
    if (!RT.sel) return;

    const live = markId || '';
    RT.selMarkId = live;
    const book = this.book;
    const activeColor = live && book ? findHighlight(book, live)?.color : '';

    const bar = el('div', 'bzs-selbar');
    if (live) bar.classList.add('is-marked');
    for (const p of HIGHLIGHT_COLORS) {
      const dot = el('span', 'bzs-pendot') as HTMLElement;
      dot.style.background = colorCss(p.value);
      dot.title = p.label;
      dot.setAttribute('aria-label', p.label);
      dot.dataset.v = p.value;
      if (p.value === activeColor) dot.classList.add('on');
      dot.addEventListener('click', () => {
        dispatchAction('selpen', dot);
        // 改色后条子留着：手机上连着换两个色比反复长按选字快得多
        for (const other of Array.from(bar.querySelectorAll('.bzs-pendot'))) {
          other.classList.toggle('on', other === dot);
        }
      });
      bar.appendChild(dot);
    }
    bar.appendChild(el('span', 'div'));

    const mk = (label: string, act: string): HTMLButtonElement => {
      const b = el('button', 'bzs-sbtn', label) as HTMLButtonElement;
      b.type = 'button';
      b.dataset.act = act;
      b.addEventListener('click', () => {
        dispatchAction(act, b);
        this.hideSelbar();
      });
      return b;
    };
    bar.append(mk('想法', 'selidea'), mk('书摘', 'selquote'));
    /* AI 属于高级能力：基础版构建里连按钮都不出现，
       不做成灰的锁标——那是每次划词都提醒一次「你没买」。 */
    if (can('ai')) bar.appendChild(mk('AI 解释', 'selai'));
    bar.appendChild(mk('复制', 'selcopy'));

    /* 点工具条不能把系统的选区和手柄清掉：pointerdown 默认会让 iframe 失焦，
       选区一塌，后面所有动作都拿不到文本了。 */
    bar.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });

    root.appendChild(bar);

    /* 定位：移动端贴整段选区的下方，桌面端贴上方；左右夹在可视区内，
       那一侧放不下就翻到另一侧。坐标全部换成阅读区本地坐标——
       .bzs-reader 必须是定位祖先（reader.css），否则 absolute 的条子会
       相对 tab 栏定位，看起来就是「偏移特别远」。
       另外 CSS 里不能再有 translateY：以前它会在算好的 top 上再抬一整条，
       移动端想放下方、实际却浮在上方。 */
    const rootRect = root.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const pos = anchoredPlacement(
      {
        left: info.bounds.left - rootRect.left,
        top: info.bounds.top - rootRect.top,
        width: info.bounds.width,
        height: info.bounds.height,
      },
      { width: barRect.width, height: barRect.height },
      { width: rootRect.width, height: rootRect.height },
      isMobileShell() ? 'below' : 'above',
    );
    bar.style.left = `${pos.left}px`;
    bar.style.top = `${pos.top}px`;
    this.selbar = bar;
  }

  /* ─────────────────── 装载书 ─────────────────── */

  private ownsKeyboard(): boolean {
    const ws = this.api.app.workspace;
    const active = ws.activeLeaf as unknown as { view?: { getViewType?: () => string } } | null;
    if (!active) return false;
    if (active === (this.leaf as unknown as typeof active)) return true;
    // 目录侧栏是阅读页的延伸：焦点在那儿时快捷键同样归这本书
    return active.view?.getViewType?.() === VIEW_TYPE_TOC;
  }

  private syncTabTitle(): void {
    const leaf = this.leaf as unknown as { updateHeader?: () => void };
    leaf.updateHeader?.();
  }

  private publishToc(openSidebar = true): void {
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
    /* 打开一本书就把左栏拨到目录（用户定的行为）：剪掉「先开书、再去找目录」
       这一步。桌面与手机同一条路——手机上侧栏就是那个抽屉。 */
    if (openSidebar) this.api.openTocSidebar('toc');
  }

  /**
   * 这本书被「重新激活」：从别的阅读 tab 切回来，或 openBook 又 reveal 了它。
   *
   * 两个 tab 各开一本书时，目录快照是全局一份（toc-state），谁最后 relocate
   * 谁说了算；切回来如果不重放，左栏会一直显示另一本书的章节。
   */
  activate(): void {
    const book = this.book;
    if (!book) return;
    if (getShellState().bookId !== book.id) setShellState({ bookId: book.id });
    this.publishToc(false);
  }

  private async maybeMount(): Promise<void> {
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
    /* 阅读视图是「当前在读哪本」的唯一真相。
       壳层状态要跟着它走，否则侧栏与排版面板会一直以为没有打开的书
       （表现为侧栏一屏「没有打开的书」、方向预览卡写着「这本书」）。 */
    if (getShellState().bookId !== book.id) setShellState({ bookId: book.id });
    this.prefs = normalizePrefs(this.api.store.get().prefs ?? undefined);
    this.applyChrome();
    /* 书名/动作挂在宿主头栏上（自绘那条已经撤了） */
    this.mountHeader();

    /* 手机上解一本大书要好几秒，这段时间是空的——先说清楚在干什么，
       别让人以为点错了（host.mount 建好视图时会把这个占位清掉） */
    this.renderLoading(book.meta.title);

    try {
      await this.host.mount(this.stage as HTMLElement, book.fileRef.vaultPath, {
        prefs: this.prefs,
        onRelocate: (info) => this.saveRelocate(info),
        onTap: (zone, info) => this.tapHandler(zone, info),
        /* 两指同时轻按 = 沉浸/还原。手势判定在引擎侧（只有它拿得到 iframe
           里的触摸序列），这里只接结果。 */
        onTwoFingerTap: () => this.toggleImmersive(),
        onTurn: (dir) => {
          const p = dir === 'prev' ? this.host.prev() : this.host.next();
          void p.then(() => this.tracker.touch());
        },
        onFontSize: (size) => this.applyPrefs({ fontSize: size }),
        onSelect: (info) => {
          if (!info) {
            // 选区塌了只收色点条；正在写想法时不受影响（弹层在 body 上）
            if (this.suppressSelClear) {
              this.suppressSelClear = false;
              return;
            }
            this.scheduleSelbarHide();
            return;
          }
          this.selection = info;
          this.selectionAt = Date.now();
          this.setSel(info);
          /* 开始新的划词 = 离开上一段交互：浮层（写想法 / 工具条）收掉，
             再把划词条贴到新选区下方。 */
          if (isFloatOverlay(getShellState().overlay?.kind)) closeOverlay();
          /* 选中不立刻落笔：移动端要留着系统选区与两端手柄，让用户先把范围
             调准，再点颜色。以前「选中即划」会在长按结束的瞬间落一条，
             想改范围就只能撤销重来。 */
          this.showSelbar(info);
        },
        onAnnotTap: (info) => this.openHighlight(info),
        /* 脚注：默认在注释号上方开一小块浮窗，读完接着读。
           设置里选「跳到章末」就退回 foliate 的老行为——我们在同一条链路上
           自己调 goTo，保证两种模式只有一处判断。 */
        onFootnote: (info) => this.handleFootnote(info),
        onReady: (_b, m) => {
          if (m.title) book.meta.title = m.title;
          if (m.author) book.meta.author = m.author;
          if (m.wordCount) book.meta.wordCount = m.wordCount;
          this.mountHeader();
          this.publishToc();
          this.syncTabTitle();
          this.api.store.touch();
          notifyShell();
        },
      });
      /* 点按分区要用「可见宽度」当分母：分页器的文档宽度比屏幕大一个量级 */
      this.host.setViewportWidth(
        (this.stage as HTMLElement).clientWidth,
        (this.stage as HTMLElement).getBoundingClientRect().left,
      );
      this.registerEvent(
        this.api.app.workspace.on('resize', () => {
          const box = this.stage;
          if (box) this.host.setViewportWidth(box.clientWidth, box.getBoundingClientRect().left);
        }),
      );
      await this.host.start(
        this.pendingCfi || book.reading.position.cfi,
        this.pendingCfi ? 0 : book.reading.position.percent || 0,
      );
      this.pendingCfi = '';
      this.tracker.begin(book.reading.position.percent);
      if (!book.reading.stats.startReadTime) book.reading.stats.startReadTime = Date.now();
      this.api.store.touch();
      this.refreshAnnotations();
      this.mounted = true;
    } catch (e) {
      this.mounting = false;
      const why = (e as Error)?.message || '格式不受支持';
      this.renderFault('这本书打不开', why);
      notify(why, 'error');
      return;
    }
    this.mounting = false;
  }

  private renderFault(title: string, desc: string): void {
    const stage = this.stage;
    if (!stage) return;
    stage.empty();
    const box = el('div', 'bzs-empty');
    box.append(el('div', '', title), el('div', 'bzs-mini', desc));
    /* 环境自检：手机上最常见的白屏是 iframe 加载不了 blob 地址，
       而那种失败连一条报错都没有。把结论写在这里，真机截图就能定位。 */
    const diag = el('div', 'bzs-mini bzr-diag');
    diag.style.opacity = '.7';
    for (const line of envSummary(this.host.loadPhase)) diag.appendChild(el('div', '', line));
    const probeLine = el('div', '', 'iframe·blob：探测中…');
    diag.appendChild(probeLine);
    void probeBlobIframe().then((r) => {
      probeLine.textContent = `iframe·blob：${r}`;
    });
    box.appendChild(diag);
    const back = el('button', 'bzs-btn', '回书架');
    back.type = 'button';
    back.addEventListener('click', () => getShellSource()?.openStudy('library'));
    box.appendChild(back);
    const retry = el('button', 'bzs-btn', '重试');
    retry.type = 'button';
    retry.addEventListener('click', () => {
      this.mounted = false;
      void this.maybeMount();
    });
    box.appendChild(retry);
    stage.appendChild(box);
  }

  /** 解包与渲染期间的占位：说明在忙，不是坏了 */
  private renderLoading(title: string): void {
    const stage = this.stage;
    if (!stage) return;
    stage.empty();
    const box = el('div', 'bzs-empty');
    box.append(el('div', 'bzs-mini', `正在打开《${title}》…`));
    stage.appendChild(box);
  }

  /* ─────────────────── 进度与会话 ─────────────────── */

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
      /* 读完那一刻弹一张卡。已经打过分的重读不再打扰——
         判断放在这里而不是弹层里，是因为弹层不该知道「为什么弹」。 */
      if (!book.reading.stats.rating) {
        setShellState({ overlay: { kind: 'finish', bookId: book.id } });
      }
    }
    if (info.chapterTitle) dlog('relocate', { key: this.host.pageKey, pct: Math.round(info.percent * 100) });
    book.updatedAt = Date.now();
    if (info.chapterTitle) patchToc({ activeLabel: info.chapterTitle });
    this.lastPct = info.percent;
    this.renderProbe();
    this.tracker.touch(info.percent);
    this.api.store.touch();
    notifyShell();
  }

  /* ─────────────────── 标注 · 书签 ─────────────────── */

  /** 划词条上的色点最终落到这里（由 shell/actions 调用 addHighlight） */
  private createHighlight(color: string): void {
    const book = this.book;
    const sel = RT.sel;
    if (!book || !sel) return;
    if (Date.now() - this.selectionAt > 10_000 && !this.selection) return;
    addHighlight(book, {
      text: sel.text,
      cfiRange: sel.cfiRange,
      chapterIndex: this.selection?.chapterIndex,
      chapterTitle: sel.chapterTitle || this.lastChapterTitle,
      color: color as never,
    });
    this.selection = null;
    this.host.clearSelection();
    this.hideSelbar();
    this.refreshAnnotations();
    this.api.store.touch();
    notifyShell();
  }

  /** 点中已有划线：贴着这条线弹出文字工具框（章节/原文都不重复） */
  private openHighlight(info: { cfiRange: string; anchor: Rect }): void {
    const book = this.book;
    if (!book) return;
    const h = findHighlight(book, info.cfiRange);
    if (!h) return;
    this.hideSelbar();
    openOverlay({ kind: 'hltools', markId: h.id, bookId: book.id, anchor: info.anchor });
  }

  /**
   * 脚注。两条路，一处判断：
   *   popup（默认，高级版）→ 注释号上方开浮窗，附一个「跳到原文」
   *   jump               → 直接跳过去，就是 foliate 原来的行为
   * 抓不到正文（章节互链、超长段落）时退回跳转，别让人点了没反应。
   */
  private handleFootnote(info: FootnoteInfo | null): void {
    if (!info) {
      notify('这处注释读不出正文，可能指向另一章', 'info');
      return;
    }
    /* 脚注浮窗已并入基础版：不再按能力位拦截，只看用户偏好 */
    if (this.prefs.footnote === 'jump') {
      void this.host.goToHref(info.href);
      return;
    }
    openOverlay({ kind: 'footnote', text: info.text, href: info.href, anchor: info.anchor });
  }

  private toggleBookmark(): void {
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
    this.api.store.touch();
    notify(added ? '已加书签' : '已移除书签', 'info', 1600);
    notifyShell();
  }

  /** 书页上的划线全部交给引擎重画（引擎只重画当前章节） */
  private refreshAnnotations(): void {
    const book = this.book;
    if (!book) return;
    this.host.setAnnotations(
      highlightsOf(book)
        .filter((h) => !!h.cfiRange)
        .map((h) => ({ cfiRange: h.cfiRange as string, color: colorCss(h.color), chapterIndex: h.chapterIndex })),
    );
  }

  /** 供 shell/actions 在标注增删后回调（删划线要立刻从书页上消失） */
  refreshAfterNotesChange(): void {
    this.refreshAnnotations();
    const book = this.book;
    if (book && this.lastCfi) {
      const on = !!bookmarkAt(book, this.lastCfi);
      void on;
    }
  }

  async settle(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    /* 两本书各开一个 tab 时，关掉 A 不该把 B 的目录一起清空——
       目录快照是全局一份，只认自己那本。 */
    if (this.book && getToc()?.bookId === this.book.id) clearToc();
    this.hideSelbar();
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
    /* 强制写：这段会话是刚刚在内存里加的，没有经过 touch()；用普通 flush
       会因 `!dirty` 早退，最后一段阅读时长就永远落不了盘。 */
    await this.api.store.flush(true).catch(() => undefined);
    await this.host.destroy().catch(() => undefined);
  }

  /** 外部（书架 · 设置页）改排版：整份覆盖并立即重排 */
  updatePrefs(next: ReaderPrefs): void {
    this.prefs = normalizePrefs(next);
    this.host.applyPrefs(this.prefs);
    this.api.store.get().prefs = this.prefs;
    this.api.store.touch();
    this.applyChrome();
  }

  private applyPrefs(patch: Partial<ReaderPrefs>): void {
    this.updatePrefs(normalizePrefs({ ...this.prefs, ...patch }));
  }

}

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
import { EngineHost, type FootnoteInfo, type RelocateInfo, type SelectionInfo } from '../engine/host';
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
import { envSummary, probeBlobIframe } from '../core/diagnose';
import { el } from '../ui/dom';
import { setToc, clearToc, getToc, patchToc } from './toc-state';
import { VIEW_TYPE_TOC } from './side-view';

/* 注意：本类为了给 Obsidian 存 view 状态，重写了 getState()。
   所以在类内部直接写 getState() 拿到的是**视图自己的** {bookId}，
   不是壳层状态。壳层那套必须用下面这两个别名，否则会静默拿错对象
   （表现：主题不跟随、侧栏与排版面板以为没打开书）。 */
import {
  getState as getShellState,
  setState as setShellState,
  subscribe,
  notify as notifyShell,
} from '../shell/state';
import { openOverlay } from '../shell/state';
import { RT } from '../shell/runtime';
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
  private bookTitleEl: HTMLElement | null = null;
  private authorEl: HTMLElement | null = null;
  private chapterEl: HTMLElement | null = null;
  private percentEl: HTMLElement | null = null;
  private remainEl: HTMLElement | null = null;
  private trackFill: HTMLElement | null = null;
  private trackKnob: HTMLElement | null = null;
  private selbar: HTMLElement | null = null;
  private pagesEl: HTMLElement | null = null;
  private focusBtn: HTMLButtonElement | null = null;
  private fullBtn: HTMLButtonElement | null = null;
  private paraBtn: HTMLButtonElement | null = null;
  private ttsBtn: HTMLButtonElement | null = null;

  /* 并排对照：副卷自己一套引擎，主卷的进度与标注一概不受影响 */
  private parallelOn = false;
  private parallelId = '';
  private host2: EngineHost | null = null;
  private stage2: HTMLElement | null = null;

  /* 朗读：交给系统语音，不额外引依赖。翻页即停，避免「翻过去了还在念上一页」 */
  private speaking = false;
  private voice: SpeakHandle | null = null;

  private tapHandler: (zone: 'left' | 'middle' | 'right') => void = () => undefined;

  private selection: SelectionInfo | null = null;
  private selectionAt = 0;
  /** 「选中即划」自己收选区时会再冒一次空选区事件，这一次不该把条子收掉 */
  private suppressSelClear = false;
  private lastCfi = '';
  private lastPercent = 0;
  private lastChapterTitle = '';
  private lastRemaining = 0;
  private offShell: (() => void) | null = null;

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
    this.teardown = () => undefined;
    this.offShell?.();
    this.offShell = null;
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

    /* 悬浮工具条：左书名作者，右一排图标动作。
       不再用汉字当按钮——十来个单字并排会像一排印章，认读反而慢；
       改用 Obsidian 自带图标（lucide），与宿主其余按钮同一套视觉语言。 */
    const title = el('b');
    const author = el('span');
    const metaBox = el('div', 'meta');
    metaBox.append(title, author);

    const tool = el('div', 'bzs-rtool');
    tool.append(metaBox, el('div', 'sp'));

    const btn = (icon: string, titleText: string): HTMLButtonElement => {
      const b = el('button', 'bzs-cbtn') as HTMLButtonElement;
      b.type = 'button';
      b.title = titleText;
      b.setAttribute('aria-label', titleText);
      setIcon(b, icon);
      return b;
    };

    const tocBtn = btn('list', '目录（s）');
    tocBtn.addEventListener('click', () => this.api.openTocSidebar('toc'));
    const markBtn = btn('bookmark', '记书签（b）');
    markBtn.addEventListener('click', () => this.toggleBookmark());
    const searchBtn = btn('search', '搜索');
    searchBtn.addEventListener('click', () => dispatchAction('search', searchBtn));
    const typeBtn = btn('type', '排版（t）');
    typeBtn.addEventListener('click', () => dispatchAction('typography', typeBtn));

    /* 并排：按钮旁边挂一个选书下拉，只在并排时出现 */
    const paraBtn = btn('columns-2', '并排对照');
    const paraSel = el('select', 'bzs-rpara') as HTMLSelectElement;
    paraSel.title = '对照的另一本书';
    paraSel.addEventListener('change', () => {
      this.parallelId = paraSel.value;
      if (this.parallelOn) void this.closeParallel().then(() => this.toggleParallel());
    });
    paraBtn.addEventListener('click', () => void this.toggleParallel());

    const ttsBtn = btn('volume-2', '朗读（r）');
    ttsBtn.addEventListener('click', () => this.toggleTts());

    const mapBtn = btn('map', 'Book Map（m）');
    mapBtn.addEventListener('click', () => dispatchAction('bookmap', mapBtn));
    const filmBtn = btn('film', '章节缩览');
    filmBtn.addEventListener('click', () => dispatchAction('film', filmBtn));
    /* 专注模式 = 收掉所有悬浮件（眼睛图标）；全屏 = 真占满屏幕（maximize）。
       两件事以前共用一个 maximize 图标，用户点出来发现只是藏了工具栏，
       自然认为「全屏没实现」。分开之后各自的行为都符合图标暗示。 */
    const fitBtn = btn('eye', '专注模式（f）');
    fitBtn.addEventListener('click', () => this.toggleBare());
    const fullBtn = btn('maximize', '全屏');
    fullBtn.addEventListener('click', () => void this.toggleFullscreen());
    const helpBtn = btn('help-circle', '帮助');
    helpBtn.addEventListener('click', () => dispatchAction('help', helpBtn));

    /* 手机顶栏只放得下 5 个：目录 / 搜索 / 书签 / 排版 / 更多。
       其余（并排、朗读、BookMap、章节缩览、专注、帮助）打 is-aux，
       由 mobile.css 在窄屏隐藏，桌面照旧全部显示——不用写两套 DOM。 */
    for (const b of [paraBtn, ttsBtn, mapBtn, filmBtn, fitBtn, fullBtn, helpBtn]) b.classList.add('is-aux');

    const moreBtn = btn('more-horizontal', '更多');
    moreBtn.classList.add('is-mobile-only');
    moreBtn.addEventListener('click', (ev) => this.openMoreMenu(ev));

    tool.append(tocBtn, markBtn, searchBtn, typeBtn, paraBtn, paraSel, ttsBtn, mapBtn, filmBtn, fitBtn, fullBtn, helpBtn, moreBtn);
    this.focusBtn = fitBtn;
    this.fullBtn = fullBtn;
    this.paraBtn = paraBtn;
    this.ttsBtn = ttsBtn;

    /* Esc 退出全屏由宿主处理，但图标要跟着换：全屏时是 minimize */
    this.registerDomEvent(document, 'fullscreenchange', () => this.syncFullIcon());

    /* 正文画布。分页模式由 foliate 自己撑满，所以去掉内边距 */
    const stage = el('div', 'bzs-stage');
    const pages = el('div', 'bzs-rpages is-hosted');
    pages.append(stage);

    /* 底栏：章节 — ‹ — 进度轨 — › — 百分比 — 剩余 */
    const chapter = el('span', 'chap');
    const track = el('div', 'track');
    const trackFill = el('i', 'fill');
    const trackKnob = el('i', 'knob');
    track.append(trackFill, trackKnob);
    const percent = el('b', 'pct', '0%');
    const remain = el('span', 'left', '');
    const prevBtn = el('button', 'nav', '‹') as HTMLButtonElement;
    prevBtn.type = 'button';
    prevBtn.setAttribute('aria-label', '上一页');
    const nextBtn = el('button', 'nav', '›') as HTMLButtonElement;
    nextBtn.type = 'button';
    nextBtn.setAttribute('aria-label', '下一页');

    const foot = el('div', 'bzs-rfoot');
    foot.append(chapter, prevBtn, track, nextBtn, percent, remain);

    root.append(tool, pages, foot);
    this.contentEl.appendChild(root);

    this.rootEl = root;
    this.stage = stage;
    this.pagesEl = pages;
    this.bookTitleEl = title;
    this.authorEl = author;
    this.chapterEl = chapter;
    this.percentEl = percent;
    this.remainEl = remain;
    this.trackFill = trackFill;
    this.trackKnob = trackKnob;

    const turn = (dir: 'prev' | 'next'): void => {
      this.stopTts();
      const p = dir === 'prev' ? this.host.prev() : this.host.next();
      void p.then(() => this.tracker.touch());
    };
    prevBtn.addEventListener('click', () => turn('prev'));
    nextBtn.addEventListener('click', () => turn('next'));

    /* 进度轨：点哪跳哪，按住拖跟手，松手才真跳（拖动时每帧重排整本会卡） */
    let dragging = false;
    const pctFromEvent = (ev: PointerEvent): number => {
      const r = track.getBoundingClientRect();
      return Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    };
    track.addEventListener('pointerdown', (ev) => {
      dragging = true;
      track.setPointerCapture(ev.pointerId);
      this.paintFoot(pctFromEvent(ev));
    });
    track.addEventListener('pointermove', (ev) => {
      if (dragging) this.paintFoot(pctFromEvent(ev));
    });
    track.addEventListener('pointerup', (ev) => {
      if (!dragging) return;
      dragging = false;
      void this.host.goToPercent(pctFromEvent(ev)).then(() => this.tracker.touch());
    });

    /* 点正文：移动端左右翻页（手机没有键盘，这是唯一的手势）；
       桌面端不翻页——鼠标点一下正文多半是选字、点链接、或者只是想
       把焦点挪回来，翻过去一页是很重的代价。桌面用 ← → 与两侧按钮。
       中间区两端都保留「收放工具栏」：那是一个明确的小动作，不会误触。 */
    this.tapHandler = (zone) => {
      if (zone === 'middle') {
        this.toggleBare();
        return;
      }
      if (!isMobileShell()) return;
      const nextIsLeft = this.host.contentVertical;
      if (zone === 'left') turn(nextIsLeft ? 'next' : 'prev');
      else turn(nextIsLeft ? 'prev' : 'next');
    };

    const onKey = (e: KeyboardEvent): void => {
      if (this.closed || !this.ownsKeyboard()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey) return;
      switch (e.key) {
        case 'Escape':
          root.classList.remove('is-focus');
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
          this.toggleBare();
          break;
        case 'b':
          e.preventDefault();
          this.toggleBookmark();
          break;
        case 't':
          e.preventDefault();
          dispatchAction('typography', typeBtn);
          break;
        case 'm':
          e.preventDefault();
          dispatchAction('bookmap', mapBtn);
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
        case '?':
          e.preventDefault();
          dispatchAction('help', helpBtn);
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
    this.registerEvent(this.api.app.workspace.on('css-change', () => this.applyChrome()));

    /* 初始状态：并排下拉先藏起来，避免空着一个白框 */
    this.syncToolState();
  }

  private toggleBare(): void {
    this.rootEl?.classList.toggle('is-focus');
    this.syncToolState();
  }

  /**
   * 真全屏：把阅读视图本身铺满整块屏幕（不是隐藏工具栏，也不是 F11）。
   *
   * 请求挂在 rootEl 上而不是 iframe：铺满之后顶/底悬浮栏仍在，
   * 还能翻页、还能退出；进了全屏如果只剩正文，用户第一件事就是找不到路出去。
   * 宿主或系统拒绝（移动端、某些 Linux 窗口管理器）时给一句人话，不静默。
   */
  private async toggleFullscreen(): Promise<void> {
    const root = this.rootEl;
    if (!root) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
    } catch {
      notify('这台设备上无法进入全屏', 'error');
    }
    this.syncFullIcon();
  }

  private syncFullIcon(): void {
    const b = this.fullBtn;
    if (!b) return;
    const on = !!document.fullscreenElement;
    setIcon(b, on ? 'minimize' : 'maximize');
    b.title = on ? '退出全屏' : '全屏';
    b.setAttribute('aria-label', b.title);
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
        this.toggleBare();
        break;
      case 'fullscreen':
        void this.toggleFullscreen();
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

  /** 三个开关按钮的「亮着」状态只有一处真相，别在各处手动加 class */
  private syncToolState(): void {
    const root = this.rootEl;
    this.paraBtn?.classList.toggle('on', this.parallelOn);
    this.ttsBtn?.classList.toggle('on', this.speaking);
    this.focusBtn?.classList.toggle('on', !!root?.classList.contains('is-focus'));
    root?.classList.toggle('is-parallel', this.parallelOn);
    const sel = root?.querySelector<HTMLSelectElement>('.bzs-rpara');
    if (sel) sel.style.display = this.parallelOn ? '' : 'none';
  }

  /* ─────────────────── 更多菜单（手机专用） ─────────────────── */

  /**
   * 手机顶栏放不下的动作，收进原生菜单。
   *
   * 为什么用 Obsidian 的 Menu 而不是自己画弹层：
   * 移动端宿主会把它渲染成底部动作面板，带安全区、带滚动手感、
   * 带返回键关闭；自造一个只会更像外挂，而且要多维护一套样式。
   *
   * 桌面不会走到这里（按钮本身 `display:none`），所以菜单里的项
   * 与顶栏图标是「同一批动作的两个入口」，不存在两套逻辑。
   */
  private openMoreMenu(ev: MouseEvent): void {
    const menu = new Menu();

    menu.addItem((i) =>
      i
        .setTitle(this.parallelOn ? '关闭并排对照' : '并排对照')
        .setIcon('columns-2')
        .onClick(() => void this.toggleParallel())
    );

    const other = this.parallelId ? this.api.repo.byId(this.parallelId) : null;
    menu.addItem((i) =>
      i
        .setTitle(`对照书籍：${other?.meta.title ?? '未选'}`)
        .setIcon('book')
        .onClick(() => this.openParallelPicker(ev))
    );

    menu.addItem((i) =>
      i
        .setTitle(this.speaking ? '停止朗读' : '朗读')
        .setIcon('volume-2')
        .onClick(() => this.toggleTts())
    );

    menu.addSeparator();

    menu.addItem((i) =>
      i.setTitle('Book Map').setIcon('map').onClick(() => dispatchAction('bookmap', this.rootEl ?? document.body))
    );
    menu.addItem((i) =>
      i.setTitle('章节缩览').setIcon('film').onClick(() => dispatchAction('film', this.rootEl ?? document.body))
    );
    menu.addItem((i) =>
      i
        .setTitle(this.rootEl?.classList.contains('is-focus') ? '退出专注' : '专注模式')
        .setIcon('maximize')
        .onClick(() => this.toggleBare())
    );
    menu.addItem((i) =>
      i.setTitle('帮助').setIcon('help-circle').onClick(() => dispatchAction('help', this.rootEl ?? document.body))
    );

    menu.showAtMouseEvent(ev);
  }

  /** 二级菜单：选对照的另一本书。最多列 12 本，再多让用户先筛书架。 */
  private openParallelPicker(ev: MouseEvent): void {
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
    menu.showAtPosition({ x: ev.clientX, y: ev.clientY });
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
          if (zone === 'middle') {
            this.toggleBare();
            return;
          }
          const vertical = host2.contentVertical;
          const toNext = zone === 'left' ? vertical : !vertical;
          void (toNext ? host2.next() : host2.prev());
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

  private hideSelbar(): void {
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

    const rootRect = root.getBoundingClientRect();
    bar.style.left = `${info.anchor.left - rootRect.left + info.anchor.width / 2}px`;
    bar.style.top = `${info.anchor.top - rootRect.top - 8}px`;
    root.appendChild(bar);
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
    if (this.bookTitleEl) {
      this.bookTitleEl.textContent = book.meta.title;
      this.bookTitleEl.title = book.meta.title;
    }
    if (this.authorEl) this.authorEl.textContent = book.meta.author || '';
    this.updateFoot(book.reading.position.percent || 0, 0);
    if (this.chapterEl && book.reading.position.chapterTitle) {
      this.chapterEl.textContent = book.reading.position.chapterTitle;
    }

    /* 手机上解一本大书要好几秒，这段时间是空的——先说清楚在干什么，
       别让人以为点错了（host.mount 建好视图时会把这个占位清掉） */
    this.renderLoading(book.meta.title);

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
        onSelect: (info) => {
          if (!info) {
            // 选区塌了只收色点条；正在写想法时不受影响（弹层在 body 上）
            if (this.suppressSelClear) {
              this.suppressSelClear = false;
              return;
            }
            this.hideSelbar();
            return;
          }
          this.selection = info;
          this.selectionAt = Date.now();
          this.setSel(info);
          /* 手机上「选中即划」：长按选完直接按上次的颜色落下一条，
             工具条退居二线只管改色/写想法。桌面仍保留「选色才落笔」，
             因为鼠标拖选常常只是复制，不该往书里存东西。 */
          const auto = isMobileShell()
            ? createMark(getShellState().pen, { silent: true }) ?? undefined
            : undefined;
          if (auto) {
            // 划完就收掉系统选区：留下的该是一道线，不是一片蓝
            this.suppressSelClear = true;
            this.host.clearSelection();
          }
          this.showSelbar(info, auto);
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
          if (this.bookTitleEl) {
            this.bookTitleEl.textContent = book.meta.title;
            this.bookTitleEl.title = book.meta.title;
          }
          if (this.authorEl) this.authorEl.textContent = book.meta.author || '';
          this.publishToc();
          this.syncTabTitle();
          this.api.store.touch();
          notifyShell();
        },
      });
      await this.host.start(
        this.pendingCfi || book.reading.position.cfi,
        this.pendingCfi ? 0 : book.reading.position.percent || 0,
      );
      this.pendingCfi = '';
      this.tracker.begin(book.reading.position.percent);
      if (!book.reading.stats.startReadTime) book.reading.stats.startReadTime = Date.now();
      this.api.store.touch();
      this.updateFoot(book.reading.position.percent || 0, 0);
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

  private paintFoot(p: number): void {
    const pct = Math.max(0, Math.min(1, p));
    if (this.percentEl) this.percentEl.textContent = `${Math.round(pct * 100)}%`;
    if (this.trackFill) this.trackFill.style.width = `${pct * 100}%`;
    if (this.trackKnob) this.trackKnob.style.left = `${pct * 100}%`;
  }

  private updateFoot(percent: number, remainingSeconds: number): void {
    this.lastRemaining = remainingSeconds;
    this.paintFoot(percent);
    if (this.remainEl) {
      this.remainEl.textContent = remainingSeconds > 60 ? `约剩 ${Math.round(remainingSeconds / 60)} 分钟` : '';
    }
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
      /* 读完那一刻弹一张卡。已经打过分的重读不再打扰——
         判断放在这里而不是弹层里，是因为弹层不该知道「为什么弹」。 */
      if (!book.reading.stats.rating) {
        setShellState({ overlay: { kind: 'finish', bookId: book.id } });
      }
    }
    book.updatedAt = Date.now();
    if (info.chapterTitle && this.chapterEl) {
      this.chapterEl.textContent = info.chapterTitle;
      patchToc({ activeLabel: info.chapterTitle });
    }
    this.updateFoot(info.percent, info.remainingSeconds);
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

  /** 点中已有划线：交给全局弹层层显示标注卡 */
  private openHighlight(info: { cfiRange: string; anchor: { left: number; top: number } }): void {
    const book = this.book;
    if (!book) return;
    const h = findHighlight(book, info.cfiRange);
    if (!h) return;
    this.hideSelbar();
    openOverlay({ kind: 'hlcard', markId: h.id, bookId: book.id, anchor: info.anchor });
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
    if (!can('footnote') || this.prefs.footnote === 'jump') {
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
    await this.api.store.flush().catch(() => undefined);
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

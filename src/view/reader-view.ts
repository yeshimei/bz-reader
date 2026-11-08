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
import { EngineHost, OpenCancelledError, type FootnoteInfo, type Rect, type RelocateInfo, type SelectionInfo } from '../engine/host';
import { normalizePrefs, pickPrefs, type ReaderPrefs } from '../data/prefs';
import { recordPosition, type ReaderBook } from '../data/schema';
import type { LinkTarget } from '../data/deeplink';
import { parseWikilinkHref } from '../data/wikilink';
import {
  HIGHLIGHT_COLORS,
  colorCss,
  highlightsOf,
  findHighlight,
  toggleBookmark,
} from '../data/notes';
import { ActivityTracker, attachChapter } from '../engine/activity';
import { applyEngineMeta } from '../data/book-meta';
import { coverPathOf, ensureCoverFromFoliate } from '../data/cover';
import { speak, speakLang, type SpeakHandle } from '../core/speak';
import { notify } from '../core/notice';
import { localeTag, t } from '../i18n';
import { isMobileEnv, isMobileShell } from '../core/mobile';
import { envSummary, probeBlobIframe } from '../core/diagnose';
import { el, setHtml } from '../ui/dom';
import { setToc, clearToc, getToc, patchToc } from './toc-state';
import {
  headerActionLabel,
  headerActionSpec,
  headerActionsFor,
  headerActive,
  type HeaderActionId,
} from './header-actions';
import { planHeaderVisibility, roleOf } from './header-layout';
import { faultHtml, loadingHtml, type FaultDiagLine } from './reader-fault';
import { SELECTION_ACTS, planToolbarHit, toggleMoreMenu, toolbarHtml } from '../shell/text-toolbar';
import { can } from '../data/entitlement';
import { bzEntryReady } from '../data/bz-bridge';
import { VIEW_TYPE_TOC } from './side-view';

/* 注意：本类为了给 Obsidian 存 view 状态，重写了 getState()。
   所以在类内部直接写 getState() 拿到的是**视图自己的** {bookId}，
   不是壳层状态。壳层那套必须用下面这两个别名，否则会静默拿错对象
   （表现：主题不跟随、侧栏与排版面板以为没打开书）。 */
import {
  closeOverlay,
  dismissesOnSelect,
  getState as getShellState,
  opensTextPanel,
  setState as setShellState,
  subscribe,
  notify as notifyShell,
  type OverlayKind,
} from '../shell/state';
import { openOverlay } from '../shell/state';
import { tapIntent } from './tap-intent';
import { pagingKeyAction, type PagingDirection } from './paging-key';
import { tapDirection, type TapSide } from './tap-direction';
import { immersiveExitHint, updateImmersiveHolders } from './immersive';
import { navBottomGap } from './bottom-gap';
import { destroyQuietly } from '../core/safe-destroy';
import { anchoredPlacement } from '../shell/anchored-style';
import { RT, onNotesChanged } from '../shell/runtime';
import { addCheckin } from '../shell/checkin';
import { toTextHits, type TextHit } from '../shell/text-search';
import { shouldNotifyRelocate } from './relocate-notify';
import { getShellSource } from '../shell/source';
import { dispatchAction, requireCap } from '../shell/actions';

export const VIEW_TYPE_READER = 'bzr-reader-view';

/** 命令面板可触发的阅读动作（plugin.ts 注册命令时用这个类型） */
export type ReaderCommand = 'next' | 'prev' | 'focus' | 'fullscreen' | 'bookmark' | 'typography' | 'bookmap' | 'tts' | 'help';

/** 读到 99% 以上就算读完，不必真翻到最后一页的最后一个字 */
const COMPLETE_THRESHOLD = 0.99;

/**
 * 所有处于沉浸态的阅读视图。
 *
 * body 上的 class 是全局的，视图是多实例的：两个 tab 各开一本书时，关掉 A
 * 不能把 B 的沉浸一起摘掉（A-27）。集合非空才保留 class，onClose 只释放
 * 自己这一份。
 */
const immersiveHolders = new Set<ReaderView>();

/**
 * 真机诊断角标开关：默认关闭。
 * 以前没有开关，每一台手机的每一页左下角都挂着版本号与点按计数。
 * 排查时在控制台执行 `localStorage['bz-reader:debug-probe']='1'` 再重开书。
 */
function probeEnabled(): boolean {
  try {
    return window.localStorage?.getItem('bz-reader:debug-probe') === '1';
  } catch {
    return false;
  }
}

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
  /** resize 监听只挂一次（重试时不重复挂，P3-18） */
  private resizeBound = false;
  private closed = false;
  /** 正文搜索的代号：换词、关书都会 +1，旧一轮的 await 回来一看就知道作废了 */
  private searchGen = 0;
  /**
   * 本次会话里用户是否真的翻过页（B14）。
   *
   * 打开一本书会先来一次「定位到上次读到的地方」的 relocate；那次不是
   * 「读到了这里」，而是「上次读到过这里」。把它当进度写下去，就会出现
   * 「在电脑上点开一本没读完的书 → 手机上的进度被盖回去」。
   */
  private userTurned = false;
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
  /** 上次 notifyShell 的时间与百分比（翻页节流，见 view/relocate-notify.ts） */
  private lastNotifyAt = 0;
  private lastNotifiedPct = 0;
  private lastTurnAt = 0;
  private lastKeyBefore = '';
  private lastKeyAfter = '';
  /** 构建时注入（manifest 版本 + 时间戳），见 esbuild.config.mjs 的 __BZ_BUILD_TAG__ */
  private static readonly BUILD_TAG = __BZ_BUILD_TAG__;

  /* 并排对照：副卷自己一套引擎，主卷的进度与标注一概不受影响 */
  private parallelOn = false;
  private parallelId = '';
  private host2: EngineHost | null = null;
  /** 副卷正在开（mount + start 那一段）：这段时间拒绝第二次开启 */
  private parallelOpening = false;
  private stage2: HTMLElement | null = null;

  /* 朗读：交给系统语音，不额外引依赖。翻页即停，避免「翻过去了还在念上一页」 */
  private speaking = false;
  private voice: SpeakHandle | null = null;

  /* 每日打卡：按 tracker 的已读秒数增量记账。
     以前只在关 tab 时 addCheckin 一次——开着 tab 读一整天，统计页永远 0。 */
  private checkinTimer: number | null = null;
  private lastCheckinElapsed = 0;

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
  private lastCfi = '';
  private lastPercent = 0;
  private lastChapterTitle = '';
  /** 上一次壳层浮层的种类：用来判断「刚打开文字面板」那一下（见 opensTextPanel） */
  private lastOverlayKind: OverlayKind | '' = '';
  private offShell: (() => void) | null = null;
  private offNotes: (() => void) | null = null;
  private lastTapAt = 0;

  constructor(leaf: WorkspaceLeaf, api: ReaderHostApi) {
    super(leaf);
    this.api = api;
    this.host = new EngineHost(api.app);
    /* 按平台取：桌面 prefsDesktop、手机 prefsMobile，新槽空着才回落旧的全局
       prefs。直接读 `store.get().prefs` 会永远拿到升级前那一份——手机上调好的
       字号行距都写在自己的槽里，重启后打开书版式就回到默认。 */
    this.prefs = pickPrefs(api.store.get(), isMobileEnv());
  }

  getViewType(): string {
    return VIEW_TYPE_READER;
  }

  getDisplayText(): string {
    /* 书还没解析出来时留空，不写「阅读」：宿主会把它同时放进 tab 与头栏，
       而头栏左边已经有书名（或本来就不该多一个词）。 */
    return this.book?.meta.title || '';
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
    const s = (state ?? {}) as { bookId?: string; cfi?: string; file?: string; subpath?: string };
    if (typeof s.bookId === 'string') this.bookId = s.bookId;
    else if (typeof s.file === 'string' && s.file) {
      /* 从 `[[书.epub]]` 点进来：Obsidian 给的是文件路径，不是 bookId */
      const book = this.api.repo.byPath(s.file);
      if (book) this.bookId = book.id;
    }
    /* 带子路径进来（Live Preview 里点双链）：能解出 CFI 就顺手定位一次，
       解不出就落回上次位置——总比从书开头读起强。 */
    if (typeof s.subpath === 'string' && s.subpath) {
      const parsed = parseWikilinkHref(`${s.file ?? ''}${s.subpath}`);
      if (parsed?.target.cfi) this.pendingCfi = parsed.target.cfi;
    }
    if (typeof s.cfi === 'string' && s.cfi) this.pendingCfi = s.cfi;
    await super.setState(state, result);
    await this.maybeMount();
  }

  jumpTo(cfi: string): void {
    if (!cfi) return;
    /* 判 `mounted` 而不是 `book`（P1-13）：`book` 在 `await host.mount()` **之前**
       就被赋值了，那几秒里引擎的 `view` 还是 null，`goToCfi` 对 undefined
       也返回 'ok'——于是「点了书签什么都没发生，还当成功返回」。
       没挂好就把 CFI 记下来，mount 完由 start() 用 pendingCfi 定位。 */
    if (this.mounted) {
      /* 导航完成后再闪：pulseAt 要拿目标章节的覆盖层，章节还没挂好就闪不出来 */
      void this.host.goToCfi(cfi).then((ok) => {
        if (ok) void this.host.pulseAt(cfi);
      });
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
    /* 书还在解包时不要直接判 false（P1-13）：那会让深链跳转误报
       「没找到原句」，其实只是还没挂好。等一次 mount 再说。 */
    if (!this.mounted) await this.maybeMount();
    if (!this.mounted) return false;

    if (t.cfi) {
      /* goToCfi 现在会返回「是否真的完成」：以前它永不抛，这里的 catch 是死代码，
         CFI 失效时也报成功，后面的碎片搜索与百分比兜底永远不执行。 */
      const ok = await this.host.goToCfi(t.cfi);
      if (ok) {
        this.tracker.touch();
        /* 跳转是无声的：闪一下，用户才知道落到哪一句 */
        void this.host.pulseAt(t.cfi);
        return true;
      }
    }

    if (t.text) {
      try {
        const hits = await this.host.search(t.text);
        const cfi = hits.find((h) => !!h.cfi)?.cfi;
        if (cfi) {
          const ok = await this.host.goToCfi(cfi);
          if (ok) {
            this.tracker.touch();
            void this.host.pulseAt(cfi);
            return true;
          }
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
    /* 副卷收尾失败不能把 settle 卡住（A-29）：这一段会话的阅读时长与
       打卡只在 settle 里结算，early-return 等于把它们丢掉。 */
    await this.closeParallel().catch(() => undefined);
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

    /* 手机底栏浮在内容上：量一次它压住多少。第一次量时布局可能还没落定，
       再补一帧——量到 0 也不会多留白（见 syncBottomGap）。 */
    this.syncBottomGap();
    window.requestAnimationFrame(() => this.syncBottomGap());

    /* 点正文：移动端上下分区翻页；两指同时按切换沉浸（判定在引擎侧）。
       翻页延后由 host 的队列保证，这里只管按区定方向。 */
    this.tapHandler = (zone, info) => {
      /* 这一下该干什么，全交给 tapIntent：划词条 > 浮层 > 翻页。
         iframe 里的点按不冒泡到宿主文档，document 级的收口收不到，
         所以「先收条子、再关浮层、最后才翻页」只能在这里兜住。 */
      const intent = tapIntent({
        selbar: !!this.selbar,
        overlayKind: getShellState().overlay?.kind,
        mobile: isMobileShell(),
      });
      if (intent !== 'turn') {
        /* 条子与文本面板是一套：点正文一次收干净，别让面板留在空处 */
        if (intent === 'dismiss-selbar') {
          this.hideSelbar();
          if (getShellState().overlay) closeOverlay();
        }
        if (intent === 'dismiss-overlay') closeOverlay();
        this.renderProbe();
        return;
      }
      const now = Date.now();
      /* 滚动模式（P2-02）：滚轮/触控板已经在滚，点一下再跳一屏会很吓人。
         选字、点链接、关浮层仍然照常，只是不再把点击当翻页。 */
      if (this.prefs.flow === 'scroll') {
        this.renderProbe();
        return;
      }
      this.tapCount += 1;
      this.lastZone = zone === 'prev' ? 'U' : 'D';
      /* 连点就连续翻：去重已经在引擎侧按手势做过，这里不再压时间窗 */
      this.lastTurnAt = now;
      /* 桌面也支持点击翻页（P2-10）：以前这里直接 return，桌面上点一下正文
         什么都不发生，只能滚轮或键盘——很多人第一次用会以为插件坏了。
         桌面是横向分页，所以按**左右**分区；移动端仍按上下（AGENTS.md 的约定，
         手指在手机上上下点比左右点自然）。
         方向本身交给 tapDirection：竖排 / RTL 的左右反转只有那一份规则，
         键盘（pagingKeyAction）也走它。 */
      const dirCtx = { vertical: this.host.contentVertical, rtl: this.host.contentRtl };
      const dir: PagingDirection = isMobileShell()
        ? tapDirection(zone === 'prev' ? 'top' : 'bottom', dirCtx)
        : (() => {
            const box = this.stage?.getBoundingClientRect();
            /* info.screenX 是**屏幕**坐标，getBoundingClientRect 是**视口**坐标：
               直接比，在窗口不最大化时左右会判反（AGENTS.md 的坐标约定）。 */
            const winX = typeof window !== 'undefined' ? window.screenX || 0 : 0;
            const sx = (info?.screenX ?? 0) - winX;
            /* 拿不到布局就别改判：沿用引擎按上下算出来的方向 */
            if (!box || !box.width) return zone;
            const side: TapSide = sx < box.left + box.width / 2 ? 'left' : 'right';
            return tapDirection(side, dirCtx);
          })();
      this.lastKeyBefore = this.host.pageKey;
      this.lastKeyAfter = '';
      /* 只翻一次：turn() 和这里各发一次的话，一按就是两页 */
      const p = this.userNavigate(dir);
      void p.then(() => {
        this.lastKeyAfter = this.host.pageKey;
        this.tracker.touch();
        this.renderProbe();
      });
      this.renderProbe();
    };

    const onKey = (e: KeyboardEvent): void => this.handleKey(e);
    document.addEventListener('keydown', onKey, true);
    /* 底栏在键盘弹起 / 沉浸切换时会挪位置，跟着重量一次 */
    const gapSync = (): void => this.syncBottomGap();
    window.addEventListener('resize', gapSync);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', gapSync);
    this.teardown = () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', gapSync);
      vv?.removeEventListener('resize', gapSync);
    };

    /* 皮肤跟着壳层状态走：跟随宿主时宿主换主题，这里也重画。
       顺带在搜索浮层关掉时清掉书里的搜索高亮——`clearSearch()` 以前
       全仓没有调用方，搜过一次之后黄色高亮就永远留在正文里（P3-20）。 */
    const syncTheme = (): void => {
      this.applyChrome();
      this.syncSearchHighlight();
      this.noteTextPanel();
    };
    this.offShell = subscribe(syncTheme);
    this.offNotes = onNotesChanged(() => this.refreshAfterNotesChange());
    /* 宿主换主题：壳层的强调色跟着换，书页的底色/字色也要重注入——
       只改 data-bzaccent 的话，深色模式下书页还是那张白纸。 */
    this.registerEvent(
      this.api.app.workspace.on('css-change', () => this.onCssChange()),
    );
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
    /* 标记「书名已经由我们画了」：宿主原生的 .view-header-title 要收起来。
       以前只靠 `body.is-mobile` 隐藏标题容器——桌面开 force-mobile 验收时
       两个书名会同时出现（左边「红楼梦」、中间「阅读」）。
       类挂在 leaf-content 上，且选择器带 data-type：切到别的视图后自动失效。 */
    header.closest('.workspace-leaf-content')?.classList.add('bzr-head-title-on');
    if (!this.headTitleEl || !this.headTitleEl.isConnected) {
      const el0 = createDiv();
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

  /**
   * 桌面：书名顶上原生标题。
   *
   * 书还没解析出来时把标题**留空**，不写「阅读」——那是宿主的兜底文案，
   * 在头栏里等于多一个没有信息量的词（真机反馈：左边已经有书名了）。
   * 也不再调 updateHeader()：它会用 getDisplayText() 把刚写进去的书名盖回
   * 「阅读」，这正是以前「改了标题又变回去」的原因。
   */
  private applyHeaderTitle(header: HTMLElement): void {
    const title = this.book?.meta.title || '';
    const el0 = header.querySelector<HTMLElement>('.view-header-title');
    if (!el0 || el0.textContent === title) return;
    el0.textContent = title;
    el0.setAttribute('title', title);
  }

  /**
   * 头栏动作。
   *
   * 手机 3 个（目录/搜索/书签），插在宿主 ⋮ 所在容器的开头，⋮ 保持在最右；
   * 其他插件（Commander 等）的图标由 CSS 在阅读时隐藏，关掉书自动恢复。
   * 桌面 5 个，走 .view-actions。
   *
   * 数量只看**真实承载**（isMobileEnv）：桌面验收时开 force-mobile 只是把
   * 布局按手机跑，不该连「放得下却折起来」也一起复制过去。
   */
  private ensureHeaderActions(header: HTMLElement): void {
    const mobile = isMobileEnv();
    const box =
      header.querySelector<HTMLElement>('.view-actions') ??
      header.querySelector<HTMLElement>('.nav-buttons-container') ??
      header;
    if (!box) return;

    /* 从数据源现读，不用 this.prefs：插件热重载或后台 tab 会错过 updatePrefs，
       视图里那份副本就停在旧配置，隐藏 / 排序看起来「没生效」。 */
    const prefs = pickPrefs(this.api.store.get(), mobile);

    const run: Record<string, (ev?: MouseEvent) => void> = {
      toc: () => this.api.openTocSidebar('toc'),
      search: () => dispatchAction('search', this.rootEl ?? document.body),
      mark: () => this.toggleBookmark(),
      type: () => dispatchAction('typography', this.rootEl ?? document.body),
      para: () => void this.toggleParallel(),
      paraBook: (ev) => this.openParallelPicker(ev),
      tts: () => this.toggleTts(),
      bookmap: () => dispatchAction('bookmap', this.rootEl ?? document.body),
      immersive: () => this.toggleImmersive(),
      library: () => getShellSource()?.openStudy('library'),
    };
    const spec = headerActionsFor(mobile, { order: prefs.headerOrder, hidden: prefs.headerHidden }).map((id) => ({
      ...headerActionSpec(id),
      run: run[id],
    }));
    const ids = spec.map((s) => s.id);

    /* 收走不该露的按钮：按 DOM 查，不只按 headerEls——视图复用或热重载时，
       上一版挂的按钮还留在头栏里，而 Map 已经是新的（空的），按 Map 删不到。 */
    for (const el of Array.from(box.querySelectorAll<HTMLElement>('[data-bzr-action]'))) {
      const id = el.dataset.bzrAction || '';
      if (!ids.includes(id as HeaderActionId)) el.remove();
    }
    /* 上一版自建的 ⋮（只有 class、没有 data-bzr-action）也要收干净 */
    for (const el of Array.from(box.querySelectorAll<HTMLElement>('.bzr-more'))) el.remove();
    for (const id of [...this.headerEls.keys()]) {
      if (!ids.includes(id as HeaderActionId)) this.headerEls.delete(id);
    }

    const fresh: HTMLElement[] = [];
    for (const item of spec) {
      const found = box.querySelector<HTMLElement>(`[data-bzr-action="${item.id}"]`);
      if (found) {
        this.headerEls.set(item.id, found);
        continue;
      }
      const btn = createDiv();
      btn.className = 'clickable-icon view-action bzr-action';
      btn.dataset.bzrAction = item.id;
      btn.setAttribute('aria-label', item.label);
      btn.setAttribute('aria-label-position', 'top');
      setIcon(btn, item.icon);
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        item.run(ev);
      });
      this.headerEls.set(item.id, btn);
      fresh.push(btn);
    }

    /* 收起的图标不另建菜单：宿主最右侧的 ⋮ 里本来就有这十项
       （见 onPaneMenu），再挂一颗自己的 ⋮ 只会变成两个入口。 */
    if (fresh.length) box.prepend(...fresh);
    this.trimHeaderActions(box, spec.length);
  }

  /**
   * 头栏右侧：我们的最多 3 颗 + 宿主的 ⋮，别人的图标一律收起来。
   *
   * 以前这段靠「最右那颗就是 ⋮」猜位置，真机上装了会往头栏塞图标的插件之后
   * 整套假设失效：别人有一颗排在 ⋮ 后面，真 ⋮ 就被当成别人藏掉、别人那颗被
   * 当成 ⋮ 留下；再加 styles.css 里那条 `:last-child { display:grid !important }`，
   * inline 的 display:none 压不过它，最右那颗谁也藏不掉。用户看到的正是
   * 「三个动作露了、别人的图标还在、⋮ 没了」。
   *
   * 现在按身份分类（见 view/header-layout.ts），不再按位置猜，也不再
   * 「先扣别人的名额再裁自己的」。
   */
  private trimHeaderActions(box: HTMLElement, maxOurs: number): void {
    /* box 可能是兜底选到的 .view-header 本体，那样扫下去会把宿主的
       侧栏切换 / 返回前进一起收掉。只在真正的动作容器里动手。 */
    const scope = box.closest('.view-actions, .nav-buttons-container')
      ? box
      : box.querySelector<HTMLElement>('.view-actions, .nav-buttons-container');
    if (!scope) return;

    const items = Array.from(scope.querySelectorAll<HTMLElement>('.clickable-icon'));
    if (!items.length) return;

    const roles = items.map((el) => roleOf(el));
    /* 一颗 ⋮ 都没认出来（图标名换过、或主题重画了 svg）时的兜底：
       · 别人只剩一颗 → 那它只能是 ⋮，留着；
       · 别人不止一颗 → 分不清哪颗是 ⋮，就一颗都不藏。宁可别人的图标
         多留两颗，也不能把 ⋮ 藏掉——阅读的全部分组动作都在它里面。 */
    let hideOthers = true;
    if (!roles.includes('more')) {
      const others = roles
        .map((role, i) => (role === 'other' ? i : -1))
        .filter((i) => i >= 0);
      if (others.length === 1) roles[others[0]!] = 'more';
      else if (others.length > 1) hideOthers = false;
    }

    const show = planHeaderVisibility(roles, maxOurs, hideOthers);
    items.forEach((el, i) => {
      if (show[i]) el.style.removeProperty('display');
      /* inline + important：既有 CSS 里对别人图标的规则（含主题/别的插件
         自己的 !important）也得让路，否则「该藏的藏不掉」会再回来。 */
      else el.style.setProperty('display', 'none', 'important');
    });

    /* scope 之外还有：有些插件不往 .view-actions 里塞，而是直接挂在
       .view-header 上或自己包一层容器。这里一并清掉，但跳过
       .view-header-nav-buttons——那里是宿主的侧栏切换 / 返回前进，
       藏了用户就回不去了。认不出 ⋮ 时（hideOthers=false）一颗都不动。 */
    if (!hideOthers) return;
    const header = scope.closest('.view-header');
    for (const el of Array.from(header?.querySelectorAll<HTMLElement>('.clickable-icon') ?? [])) {
      if (items.includes(el) || el.closest('.view-header-nav-buttons')) continue;
      if (roleOf(el) === 'other') el.style.setProperty('display', 'none', 'important');
    }
  }

  /** 宿主换主题（`css-change`）：主卷与副卷是两份文档，都要重新注入变量 */
  private onCssChange(): void {
    this.applyChrome();
    this.host.refreshTheme();
    /* 副卷也要跟着换：只刷新主卷的话，并排右半边还是旧底色 */
    this.host2?.refreshTheme();
  }

  /** 真机角标（默认关闭，排查时 `localStorage['bz-reader:debug-probe']='1'`） */
  private renderProbe(): void {
    if (!isMobileShell() || !this.rootEl || !probeEnabled()) {
      /* 关掉后把已经挂上去的角标收走，不留一个空 div 在正文上 */
      if (this.probeEl) {
        this.probeEl.remove();
        this.probeEl = null;
      }
      return;
    }
    if (!this.probeEl) {
      const box = createDiv();
      box.className = 'bzr-probe';
      this.rootEl.appendChild(box);
      this.probeEl = box;
    }
    const header = this.containerEl.querySelector<HTMLElement>('.view-header');
    const title = header?.querySelector<HTMLElement>('.view-header-title');
    const acts = header?.querySelectorAll('.bzr-action').length ?? 0;
    /* pg = 页面里跑的 paginator 是不是打过「点按不吸附」补丁的那一版 */
    const pg = (window as unknown as { __bzrPaginatorGuard?: boolean }).__bzrPaginatorGuard;
    this.probeEl.textContent =
      `bz ${ReaderView.BUILD_TAG} · pg${pg ? '✓' : '✗'} hdr${header ? '✓' : '✗'} ttl${title ? '✓' : '✗'} act${acts}` +
      ` · tap${this.tapCount}${this.lastZone} ${this.lastKeyBefore || '-'}→${this.lastKeyAfter || '…'}` +
      ` ${Math.round(this.lastPct * 100)}%`;
  }

  /** 沉浸：藏掉宿主的上头栏与下导航条，再按一次还原 */
  private toggleImmersive(force?: boolean): void {
    const wasImmersive = this.immersive;
    this.immersive = force ?? !this.immersive;
    /* 头栏一藏，退出方式就没人提示了，所以进入时说一句：桌面 ESC、手机
       两指轻按正文。所有入口（右上角图标 / ⋮ / 命令 / 快捷键 / 双指）都走
       这里，行为一致；退出与关书不弹，判据在沉浸式模块里。
       5 秒够读完一句话；notify 自带 800ms 同文案去重，连按不会糊屏。 */
    const hint = immersiveExitHint(isMobileEnv(), wasImmersive, this.immersive);
    if (hint) {
      notify(
        t(hint === 'desktop' ? 'notice.immersive.exitDesktop' : 'notice.immersive.exitMobile'),
        'info',
        5000,
      );
    }
    /* 只释放自己这一份持有（A-27）：另一个阅读 tab 还沉浸时 class 必须留着 */
    const stillImmersive = updateImmersiveHolders(immersiveHolders, this, this.immersive);
    document.body.classList.toggle('bzr-immersive', stillImmersive);
    /* 底栏藏起来了：再量一次「底栏压住多少」，全屏时那一段应该是 0。
       不重量的话，退出全屏会少一截、进入全屏会多一截。 */
    window.requestAnimationFrame(() => this.syncBottomGap());
  }

  /**
   * 命令面板入口。
   *
   * 键盘上的每个动作都在 plugin 里注册成了一条命令（用户可以去 Obsidian
   * 「快捷键」里改键），命令最终落回这里——与按键走同一套实现，
   * 免得「按 f 有用、点命令没用」这种两套行为。
   */
  /**
   * 搜索浮层关掉时清书里的高亮（P3-20）。
   *
   * `host.clearSearch()` 以前全仓没有调用方：搜过一次之后，那些黄色高亮
   * 就永远留在正文里，翻到哪章都在，用户以为是自己画的线。
   */
  private searchOpen = false;

  private syncSearchHighlight(): void {
    const open = getShellState().overlay?.kind === 'search';
    if (this.searchOpen && !open) this.host.clearSearch();
    this.searchOpen = open;
  }

  /**
   * 想法 / 书摘 / AI 一开，就把书里的选区收掉。
   *
   * 手机上的选区不是一条色带那么安静：系统会一直挂着两端手柄和
   * 「复制 / 全选 / 网页搜索」菜单，而面板正好开在它们下面——
   * 手柄压在卡片角上，菜单直接盖住引文（截图见 S11 真机）。
   *
   * 只清书里的选区：面板自己的输入框、面板里选中的字都不受影响。
   * 桌面不清——鼠标选的字没有手柄也没有系统菜单，留着反而方便对照原文。
   */
  private noteTextPanel(): void {
    const next = getShellState().overlay?.kind;
    const opened = opensTextPanel(this.lastOverlayKind || undefined, next);
    this.lastOverlayKind = next ?? '';
    if (!opened || !isMobileShell()) return;
    this.host.clearSelection();
  }

  /**
   * 手机底栏压住正文时，给阅读区补一块同样高的留白。
   *
   * Obsidian 移动端的导航栏（`< > 🔍 + ☰`）是**浮在内容上**的：阅读区一直
   * 伸到屏幕最底，分页按容器高度排，排满的那一页最后一行就压在栏下。
   *
   * 量的是栏**自己的高度**。以前量「阅读区底边 − 栏顶边」，两个坐标不在
   * 同一个参照里，真机上动不动就量出一整截，底部凭空多出上百像素——
   * 用户的原话是「固定下边距还是太多了」。
   *
   * 量到 0 就把变量摘掉，绝不凭空调白——桌面端、栏被隐藏时都不该多一刀。
   */
  private syncBottomGap(): void {
    const root = this.rootEl;
    if (!root) return;
    if (!isMobileShell()) {
      root.style.removeProperty('--bzr-bottom-gap');
      return;
    }
    const nav = document.querySelector<HTMLElement>('.mobile-navbar');
    /* 全屏（沉浸）时导航栏常常只是 display:none，rect 高度是 0 → 不让位 */
    const gap = navBottomGap(nav?.getBoundingClientRect().height);
    if (gap > 0) root.style.setProperty('--bzr-bottom-gap', `${gap}px`);
    else root.style.removeProperty('--bzr-bottom-gap');
  }

  /**
   * 搜这一本的正文，返回带 CFI 的命中（新功能「书内搜索的命中定位」）。
   *
   * 以前 `host.search()` 只在深链兜底里用过，界面上没有入口：搜索浮层
   * 只能搜「已建索引」的书名/作者/标注，正文里的字搜不到。
   */
  async searchText(kw: string): Promise<TextHit[]> {
    if (!this.mounted) await this.maybeMount();
    if (!this.mounted) return [];
    /* 每次搜索领一个号（B5）：全书搜索要逐章扫，几秒很正常。
       await 回来时书可能已经关了、或者用户又搜了一个词——
       把上一轮的结果画上去，轻则列表闪回旧词，重则往已销毁的视图里塞高亮。 */
    const gen = ++this.searchGen;
    const stale = (): boolean => gen !== this.searchGen || this.closed || !this.mounted;
    const hits = await this.host.search(kw, { shouldStop: stale });
    if (stale()) return [];
    /* 归一放在纯函数里：命中可能带重复 CFI、空 CFI、{pre,match,post} 形状 */
    return toTextHits(hits);
  }

  /**
   * 键盘处理：主窗口 document 与正文 iframe 共用同一份规则。
   *
   * 2026-11-04 起**不再硬编码单字母**（P2-03）：`f/b/t/m/s/r/g` 全部交给
   * Obsidian 的快捷键系统（`addCommand` 里已注册「阅读：专注模式」等），
   * 用户能改、能关。以前同一个键被两条路径处理：把「专注模式」改到别的键，
   * 按 `f` 仍然生效；把别的命令绑到 `f`，沉浸会切两次——等于没反应。
   *
   * 留在硬编码里的只有翻页与 Esc：它们没有「改成别的键」的需求，
   * 而且 Obsidian 几乎不占用方向键 / 空格 / PageUp / PageDown。
   *
   * 带 Ctrl / Cmd / Alt 的一律放行：那些是宿主与系统的快捷键。
   */
  handleKey(e: KeyboardEvent): void {
    if (this.closed || !this.ownsKeyboard()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (this.immersive) this.toggleImmersive(false);
      this.hideSelbar();
      return;
    }
    /* 滚动模式（A-26）：Escape 之后就不再接管键盘——方向键 / 空格交给
       foliate 的滚动容器。以前这里照旧 preventDefault + 翻页，滚到一半
       按一下方向键就整页跳走。 */
    if (this.prefs.flow === 'scroll') return;
    const dir = pagingKeyAction(e.key, {
      flow: this.prefs.flow,
      contentVertical: this.host.contentVertical,
      contentRtl: this.host.contentRtl,
    });
    if (!dir) return;
    e.preventDefault();
    this.runCommand(dir);
  }

  runCommand(kind: ReaderCommand): void {
    switch (kind) {
      case 'next':
      case 'prev':
        void this.userNavigate(kind);
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
    const on = headerActive(this.book, this.lastCfi, this.parallelOn);
    this.headerEls.get('para')?.classList.toggle('is-active', on.para);
    /* 翻到已经签过的那一页，书签图标要亮：以前这段判断写了却没接到 DOM 上，
       图标永远是一副「这一页没签」的样子。 */
    this.headerEls.get('mark')?.classList.toggle('is-active', on.mark);
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
    /* 十项图标与这里一一对应，标签也只该有一份真源：头栏那颗图标的
       tooltip 是 `headerActionLabel()`，菜单里如果另写一套中文字面量，
       就会出现「界面语言是德语、⋮ 里还是中文」——而这排菜单恰好是手机端
       唯一的入口（头栏图标只露 3 颗，其余全折在这里）。 */
    const other = this.parallelId ? this.api.repo.byId(this.parallelId) : null;
    const root = this.rootEl ?? document.body;
    /* 三个会变的标题（并排 / 朗读 / 沉浸）说的是「点了会怎样」：
       开着的时候应该是「关闭 / 停止 / 退出」，不是图标名。 */
    const items: Array<{ id: HeaderActionId; label?: string; run: (evt?: MouseEvent) => void }> = [
      { id: 'toc', run: () => this.api.openTocSidebar('toc') },
      { id: 'search', run: () => dispatchAction('search', root) },
      { id: 'mark', run: () => this.toggleBookmark() },
      { id: 'type', run: () => dispatchAction('typography', root) },
      {
        id: 'para',
        label: this.parallelOn ? t('menu.para.close') : headerActionLabel('para'),
        run: () => void this.toggleParallel(),
      },
      {
        id: 'paraBook',
        label: t('menu.compare.title', {
          title: other?.meta.title ?? t('menu.compare.none'),
        }),
        run: (evt) => this.openParallelPicker(evt),
      },
      {
        id: 'tts',
        label: this.speaking ? t('menu.tts.stop') : headerActionLabel('tts'),
        run: () => this.toggleTts(),
      },
      { id: 'bookmap', run: () => dispatchAction('bookmap', root) },
      {
        id: 'immersive',
        label: this.immersive ? t('menu.immersive.exit') : headerActionLabel('immersive'),
        run: () => this.toggleImmersive(),
      },
      { id: 'library', run: () => getShellSource()?.openStudy('library') },
    ];
    for (const item of items) {
      const spec = headerActionSpec(item.id);
      menu.addItem((i) =>
        i
          .setTitle(item.label ?? spec.label)
          .setIcon(spec.icon)
          /* 二级菜单（选对照书）要落在手指/鼠标的位置上，坐标只有事件里有 */
          .onClick((evt) => item.run(evt instanceof MouseEvent ? evt : undefined)),
      );
    }
  }

  /** 二级菜单：选对照的另一本书。最多列 12 本，再多让用户先筛书架。 */
  private openParallelPicker(ev?: MouseEvent): void {
    const books = this.api.store
      .get()
      .books.filter((b) => b.id !== this.bookId && !(b.fileRef as { fileMissing?: boolean }).fileMissing);

    const menu = new Menu();
    if (!books.length) {
      menu.addItem((i) => i.setTitle(t('menu.compare.empty')).setDisabled(true));
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
    /* 最多列 12 本：再多就让人先去筛书架，不在菜单里塞一块滚动区 */
    if (books.length > 12) {
      menu.addSeparator();
      menu.addItem((i) =>
        i.setTitle(t('menu.compare.more', { n: books.length - 12 })).setDisabled(true),
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
    /* 开一次要 mount + start 整本副卷，几百毫秒起。这段时间里再点一次
       （双击、头栏与命令面板同时来）会建出第二个副卷：第一个的 host2 被
       覆盖，iframe 与监听全漏，界面上还会并排出现两本书。 */
    if (this.parallelOpening) return;
    const book = this.book;
    const pages = this.pagesEl;
    if (!book || !pages) return;

    const others = this.api.store
      .get()
      .books.filter((b) => b.id !== book.id && !(b.fileRef as { fileMissing?: boolean }).fileMissing);
    if (!others.length) {
      notify(t('notice.compare.onlyOne'));
      return;
    }
    const other = others.find((b) => b.id === this.parallelId) ?? others[0];
    this.parallelId = other.id;
    this.fillParallelSelect(others, other.id);

    this.parallelOpening = true;
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
      /* mount 只建视图，start 才真的装书——漏了这一步副栏是一块空白，
         看起来像「并排打开了但右边什么都没有」。副卷从它自己的进度起。 */
      await host2.start(other.reading.position.cfi || '', other.reading.position.percent || 0);
      this.parallelOn = true;
    } catch (e) {
      /* 副卷可能已经建了 iframe / 挂了监听，只是 start 失败。
         先销毁引擎再清引用与 DOM（A-28）——反过来清掉 DOM 之后，
         引擎里残留的 ResizeObserver 还会回调到一个已经不在文档里的节点。 */
      await destroyQuietly(host2);
      this.host2 = null;
      stage2.remove();
      this.stage2 = null;
      pages.classList.remove('is-parallel');
      notify(t('notice.compare.failed', { why: (e as Error).message }));
      return;
    } finally {
      this.parallelOpening = false;
    }
    this.syncToolState();
  }

  private fillParallelSelect(books: ReaderBook[], id: string): void {
    const sel = this.rootEl?.querySelector<HTMLSelectElement>('.bzs-rpara');
    if (!sel) return;
    sel.empty();
    for (const b of books) {
      const o = createEl('option');
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
    await destroyQuietly(host2);
  }

  /* ─────────────────── 朗读 ─────────────────── */

  /** 当前这一屏的正文纯文本（朗读与 AI 问答共用同一条取文口径） */
  pageText(): string {
    return this.host.currentText();
  }

  /**
   * 逐章导出整本正文（建全书画像用）。
   *
   * 转一手 host：视图暴露给壳层的能力都走这一条，壳层不该知道 host 的存在。
   */
  /** 按章名跳转（AI 来源点开用）；找不到就不动 */
  goToChapter(title: string): void {
    /* 点 AI 来源 = 用户要去那一章：停朗读、并且从现在起进度值得落盘（B14） */
    this.stopTts();
    this.userTurned = true;
    void this.host.goToChapter(title);
  }

  exportChapters(opts?: {
    onProgress?: (done: number, total: number, title: string) => void;
    shouldStop?: () => boolean;
  }): Promise<Array<{ title: string; text: string }>> {
    return this.host.exportChapters(opts ?? {});
  }

  private toggleTts(): void {
    // 停止永远放行，避免读起来之后关不掉
    if (this.speaking) {
      this.stopTts();
      return;
    }
    if (!requireCap('tts')) return;
    this.speakPage();
  }

  /**
   * 念当前这一页；按 `prefs.ttsFollow` 决定念完要不要自动翻页续读。
   *
   * 这就是「TTS 跟随阅读位置」：以前念完当前页就结束，翻页也不续，
   * 想接着听只能再点一次朗读——而且每次重新从这一页的第一句开始。
   */
  private speakPage(): void {
    const text = this.host.currentText();
    if (!text) {
      notify(t('notice.tts.noText'));
      this.stopTts();
      return;
    }
    const rate = this.prefs.ttsRate;
    const follow = this.prefs.ttsFollow;
    // 基础版包里 speak() 返回 null —— 那就是「这个环境没有朗读」
    const handle = speak(text, {
      rate,
      /* 书的语言优先（元数据是作者写的，比统计猜测可靠），其次界面语言，
         最后才按内容猜；细节见 core/speak.ts 的 speakLang */
      lang: speakLang(text, this.book?.meta.language, localeTag()),
      onEnd: () => {
        if (this.closed || !this.speaking) return;
        if (!follow) {
          this.stopTts();
          return;
        }
        /* 念完一页自动翻下一页接着念。翻页本身会走导航队列，
           等它落定再取新页的文字（否则拿到的还是上一页）。
           书末 next() 不前进：页码没变就停，不然会无限重念同一页。 */
        const before = this.host.pageKey;
        void this
          .advanceForTts()
          .then(() => {
            if (this.closed || !this.speaking) return;
            if (this.host.pageKey === before) {
              this.stopTts();
              return;
            }
            this.speakPage();
          })
          .catch(() => this.stopTts());
      },
    });
    if (!handle) {
      notify(t('notice.tts.unsupported'));
      return;
    }
    this.voice = handle;
    this.speaking = true;
    this.syncToolState();
  }

  /**
   * **用户**发起的翻页：点按 / 键盘 / 拖拽 / 命令，全走这一条。
   *
   * 先停朗读再翻：以前只有点按这一路停了朗读，键盘翻页、命令翻页、拖拽翻页
   * 都不停——朗读还在念上一页，人已经在新页面上了，两句词同时对不上。
   *
   * 朗读自己的「念完一页自动续读」**不能**走这里（那会把朗读掐死），
   * 它走 `advanceForTts()`。
   */
  private userNavigate(dir: PagingDirection): Promise<void> {
    this.stopTts();
    /* 用户真的动了：从这一刻起，relocate 记下的位置才值得落盘（B14） */
    this.userTurned = true;
    const p = dir === 'prev' ? this.host.prev() : this.host.next();
    return p.then(() => this.tracker.touch());
  }

  /** TTS 自动续读：不停朗读，只翻页。书末 next() 不前进由调用方判 */
  private advanceForTts(): Promise<void> {
    /* 人在听书，翻页也是他的意图：这几页的进度要落盘 */
    this.userTurned = true;
    return this.host.next();
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
    /* 文本面板正开着（想法 / 书摘 / AI）时不收：面板里的那排按钮就贴在
       这条下面，条子一抽走，用户得重新划词才能再点一下书摘。
       收起交给「点正文」或关面板。 */
    const kind = getShellState().overlay?.kind;
    if (kind === 'idea' || kind === 'quote' || kind === 'ai') return;
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
   * 划词条：与「点已有划线」时弹出的那一条是**同一枚胶囊**（`shell/text-toolbar.ts`）。
   * 这里只管「摆哪儿」与「点完干什么」：长什么样全在 toolbarHtml 里，
   * 动作名用 SELECTION_ACTS（sel*）——与点划线那套只差前缀，结构一模一样。
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
    /* 走 setHtml（DOMParser 惰性解析）：模板全由 toolbarHtml 生成，
       字符串里没有用户可控的 HTML。 */
    /* 知识库两颗：授权在、且 bz 的录入门面在，才出现（自动识别，没有开关）。
       没装 bz 时这两颗按钮按下去只会弹一句「还没装」——不如不出现。 */
    const kb = can('ai') && bzEntryReady(this.app);
    setHtml(
      bar,
      toolbarHtml({
        marked: !!live,
        color: activeColor,
        colors: HIGHLIGHT_COLORS,
        /* 手机只留三颗主路径；桌面窄到放不下七颗时，把知识库两颗收进「⋯」 */
        compact: isMobileEnv(),
        kb,
        narrow: (root.clientWidth || 0) < 520,
        acts: SELECTION_ACTS,
      }),
    );

    /* 点工具条不能把系统的选区和手柄清掉：pointerdown 默认会让 iframe 失焦，
       选区一塌，后面所有动作都拿不到文本了。 */
    bar.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });

    /* 一颗监听管全部按钮。「⋯」只切一个类、不重画——重画会把手指底下的
       按钮整排换掉，点起来像在打地鼠。判定与浮层里那枚工具条共用
       planToolbarHit，免得一处记得开合、另一处又把它当动作发出去。 */
    bar.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]');
      if (!btn || !bar.contains(btn)) return;
      const plan = planToolbarHit(btn.dataset.act);
      if (plan.kind === 'ignore') return;
      if (plan.kind === 'more') {
        /* .is-more 必须加在胶囊 .bzs-tb 上，不是外面那层定位壳 .bzs-selbar：
           CSS 是 `.bzs-tb.is-more .bzs-tb-more`，加错层菜单永远不会出现，
           看起来就是「点了一下，闪一下，打不开」。 */
        const open = toggleMoreMenu(btn.closest('.bzs-tb'), window.innerHeight);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      const act = plan.act;
      /* 面板要浮在工具条正上方，而且工具条不能因为面板打开而跳走：
         把锚点从「整段选区」换成「这一条」的底边——面板底边贴着条子底边，
         面板里那枚工具条正好顶替条子的位置，看起来像条子没动过。 */
      if (RT.sel) {
        const r = bar.getBoundingClientRect();
        RT.sel = { ...RT.sel, anchor: { left: r.left, top: r.bottom + 4, width: r.width, height: 0 } };
      }
      dispatchAction(act, btn);
      /* 改色不收：手机上连着换两个色，比反复长按选字快得多 */
      if (act === SELECTION_ACTS.dot) {
        for (const dot of Array.from(bar.querySelectorAll<HTMLElement>('.bzs-pendot'))) {
          dot.classList.toggle('on', dot === btn);
        }
        return;
      }
      /* 其余动作：条子收起来，位置交给浮层里那枚同款工具条（同一个锚点），
         所以视觉上它只是「原地换了个人」，不会消失。
         选区载荷留一份给浮层里的工具条——它还要发 sel* 动作，
         而 hideSelbar 会把 RT.sel 清掉。 */
      const keepSel = RT.sel;
      const keepMark = RT.selMarkId;
      this.hideSelbar();
      RT.sel = keepSel;
      RT.selMarkId = keepMark;
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
      /* 桌面贴文字上方、手机贴下方；只看真实承载，不看 force-mobile 的验收开关 */
      isMobileEnv() ? 'below' : 'above',
    );
    bar.style.left = `${pos.left}px`;
    bar.style.top = `${pos.top}px`;
    this.selbar = bar;
  }

  /* ─────────────────── 装载书 ─────────────────── */

  /**
   * 这个视图现在该不该响应键盘（P1-12）。
   *
   * 以前只要活动 leaf 是目录侧栏，**每一个** ReaderView 都返回 true：A、B
   * 两个阅读 tab 都开着时，焦点在目录里按一次 → 两本书同时翻页，两边的进度
   * 和阅读时长一起被写脏；按 f 沉浸被切两次（等于没反应）。
   *
   * 现在目录侧栏归「最近激活的那一本」（`activeReaderId`），别的视图不接。
   */
  private ownsKeyboard(): boolean {
    const ws = this.api.app.workspace;
    /* activeLeaf 在新版标了弃用，但 getLeaf(false) 在没有活动 leaf 时会退回
       主 leaf，语义和这里「只认当前活动 leaf」不同；minAppVersion 1.7.2 上
       activeLeaf 仍然可用（项目 eslint 配置关掉了 no-deprecated）。 */
    const active = ws.activeLeaf as unknown as { view?: { getViewType?: () => string } } | null;
    if (!active) return false;
    if (active === (this.leaf as unknown as typeof active)) return true;
    if (active.view?.getViewType?.() !== VIEW_TYPE_TOC) return false;
    return getShellState().activeReaderId === this.bookId;
  }

  private syncTabTitle(): void {
    const leaf = this.leaf as unknown as { updateHeader?: () => void };
    leaf.updateHeader?.();
  }

  /**
   * 把目录快照交给目录视图。
   *
   * **只写快照，不碰工作区布局**：打开一本书不等于要开左栏。以前这里会顺手
   * `openTocSidebar('toc')`（连左栏一起展开），没点目录也会被拨过去；现在开书
   * 就是开书，目录要人自己点（头栏、命令、快捷键都还在）。侧栏没开着时
   * setToc 只是一次内存写入，没人订阅，自然什么都不发生。
   */
  private publishToc(): void {
    const book = this.book;
    if (!book) return;
    setToc({
      bookId: book.id,
      bookTitle: book.meta.title,
      items: this.host.toc(),
      activeLabel: book.reading.position.chapterTitle || '',
      /* 切回阅读页时 publishToc 会重放一次：href 取引擎里的当前值，
         不然这一瞬间目录会退回按 label 比对，同名章节又一起亮。 */
      activeHref: this.host.currentChapterHref(),
      jump: (href) => {
        /* 跟着朗读时点目录 = 我要去别处，先把朗读停掉：
           以前它继续念旧位置，翻过去的新页面一声不响。 */
        this.stopTts();
        this.userTurned = true;
        void this.host.goToHref(href);
        this.tracker.touch();
      },
    });
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
    /* activeReaderId 决定「焦点在目录侧栏时键盘归谁」（P1-12）。
       没有它，两本书会一起翻页。 */
    if (getShellState().bookId !== book.id || getShellState().activeReaderId !== book.id) {
      setShellState({ bookId: book.id, activeReaderId: book.id });
    }
    this.publishToc();
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
    /* 同构造函数：重启后重开书，版式要读本平台那一份（见 data/prefs.ts 的 pickPrefs） */
    this.prefs = pickPrefs(this.api.store.get(), isMobileEnv());
    this.applyChrome();
    /* 书名/动作挂在宿主头栏上（自绘那条已经撤了） */
    this.mountHeader();

    /* 手机上解一本大书要好几秒，这段时间是空的——先说清楚在干什么，
       别让人以为点错了（host.mount 建好视图时会把这个占位清掉） */
    this.renderLoading(book.meta.title);

    try {
      await this.host.mount(this.stage, book.fileRef.vaultPath, {
        prefs: this.prefs,
        onRelocate: (info) => this.saveRelocate(info),
        /* 导航超时/异常时给一句人话：以前 onStall 声明了却没人接，
           所有「点了没反应」都是静默的。 */
        onStall: (what) => notify(t('notice.load.stalled', { what }), 'info'),
        onTap: (zone, info) => this.tapHandler(zone, info),
        /* 两指同时轻按 = 沉浸/还原。手势判定在引擎侧（只有它拿得到 iframe
           里的触摸序列），这里只接结果。 */
        onTwoFingerTap: () => this.toggleImmersive(),
        /* 引擎侧手势 / 横向拖拽翻页：与点按、键盘同一条路 */
        onTurn: (dir) => {
          void this.userNavigate(dir);
        },
        /* 正文 iframe 里的键盘转出来（P2-04）。不接的话，点过正文之后
           方向键、空格、Escape 全部失灵，只能先点头栏把焦点抢回来。 */
        onKeyDown: (ev) => this.handleKey(ev),
        onSelect: (info) => {
          if (!info) {
            // 选区塌了只收色点条；正在写想法时不受影响（弹层在 body 上）
            this.scheduleSelbarHide();
            return;
          }
          this.selection = info;
          this.selectionAt = Date.now();
          this.setSel(info);
          /* 开始新的划词 = 离开上一段交互：浮层（工具条 / 脚注）收掉，
             再把划词条贴到新选区下方。写想法不收——选一段原文再粘进想法
             是常见操作，收掉就等于把正在写的内容丢了。 */
          if (dismissesOnSelect(getShellState().overlay?.kind)) closeOverlay();
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
        onReady: (fb, m) => {
          /* 用户改过名就不再拿文件里的书名覆盖（见 data/book-meta.ts） */
          applyEngineMeta(book, m);
          /* 封面：复用刚解出来的 book 顺手落缓存并回填 coverPath。
             只读书、不开书架的用户也要有这条数据——外部读数据文件时，
             没有它就只能看到一片色块。 */
          void ensureCoverFromFoliate(this.api.app, book, fb).then(() => {
            const path = coverPathOf(book.id);
            if (path && book.meta.coverPath !== path) {
              book.meta.coverPath = path;
              this.api.store.touch();
            }
          });
          this.mountHeader();
          this.publishToc();
          this.syncTabTitle();
          this.api.store.touch();
          notifyShell();
        },
      });
      /* 点按分区要用「可见宽度」当分母：分页器的文档宽度比屏幕大一个量级 */
      this.host.setViewportWidth(
        (this.stage).clientWidth,
        (this.stage).getBoundingClientRect().left,
      );
      /* 重试一次就多挂一条 resize 监听（P3-18）：`registerEvent` 只在 onClose
         时统一摘，重试期间旧监听还在，于是每重试一次就多一次重复回调。 */
      if (!this.resizeBound) {
        this.resizeBound = true;
        this.registerEvent(
          this.api.app.workspace.on('resize', () => {
            const box = this.stage;
            if (box) this.host.setViewportWidth(box.clientWidth, box.getBoundingClientRect().left);
          }),
        );
      }
      const pending = this.pendingCfi;
      await this.host.start(
        pending || book.reading.position.cfi,
        pending ? 0 : book.reading.position.percent || 0,
      );
      this.pendingCfi = '';
      /* 书本来没开着、从划线 / 书签点过来的：落点同样要闪一下 */
      if (pending) void this.host.pulseAt(pending);
      /* 重试挂载时上一段会话还没结算：begin() 会把它收掉并返回，
         这里必须写回书里，否则统计里凭空少一段（P3-22）。 */
      const carried = this.tracker.begin(book.reading.position.percent);
      if (carried) {
        book.reading.sessions.push({
          ...attachChapter(carried, book.reading.position),
          percent: book.reading.position.percent,
        });
        book.reading.stats.totalReadTime += carried.durationSeconds;
        book.reading.stats.lastReadTime = Date.now();
      }
      /* 打卡按增量记：新会话从 0 起算，每 60 秒（以及每次翻页）把差额写进当天 */
      this.lastCheckinElapsed = 0;
      this.startCheckinTimer();
      if (!book.reading.stats.startReadTime) book.reading.stats.startReadTime = Date.now();
      this.api.store.touch();
      this.refreshAnnotations();
      this.mounted = true;
    } catch (e) {
      this.mounting = false;
      /* 关掉 tab 时才失败（大书解包要几秒）是正常操作，不该弹一条 6 秒红色
         「开书已取消」让人以为出故障（P2-14）。取消与真失败现在是两种
         错误类型：OpenCancelledError 静默，其余照常报。 */
      if (this.closed || e instanceof OpenCancelledError) return;
      const why = (e as Error)?.message || t('notice.open.unsupported');
      this.renderFault(t('fault.openFailed'), why);
      notify(why, 'error');
      return;
    }
    this.mounting = false;
  }

  /**
   * 失败态：标题说结论、第二行说原因、动作最多两个，自检信息收在下面。
   *
   * 环境自检那几行是给真机排查用的：手机上最常见的白屏是 iframe 加载不了
   * blob 地址，而那种失败连一条报错都没有。把结论写在这里，截图就能定位。
   */
  private renderFault(title: string, desc: string): void {
    const stage = this.stage;
    if (!stage) return;
    stage.empty();
    const diag: FaultDiagLine[] = envSummary(this.host.loadPhase).map((line) => {
      const i = line.indexOf('：');
      return i > 0 ? { k: line.slice(0, i), v: line.slice(i + 1) } : { k: '信息', v: line };
    });
    diag.push({ k: 'iframe·blob', v: '探测中…' });
    const box = el('div', '');
    setHtml(
      box,
      faultHtml({
        icon: 'alert',
        title,
        desc,
        diag,
        actions: [
          { label: '重试', act: 'retry', primary: true },
          { label: '回书架', act: 'back' },
        ],
      }),
    );
    box.querySelector('[data-act="back"]')?.addEventListener('click', () => getShellSource()?.openStudy('library'));
    box.querySelector('[data-act="retry"]')?.addEventListener('click', () => {
      this.mounted = false;
      void this.maybeMount();
    });
    const probeRow = box.querySelector<HTMLElement>('[data-k="iframe·blob"]');
    void probeBlobIframe().then((r) => {
      if (probeRow) setHtml(probeRow, `<span class="k">iframe·blob</span>${r}`);
    });
    stage.appendChild(box);
  }

  /** 解包与渲染期间的占位：说明在忙，不是坏了（不编造百分比） */
  private renderLoading(title: string): void {
    const stage = this.stage;
    if (!stage) return;
    stage.empty();
    const box = el('div', '');
    setHtml(box, loadingHtml(title));
    stage.appendChild(box);
  }

  /* ─────────────────── 进度与会话 ─────────────────── */

  private saveRelocate(info: RelocateInfo): void {
    const book = this.book;
    if (!book) return;
    const chapterChanged = !!info.chapterTitle && info.chapterTitle !== this.lastChapterTitle;
    /* 位置写入统一走 schema.recordPosition：顺带把被顶掉的旧位置存进
       lastPosition（冗余字段，给未来的「返回上一处」用）。 */
    recordPosition(book.reading, {
      percent: info.percent,
      cfi: info.cfi,
      chapterIndex: info.chapterIndex,
      chapterTitle: info.chapterTitle,
      chapterHref: info.chapterHref,
    });
    this.lastPercent = info.percent;
    if (info.cfi) this.lastCfi = info.cfi;
    if (info.chapterTitle) this.lastChapterTitle = info.chapterTitle;
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
    /* 进度不再写 `book.updatedAt`（A-15）：跨设备合并按 updatedAt 取整本，
       翻一页就刷新它会让另一台设备刚写的标注整份丢掉。标注改的是
       `notesUpdatedAt`（data/notes.ts），两条时间线互不覆盖。 */
    /* href 是唯一能定位目录行的字段：label 会重复（每个部分下都有「-1-」），
       只传 label 会让同名章节一起亮。 */
    if (info.chapterTitle || info.chapterHref) {
      patchToc({ activeLabel: info.chapterTitle, activeHref: info.chapterHref });
    }
    this.lastPct = info.percent;
    this.renderProbe();
    /* 每翻一页都可能换到「有书签 / 没书签」的页：图标亮不亮得跟着走 */
    this.syncToolState();
    this.tracker.touch(info.percent);
    /* 只有用户真的翻过页才落盘（B14）：初次定位写的是「上次读到哪」，
       不是这次的进度。落盘统一放在第一次翻页之后——那一次 relocate
       会把内存里这份（含定位结果）一起写下去，不会丢。
       朗读自动续读也算用户的意图（人按了朗读），走 userTurned。 */
    if (this.userTurned) {
      /* 翻页时顺手结算打卡：不靠 60 秒定时器等，翻得快也能实时涨 */
      this.flushCheckin();
      this.api.store.touch();
    }
    /* 每翻一页都广播会让侧栏与书架全量重建（书架是整面封面墙），手机上掉帧。
       换章/百分比变化且过节流窗口才通知；落盘仍然每次都做。 */
    const now = Date.now();
    if (
      shouldNotifyRelocate({
        now,
        lastAt: this.lastNotifyAt,
        lastPct: this.lastNotifiedPct,
        pct: info.percent,
        chapterChanged,
      })
    ) {
      this.lastNotifyAt = now;
      this.lastNotifiedPct = info.percent;
      notifyShell();
    }
  }

  /* ─────────────────── 标注 · 书签 ─────────────────── */

  /* 这里曾经有一个 `createHighlight()`：注释写着「由 shell/actions 调用」，
     实际上没有任何调用方——落笔走的是 actions 里的 `selpen` → `addHighlight`。
     留着一个永不执行的方法只会让人以为「选中即划」在这里实现（2026-11-04 删）。 */

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
   *   popup（默认）→ 注释号上方开浮窗，附一个「跳到原文」
   *   jump         → 直接跳过去，就是 foliate 原来的行为
   * 抓不到正文（章节互链、结构太怪）时引擎自己退回跳转，不再回调 null；
   * 这里的 null 分支只作防御，别重复提示。
   */
  private handleFootnote(info: FootnoteInfo | null): void {
    if (!info) return;
    /* 脚注浮窗已并入基础版：不再按能力位拦截，只看用户偏好 */
    if (this.prefs.footnote === 'jump') {
      this.userTurned = true;
      void this.host.goToHref(info.href);
      return;
    }
    openOverlay({ kind: 'footnote', text: info.text, href: info.href, anchor: info.anchor });
  }

  private toggleBookmark(): void {
    const book = this.book;
    if (!book) return;
    if (!this.lastCfi) {
      notify(t('notice.locate.notReady'), 'info');
      return;
    }
    const added = toggleBookmark(book, {
      cfi: this.lastCfi,
      percent: this.lastPercent,
      chapterTitle: this.lastChapterTitle,
    });
    this.api.store.touch();
    /* 图标立刻跟着亮 / 灭：不能等下一次 relocate，那一页可能翻很久 */
    this.syncToolState();
    notify(added ? t('notice.bookmark.toggledOn') : t('notice.bookmark.toggledOff'), 'info', 1600);
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
    this.syncToolState();
  }

  async settle(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    /* 在跑的那次全书搜索立刻作废：它对每一条命中都会回调界面 */
    this.searchGen += 1;
    this.stopCheckinTimer();
    /* 两本书各开一个 tab 时，关掉 A 不该把 B 的目录一起清空——
       目录快照是全局一份，只认自己那本。 */
    if (this.book && getToc()?.bookId === this.book.id) clearToc();
    this.hideSelbar();
    const book = this.book;
    if (book) {
      const session = this.tracker.end();
      if (session) {
        book.reading.sessions.push({
          ...attachChapter(session, book.reading.position),
          percent: book.reading.position.percent,
        });
        book.reading.stats.totalReadTime += session.durationSeconds;
        book.reading.stats.lastReadTime = Date.now();
      }
      /* 打卡收尾：把本次会话里还没记进当天的那一段补上。
         口径是 tracker 的「活跃已读秒数」，与 sessions 统计同源——
         以前在这里按 session.durationSeconds 记一次，但 session 只在关 tab 时
         才产生，开着 tab 读一整天，checkins 永远是 0。 */
      const total = this.tracker.elapsedSeconds;
      const rest = total - this.lastCheckinElapsed;
      if (rest > 0) {
        addCheckin(this.api.store.get(), rest, Date.now());
        this.lastCheckinElapsed = total;
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
    /* 副卷是另一份引擎、另一份样式：只给主卷 push 的话，调字号/行距/主题
       时并排的右半边一直不动，看起来像「设置只对左半边生效」。 */
    this.host2?.applyPrefs(this.prefs);
    this.api.store.touch();
    this.applyChrome();
    /* 头栏图标的顺序 / 显隐也是偏好：改完立刻重挂，不用等切 tab */
    this.mountHeader();
  }

  /* ─────────────────── 打卡结算 ─────────────────── */

  /** 把「自上次记账以来 tracker 新增的已读秒数」写进当天 */
  private flushCheckin(): void {
    if (!this.tracker.isRunning) return;
    const elapsed = this.tracker.elapsedSeconds;
    const delta = elapsed - this.lastCheckinElapsed;
    if (delta < 30) return;
    addCheckin(this.api.store.get(), delta, Date.now());
    this.lastCheckinElapsed = elapsed;
  }

  /** 每 60 秒记一次：停在同一页读很久时，只靠翻页触发会漏记 */
  private startCheckinTimer(): void {
    this.stopCheckinTimer();
    this.checkinTimer = window.setInterval(() => this.flushCheckin(), 60_000);
  }

  private stopCheckinTimer(): void {
    if (this.checkinTimer !== null) {
      window.clearInterval(this.checkinTimer);
      this.checkinTimer = null;
    }
  }

  private applyPrefs(patch: Partial<ReaderPrefs>): void {
    this.updatePrefs(normalizePrefs({ ...this.prefs, ...patch }));
  }

}

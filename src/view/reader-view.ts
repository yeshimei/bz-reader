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
import { createEngine, type ReaderEngine } from '../engine/reader-engine';
import { FONT_FAMILIES, normalizePrefs, pickPrefs, type ReaderPrefs } from '../data/prefs';
import { recordPosition, type ReaderBook } from '../data/schema';
import type { LinkTarget } from '../data/deeplink';
import { parseWikilinkHref, wikilinkOf } from '../data/wikilink';
import { pdfColorFromName, pdfDisplayLabel, pdfSubpathOf } from '../data/pdf-link';
import { pdfLocatorPage, pdfPageLocator } from '../engine/pdf/locator';
import {
  HIGHLIGHT_COLORS,
  colorCss,
  highlightsOf,
  findHighlight,
  toggleBookmark,
} from '../data/notes';
import { ActivityTracker, attachChapter } from '../engine/activity';
import { shouldMarkComplete } from '../engine/progress-fraction';
import { ClipOwnerRegistry } from './clip-owner';
import { applyEngineMeta } from '../data/book-meta';
import { coverPathOf, ensureCoverFromFoliate } from '../data/cover';
import { speak, speakLang, type SpeakHandle } from '../core/speak';
import { billedChars, buildScript, estimateCost, ttsLangSupported, type ScriptKind, type ScriptSegment } from '../core/tts-script';
import { synthesizeSpeech, type TtsErrorCode, type TtsVoice } from '../core/tts-api';
import { TtsPlayer } from '../core/tts-player';
import { applyGenders, parseRoleGenders, type SegmentWithGender } from '../core/tts-roles';
import { concatWav } from '../core/wav';
import { aiAsk } from '../data/ai';
import { TtsCache, cacheKey } from '../data/tts-cache';
import { ttsBarHtml } from './tts-bar';
import { notify, notifyNow, type NoticeHandle } from '../core/notice';
import { localeTag, t, type MsgKey } from '../i18n';
import { isMobileEnv, isMobileShell } from '../core/mobile';
import { envSummary, probeBlobIframe } from '../core/diagnose';
import { probeEnabled } from './debug-probe';
import { el, setHtml } from '../ui/dom';
import { pageLabelText, type PageLabelInput } from './page-label';
import { headTitleBox, headerTitleText, HEAD_TITLE_GAP } from './header-title';
import { chromeLabelMode } from './chrome-labels';

/**
 * 移动端顶部安全区的下限（px）。
 *
 * 刘海屏 / 挖孔屏上 Obsidian 给的 --safe-area-inset-top 有时是 0（老安卓
 * WebView 不报），两角小字就会压进状态栏。真机实测至少要 44px 才让得开，
 * 所以取两者的大值。
 */
const SAFE_TOP_MIN = 44;
import { setToc, clearToc, getToc, patchToc } from './toc-state';
import {
  availableActions,
  headerActionSpec,
  headerActionsFor,
  headerActive,
  isClipAction,
  type HeaderActionId,
} from './header-actions';
import { planHeaderVisibility, roleOf } from './header-layout';
import { pdfActionRun, type PanelAnchor } from './pdf-actions';
import { faultHtml, loadingHtml, type FaultDiagLine } from './reader-fault';
import { SELECTION_ACTS, planToolbarHit, toggleMoreMenu, toolbarHtml } from '../shell/text-toolbar';
import { hydrateToolbarIcons } from '../shell/toolbar-icons';
import { can } from '../data/entitlement';
import { bzEntryReady } from '../data/bz-bridge';
import { kbDoneOf } from '../data/kb-link';
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
  setStateQuiet,
  subscribe,
  notify as notifyShell,
  type OverlayKind,
  type CiteRow,
} from '../shell/state';
import { openOverlay } from '../shell/state';
import { tapIntent } from './tap-intent';
import { debugEvent, setDebugMeta } from '../data/debug-log';
import { clearTitleToc, isTitleToc, markTitleToc } from './title-toc';
import { pagingKeyAction, type PagingDirection } from './paging-key';
import { tapDirection, type TapSide } from './tap-direction';
import { immersiveExitHint, updateImmersiveHolders } from './immersive';
import { chromeBottomOverlap } from './bottom-gap';
import { destroyQuietly } from '../core/safe-destroy';
import { anchoredPlacement } from '../shell/anchored-style';
import { RT, onNotesChanged } from '../shell/runtime';
import { addCheckin } from '../shell/checkin';
import { toTextHits, type TextHit } from '../shell/text-search';
import { shouldNotifyRelocate } from './relocate-notify';
import { isClipBookRecord } from '../data/clip-book-entry';
import {
  clipSaveText,
  clipSummaryText,
  clipBookIsEmpty,
  currentClipVersion,
  loadClipBook,
  makeClipBookForApp,
  markClipChapterRead,
  openClipbookPanel,
  saveClipChapter,
  summarizeClipChapter,
  reportClipSeconds,
  type ClipBookSnapshot,
} from '../data/clip-book';
import type { ClipBookHandle, ClipChapter } from '../engine/clipbook';
import { ChapterClock } from '../data/clip-epub/chapter-clock';
import { ClipReportQueue } from '../data/clip-epub/report-queue';
import { addChapterSeconds, clipLanding, type ClipLanding } from '../data/clip-epub/sidecar';
import { carryMeasuredPages, clipStructureChanged, migrateClipKey, syncClipChapterMeta } from '../data/clip-epub/refresh';
import { DEFAULT_CLIP_SCOPE, type ClipScope } from '../data/clip-epub/scope';
import { getShellSource, shellPrefs, shellSettings } from '../shell/source';
import { collectPdfBacklinks, invalidatePdfBacklinks } from '../data/pdf-backlink';
import { epubBacklinkHits } from '../data/epub-backlink';
import { dispatchAction, requireCap } from '../shell/actions';

export const VIEW_TYPE_READER = 'bzr-reader-view';

/**
 * 命令面板可触发的阅读动作（plugin.ts 注册命令时用这个类型）。
 *
 * `pdf-*` 那一组只在 PDF 上有对应物：EPUB 上按下就是什么都不做，所以
 * 分派里统一用 `host.pdfUi?.` 取值，取不到就安静退出，不弹「不支持」——
 * 用户给一条命令绑了全局键，切到 EPUB 时最烦的就是每按一次弹一次提示。
 */
export type ReaderCommand =
  | 'next'
  | 'prev'
  | 'focus'
  | 'fullscreen'
  | 'bookmark'
  | 'typography'
  | 'bookmap'
  | 'guide'
  | 'tts'
  | 'help'
  | 'pdf-zoom-in'
  | 'pdf-zoom-out'
  | 'pdf-fit-width'
  | 'pdf-fit-page'
  | 'pdf-rotate'
  | 'pdf-spread'
  | 'pdf-paged'
  | 'pdf-thumbs'
  | 'pdf-copy-link'
  | 'pdf-export-page'
  | 'pdf-back';

/** 读到 99% 以上就算读完，不必真翻到最后一页的最后一个字 */
const COMPLETE_THRESHOLD = 0.99;

/**
 * 两份反链清单是不是同一份。
 *
 * 链接索引每动一下都会重算一次；不比对就每次整块重绘侧栏，
 * 正在滚动 / 悬停的列表会被打断。字段全对得上才认为没变。
 */
function sameCites(a: ReadonlyArray<CiteRow>, b: ReadonlyArray<CiteRow>): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.sourcePath === y.sourcePath &&
      (x.page ?? 0) === (y.page ?? 0) &&
      (x.label ?? '') === (y.label ?? '') &&
      (x.color ?? '') === (y.color ?? '') &&
      (x.locator ?? '') === (y.locator ?? '') &&
      (x.chapter ?? '') === (y.chapter ?? '') &&
      (x.text ?? '') === (y.text ?? '') &&
      (x.pct ?? -1) === (y.pct ?? -1)
    );
  });
}

/**
 * 所有处于沉浸态的阅读视图。
 *
 * body 上的 class 是全局的，视图是多实例的：两个 tab 各开一本书时，关掉 A
 * 不能把 B 的沉浸一起摘掉（A-27）。集合非空才保留 class，onClose 只释放
 * 自己这一份。
 */
const immersiveHolders = new Set<ReaderView>();

/** 阅读视图对外暴露给插件的能力（开书、开侧栏、拿 store） */
export interface ReaderHostApi {
  app: import('obsidian').App;
  store: import('../data/store').ReaderStore;
  repo: import('../data/book-repo').BookRepo;
  openShelf: () => void;
  openTocSidebar: (tab?: 'toc' | 'bookmarks' | 'highlights' | 'ai') => void;
}

/**
 * 剪藏本的「计时 + 轮询」主人：同一个 bookId 只允许一个。
 * 把 tab 拖到新窗口会开第二个视图，两边各记一遍时长、页码也各走各的。
 */
const clipOwners = new ClipOwnerRegistry<ReaderView>();

/**
 * 剪藏本阅读时长的上报窗口（2026-11-13）。
 *
 * 时间线：每 15 秒一拍攒进队列 → 最多等这么久批量发一次。60 秒的理由：
 * 剪藏本那边的流水是整分钟入账，窗口太短会让每次上报都凑不满 1 分钟
 * （零头留在账上，报告里看不见），太长则关书前长时间不落地、剪藏本列表
 * 一直显示 0 分钟。切章和关书另有立即补发，不依赖这个窗口。
 */
const CLIP_REPORT_WINDOW_MS = 60_000;

/** 控制条上显示的这一小段，认位置用，不抢正文的注意力 */
function snippetOf(text: string): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > 42 ? `${flat.slice(0, 42)}…` : flat;
}

/** 导出文件名：去掉路径分隔符与 Windows 不认的字符 */
function safeFileName(raw: string): string {
  const s = String(raw ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return s || 'audio';
}

export class ReaderView extends ItemView {
  private api: ReaderHostApi;
  private bookId = '';
  private pendingCfi = '';
  /**
   * 和 `pendingCfi` 二选一：直接跳到第几章第一页。
   *
   * 摘要改过正文之后旧 CFI 一定对不上（字符偏移会越界），重开这本书时
   * 只能按章节落，不能把那个 CFI 再喂给引擎。
   */
  private pendingSection = -1;
  /** 从跨书搜索跳过来时「要找的词」：挂好之后标在页面上，别让人自己找 */
  private pendingQuery = '';
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

  private host: ReaderEngine;
  private tracker = new ActivityTracker();
  private prefs: ReaderPrefs;
  /** 这本书最近一次算出的反链：切走页签再切回来要在侧栏里重放 */
  private cites: CiteRow[] = [];
  /** EPUB 反链的重算防抖计时器（链接索引变动是一阵一阵的） */
  private citesTimer: number | null = null;
  /** 点 PDF 自带批注时弹的那张小卡（一次只留一张） */
  private faCard: HTMLElement | null = null;

  private rootEl: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private selbar: HTMLElement | null = null;
  private selbarHideTimer: number | null = null;
  private pagesEl: HTMLElement | null = null;
  /** 沉浸模式左上角的章节名（非沉浸时是空串，CSS 按 :empty 收走） */
  private chapterEl: HTMLElement | null = null;
  /** 沉浸模式右下角的页码小字（关的时候是空串，CSS 按 :empty 收走） */
  private pageNoEl: HTMLElement | null = null;
  /** 桌面非沉浸：挂进宿主状态栏的页码（右下角会被状态栏挡住，2026-11-12 用户要求） */
  private statusPageEl: HTMLElement | null = null;
  /** 最近一次进度里的页码数字：设置里切口径时不用等下一次翻页就能重算 */
  private lastPageInfo: PageLabelInput | null = null;
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

  /* ── 剪藏本（活书，2026-11-13） ─────────────────────────
   * 书架上那本固定入口没有文件：数据从 bz 剪藏本现拉，章节按需渲染。
   * 这里管三件事：清单快照、按章计时、以及「数据变了就换一本」。 */
  private clipSnap: ClipBookSnapshot | null = null;
  private clipHandle: ClipBookHandle | null = null;
  private clipVersion = '';
  private clipKey = '';
  private clipClock = new ChapterClock();
  /** 已回写「已读」的 key：同一次打开不重复调 bz */
  private clipReported = new Set<string>();
  /** 数据版本轮询（20s 一次；只在剪藏书里跑） */
  private clipWatch: number | null = null;
  private clipRefreshing = false;
  /** 「一篇都没有」只提示一次（数据被清空时别每 20 秒刷一条） */
  private clipEmptyNotified = false;
  /** 认领了哪本剪藏本（关书时按它释放计时权） */
  private clipOwnerId = '';
  /**
   * 待回写给剪藏本的秒数（切章时攒、窗口到了一次发走）。
   *
   * 不能每拍都写盘：15 秒一拍，读一小时就是两百多次读改写。也不能等关书
   * 才发——用户开着书去干别的，那一篇永远显示 0 分钟。
   */
  private clipReportQueue = new ClipReportQueue();
  /** 上报节流定时器（60 秒窗口；关书 / 切走时立刻补发并清掉） */
  private clipReportTimer: number | null = null;
  /**
   * 剪藏状态栏项（2026-11-13）：桌面左下角那行「来源 · 已读」。
   *
   * 以前是正文下方一条底条，左边写着来源/状态/本章时长，右边四个按钮。
   * 底条占一行，还要为宿主状态栏 / 移动导航条让位（桌面 35px、手机 84px）；
   * 那串状态又和章节副标题重复（副标题本来就有来源和日期）。
   * 现在动作进头栏 / ⋮，状态挪到状态栏，底条整个撤掉。
   */
  private statusClipEl: HTMLElement | null = null;
  /** 「存为剪藏」在途：头栏图标是 div，没有 disabled，用标志位防连点 */
  private clipSaving = false;
  /** 「生成摘要」在途：AI 要几秒，期间再点一次会重复烧 token */
  private clipSummarizing = false;
  /**
   * 「正在生成摘要」那条常驻通知的句柄。
   *
   * timeout 传 0（生成要十几秒，3 秒就消失像没点上），出结果或关 tab 时
   * 由这里收掉——绝不能留一条只能手动点的通知挂在屏幕上。
   */
  private clipSummaryNotice: NoticeHandle | null = null;
  /**
   * 下一轮剪藏本刷新**强制重建**。
   *
   * 摘要只改一章的内容，不改章节结构（key / 标题都没动），`clipStructureChanged`
   * 会判成「没变」而走就地同步——那样新段落根本不会重新渲染。摘要一旦成功就
   * 置这个位，让这一次刷新走换书路径（位置由 CFI 迁移保住）。
   */
  private forceClipRebuild = false;
  /**
   * 这本书是按哪个「汇总范围」建的（2026-11-14）。
   *
   * 设置里改了范围不会改 bz 的 dataVersion，轮询就看不到变化——所以轮询
   * 每次顺带比一次这个值，不一致就走重建路径，读者改完三秒内就看到新书。
   */
  private clipScope: ClipScope | null = null;
  /** 构建时注入（manifest 版本 + 时间戳），见 esbuild.config.mjs 的 __BZ_BUILD_TAG__ */
  private static readonly BUILD_TAG = __BZ_BUILD_TAG__;

  /* 并排对照：副卷自己一套引擎，主卷的进度与标注一概不受影响 */
  private parallelOn = false;
  private parallelId = '';
  private host2: ReaderEngine | null = null;
  /** 副卷正在开（mount + start 那一段）：这段时间拒绝第二次开启 */
  private parallelOpening = false;
  private stage2: HTMLElement | null = null;

  /* 朗读：DeepSeek 真人声走 ttsPlayer，系统语音走 voice；两条路共用一个开关。
     翻页即停，避免「翻过去了还在念上一页」 */
  private speaking = false;
  private voice: SpeakHandle | null = null;
  private ttsPlayer: TtsPlayer | null = null;
  private ttsBarEl: HTMLElement | null = null;
  /** 正在念的那一句的框（宿主坐标，一句可能跨几行） */
  private ttsMarks: HTMLElement[] = [];
  private ttsIndex = 0;
  private ttsKind: ScriptKind = 'narration';
  private ttsSnippet = '';
  private ttsChars = 0;
  private ttsCost = 0;
  private ttsTotal = 0;
  /** 每次开始朗读 +1：等 AI 标角色的那几秒里用户可能已经停了 */
  private ttsRun = 0;
  /** 正在预生成本章音频（再点一次取消） */
  private prefetching = false;

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
  /** PDF 划词自动复制的防抖定时器（拖动选区时只落最后一次） */
  private pdfCopyTimer: number | null = null;
  private lastCfi = '';
  private lastPercent = 0;
  private lastChapterTitle = '';
  /** 上一拍的章节序号：剪藏书的 tocItem 可能拿不到标题，靠序号认换章 */
  private lastChapterIndex = -1;
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
    const s = (state ?? {}) as { bookId?: string; cfi?: string; file?: string; subpath?: string; query?: string };
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
    if (typeof s.query === 'string' && s.query.trim()) this.pendingQuery = s.query.trim();
    await super.setState(state, result);
    await this.maybeMount();
  }

  /** 已经开着这本书时从外面（跨书搜索）再点一条结果：只补标词 */
  highlightQuery(query: string, locator?: string): void {
    const q = String(query ?? '').trim();
    if (!q) return;
    if (!this.mounted) this.pendingQuery = q;
    else this.host.highlightQuery?.(q, locator);
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
   * 回到上一处。2026-11-10 起 EPUB 也有这条历史，两个引擎各存一份栈，
   * 视图层只认 `historyUi`（形状见 engine/reader-engine.ts）。
   *
   * 没有历史就安静退出：头栏那颗图标本身会压暗，但 ⋮ 菜单与快捷键还能点，
   * 点空不该弹提示。
   */
  private goBack(): void {
    this.host.historyUi?.back();
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
    this.syncStatusPage();
    await this.maybeMount();
  }

  async onClose(): Promise<void> {
    this.teardown();
    /* 反链防抖计时器：关书之后到点还会跑，算出来的东西也没地方放 */
    if (this.citesTimer !== null) window.clearTimeout(this.citesTimer);
    this.citesTimer = null;
    this.toggleImmersive(false);
    /* 头栏元素是宿主的、会被复用：关书前先把「标题可点」那套属性摘掉，
       再把元素删掉（宿主随后会重建一块干净的）。 */
    if (this.headTitleEl) {
      clearTitleToc(this.headTitleEl, this.book?.meta.title || '');
      this.headTitleEl.remove();
    }
    this.headTitleEl = null;
    /* 状态栏里那两项也要收：它们挂在宿主元素上，不跟视图一起销毁
       （页码在右、剪藏状态在左） */
    this.statusPageEl?.remove();
    this.statusPageEl = null;
    this.statusClipEl?.remove();
    this.statusClipEl = null;
    /* 头栏标题从 2026-11-12 起是自绘的（见 mountTitleInHeader），宿主那一行
       我们只加过一个「藏起来」的类；它带 data-type 作用域，切视图自动失效。 */
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
    /* 页码元素跟着 contentEl 一起没了：引用要清掉，免得下次开书
        renderChromeText 往一个已经摘下来的节点里写 */
    this.pageNoEl = null;
    this.lastPageInfo = null;
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
    /* 沉浸模式的两角小字：左上章节名、右下页码。都是绝对定位的一行小字，
       不占正文高度；非沉浸或关掉时 textContent 为空，CSS 的 :empty 收走。
       点击穿透（pointer-events:none），底部那片仍然按「点正文 = 下一页」翻。 */
    const chapter = el('div', 'bzs-chapter');
    const pageNo = el('div', 'bzs-pageno');
    /* 剪藏本不再有底条（2026-11-13）：四个动作进了宿主头栏 / ⋮，
       「来源 · 已读」进了左侧状态栏。以前这里是一条 flex 尾行，
       占掉一行高度，还要为宿主状态栏 / 移动导航条让位（桌面 35px、手机 84px）。 */
    root.append(pages, chapter, pageNo);
    this.contentEl.appendChild(root);

    this.rootEl = root;
    this.stage = stage;
    this.pagesEl = pages;
    this.chapterEl = chapter;
    this.pageNoEl = pageNo;

    /* 手机底栏浮在内容上：量一次它压住多少。第一次量时布局可能还没落定，
       再补一帧——量到 0 也不会多留白（见 syncBottomGap）。
       同一帧里再量一次安全区：首帧 rootEl 的 rect 还是 0，那时算出来的
       safe-top 会把状态栏叠两遍，正文顶上白白多一截。 */
    this.syncBottomGap();
    window.requestAnimationFrame(() => {
      this.syncBottomGap();
      this.applyChrome();
    });

    /* 点正文：移动端上下分区翻页；桌面端默认只收条子 / 关浮层，不翻页
       （设置里打开「点击翻页」才按左右分区翻）。两指同时按切换沉浸
       （判定在引擎侧）。翻页延后由 host 的队列保证，这里只管按区定方向。 */
    this.tapHandler = (zone, info) => {
      /* 这一下该干什么，全交给 tapIntent：划词条 > 浮层 > 翻页。
         iframe 里的点按不冒泡到宿主文档，document 级的收口收不到，
         所以「先收条子、再关浮层、最后才翻页」只能在这里兜住。 */
      const intent = tapIntent({
        selbar: !!this.selbar,
        overlayKind: getShellState().overlay?.kind,
        mobile: isMobileShell(),
        /* 桌面点正文翻页默认关（2026-11-12），设置里打开才走下面的翻页分支 */
        desktopTurn: this.prefs.desktopTapTurn,
      });
      debugEvent('intent', { intent, zone, selbar: !!this.selbar });
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
         选字、点链接、关浮层仍然照常，只是不再把点击当翻页。
         PDF 与 EPUB 的翻页方式已经分开，这里取「当前这本书」的那一项。 */
      if (this.currentFlow() === 'scroll') {
        this.renderProbe();
        return;
      }
      this.tapCount += 1;
      this.lastZone = zone === 'prev' ? 'U' : 'D';
      /* 连点就连续翻：去重已经在引擎侧按手势做过，这里不再压时间窗 */
      this.lastTurnAt = now;
      /* 桌面只在设置里开了「点击翻页」时才走到这里（默认关，见 tapIntent）。
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
    /* 底栏高度与头栏标题的对齐都吃窗口尺寸：一次 resize 里一起重量 */
    const gapSync = (): void => {
      this.syncBottomGap();
      this.syncHeaderTitle();
    };
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
    /* 笔记里新增 / 删掉一条指向本书的链接：EPUB 的引用页签要跟着变。
       PDF 由引擎自己监听（页面框也要重画），这里只接 EPUB 这一路。 */
    this.registerEvent(this.api.app.metadataCache.on('resolved', () => this.scheduleEpubCites()));
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
        /* 状态栏那份页码只给活动 tab 写：切走要把自己那一段清掉 */
        this.renderStatusPage();
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
    /* 先摆动作区，再量标题的位置：右边界是按动作区左缘算的 */
    this.ensureHeaderActions(header);
    this.mountTitleInHeader(header);
    this.renderProbe();
  }

  /**
   * 头栏标题：两端都自绘一个元素，宿主那一行收起来。
   *
   * 为什么不再改宿主的 `.view-header-title`：它有
   * `.is-focused .workspace-leaf.mod-active .view-header-title`（4 个类），
   * 窗口一聚焦就把颜色写回 --text-normal——失焦是灰的、点一下正文就变黑
   * （2026-11-12 用户反馈）；容器本身还是 flex 居中，左对齐得反着改。
   * 收掉宿主那一行、自己画一个，颜色、位置、点击语义就都在手里了。
   *
   * 内容是**当前章节名**（拿不到才退回书名）：书名在 tab、书架、侧栏都有，
   * 「现在读到哪」只有头栏这一处能一直看见。书还没解析出来时留空，
   * 不写「阅读」——那是宿主的兜底文案，在头栏里没有信息量。
   */
  private mountTitleInHeader(header: HTMLElement): void {
    const book = this.book;
    if (!book) return;
    /* 标记「标题已经由我们画了」：宿主原生的标题容器要收起来，否则两头都有。
       类挂在 leaf-content 上，且选择器带 data-type：切到别的视图后自动失效。 */
    header.closest('.workspace-leaf-content')?.classList.add('bzr-head-title-on');
    const desktop = !isMobileShell();
    if (!this.headTitleEl || !this.headTitleEl.isConnected) {
      const el0 = createDiv();
      el0.className = desktop ? 'bzr-head-title is-desktop' : 'bzr-head-title';
      const left = header.querySelector<HTMLElement>('.view-header-left');
      if (left) left.insertAdjacentElement('afterend', el0);
      else header.insertBefore(el0, header.firstElementChild);
      this.headTitleEl = el0;
    } else {
      /* 手机 / 桌面形态切换（含 force-mobile 验收）：类跟着换，样式才有归处 */
      this.headTitleEl.classList.toggle('is-desktop', desktop);
    }
    /* 桌面：章节名优先；手机：书名（2026-11-12 用户要求移动端别改） */
    const text = headerTitleText(
      book.meta.title,
      this.headerChapter(),
      desktop ? 'desktop' : 'mobile',
    );
    if (this.headTitleEl.textContent !== text) this.headTitleEl.textContent = text;
    /* 点头栏标题 = 打开左侧栏的目录页签（与头栏那颗目录图标同一条路） */
    this.bindTitleToToc(this.headTitleEl, text);
    if (desktop) this.placeHeadTitle(header);
  }

  /** 头栏那一行字的上游：最近一次定位到的章节，其次是用上次读到的那章 */
  private headerChapter(): string {
    if (this.lastChapterTitle.trim()) return this.lastChapterTitle;
    return this.book?.reading.position.chapterTitle ?? '';
  }

  /**
   * 桌面：把自绘标题钉在「正文左缘 → 动作区左边」这条带上（2026-11-12）。
   *
   * 量的是头栏、阅读区与两块按钮区，不是标题自己的 rect：
   * 标题的 margin / padding 以后再改，也不会把定位一圈圈带偏。
   * 头栏在沉浸时是 display:none，量出来全 0，交给退出沉浸那一拍再算。
   */
  private placeHeadTitle(header: HTMLElement): void {
    const el0 = this.headTitleEl;
    if (!el0) return;
    const headerBox = header.getBoundingClientRect();
    if (!headerBox.width) return;
    const rootBox = this.rootEl?.getBoundingClientRect();
    const leftRegion = header.querySelector<HTMLElement>('.view-header-left');
    const actions = header.querySelector<HTMLElement>('.view-actions');
    const box = headTitleBox({
      headerLeft: headerBox.left,
      headerWidth: headerBox.width,
      rootLeft: rootBox?.left ?? headerBox.left,
      contentLeft: this.host.contentLeftInset?.() ?? 0,
      leftRegionRight: leftRegion?.getBoundingClientRect().right ?? headerBox.left,
      actionsLeft: actions?.getBoundingClientRect().left ?? null,
      gap: HEAD_TITLE_GAP,
    });
    if (!box) return;
    el0.style.setProperty('--bzr-head-title-left', `${box.left}px`);
    el0.style.setProperty('--bzr-head-title-right', `${box.right}px`);
  }

  /** 章节变了 / 窗口变了 / 退出沉浸：重写头栏那一行字并重新定位 */
  private syncHeaderTitle(): void {
    const header = this.containerEl.querySelector<HTMLElement>('.view-header');
    if (!header) return;
    this.mountTitleInHeader(header);
  }

  /**
   * 书名可点：打开左侧栏并切到目录（2026-11-08）。
   *
   * 两端都绑，但只绑「本视图头栏里的那个元素」——宿主的 `.view-header-title`
   * 在别的视图里也有（文件视图里点它是另一回事），所以入口只从 mountHeader
   * 进来。用标记属性记一次：头栏会被宿主重建，元素换了才重绑；
   * 同一个元素上换书不重复叠监听。
   *
   * 键盘可达：Enter / Space 与点击同效，`role=button` 让读屏也能认出来。
   * 加与摘都在 view/title-toc.ts：onClose 要能把这套属性摘回去（宿主会
   * 复用同一块元素，留着会让别的视图看起来像按钮却点不动）。
   */
  private bindTitleToToc(el: HTMLElement | null, title: string): void {
    if (!el) return;
    const label = t('view.title.openToc');
    const bound = isTitleToc(el);
    markTitleToc(el, label, title ? `${title} · ${label}` : label);
    if (bound) return;
    const open = (): void => {
      /* 头栏元素会被宿主复用：这个 leaf 切到别的视图之后它还在，
         那时点标题不该再把阅读器的侧栏拽出来。 */
      const live = (this.leaf as unknown as { view?: unknown } | undefined)?.view;
      if (live && live !== this) return;
      this.api.openTocSidebar('toc');
    };
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      open();
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      open();
    });
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

    /* PDF 的「排版」不是字号行距，而是旋转 / 单双页 / 翻页——点同一颗图标，
       换成贴按钮下沿的那张小卡（外观与 EPUB 的排版浮层一致）。
       `pdfActionRun` 收的是「现取」函数：按钮比 PDF 引擎早建好，且复用时
       不重挂监听，闭包里存当时的 pdfUi 会让这五颗永远点不动。
       浮层贴按钮：点了哪颗就把它的矩形带过去，命令面板 / ⋮ 菜单没有坐标。 */
    const typography = (anchor?: PanelAnchor): void => {
      if (anchor) openOverlay({ kind: 'typography', anchor });
      else dispatchAction('typography', this.rootEl ?? document.body);
    };
    const pdfRun = pdfActionRun(() => this.host.pdfUi, typography);
    /* 触发按钮的视口矩形；菜单 / 命令面板没有 currentTarget 时返回 null */
    const anchorOf = (ev?: MouseEvent): PanelAnchor => {
      const target = ev?.currentTarget ?? ev?.target;
      if (!(target instanceof HTMLElement)) return null;
      const box = target.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    };
    const run: Record<string, (ev?: MouseEvent) => void> = {
      toc: () => this.api.openTocSidebar('toc'),
      search: () => dispatchAction('search', this.rootEl ?? document.body),
      mark: () => this.toggleBookmark(),
      type: (ev) => pdfRun.type(anchorOf(ev)),
      thumb: () => pdfRun.thumb(),
      copy: (ev) => {
        const box = ev?.currentTarget instanceof HTMLElement ? ev.currentTarget.getBoundingClientRect() : null;
        pdfRun.copy(box ? { right: box.right, bottom: box.bottom } : null);
      },
      history: () => this.goBack(),
      export: () => pdfRun.export(),
      para: () => void this.toggleParallel(),
      paraBook: (ev) => this.openParallelPicker(ev),
      tts: () => this.toggleTts(),
      bookmap: () => dispatchAction('bookmap', this.rootEl ?? document.body),
      guide: () => dispatchAction('guide', this.rootEl ?? document.body),
      immersive: () => this.toggleImmersive(),
      library: () => getShellSource()?.openStudy('library'),
      /* 剪藏本三颗（2026-11-13）：以前是正文底条上的按钮 */
      clipSave: () => this.onClipAction('clipSave'),
      clipNote: () => this.onClipAction('clipNote'),
      clipPanel: () => this.onClipAction('clipPanel'),
      clipSummary: () => this.onClipAction('clipSummary'),
    };
    const spec = headerActionsFor(
      mobile,
      { order: prefs.headerOrder, hidden: prefs.headerHidden },
      this.host.isPdf,
      /* 颗数看真实设备（上面的 mobile），哪些动作存在看手机形态：
         桌面开 force-mobile 验收时，入口要和真机一致才验得出来。 */
      isMobileShell(),
      /* 剪藏本：四颗只在剪藏书里出现（手机不占那 3 个名额，走 ⋮） */
      !!this.clipSnap,
    ).map((id) => ({
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
    }
    /* 「回到上一处」没有历史时压暗：一颗永远点不动的亮图标是误导。
       跳转历史由引擎回调（onHistoryChange）随时刷新，这里只管重挂后的初值。
       2026-11-10 起 EPUB 也有这条历史，所以不再读 pdfUi。 */
    this.headerEls.get('history')?.classList.toggle('is-off', !this.host.historyUi?.canBack());

    /* 收起的图标不另建菜单：宿主最右侧的 ⋮ 里本来就有这些项
       （见 onPaneMenu），再挂一颗自己的 ⋮ 只会变成两个入口。

       `prepend` 传的是**全部**按钮而不只是这次新建的：视图挂载早期按 EPUB
       建过一批按钮，PDF 引擎就绪后才补四颗，只 prepend 新建的会把它们顶到
       目录 / 搜索前面，和用户排的顺序正好相反。`prepend` 会移动已有节点，
       每次重挂都按 spec 排一遍是幂等的。 */
    const ordered = spec
      .map((s) => this.headerEls.get(s.id))
      .filter((el): el is HTMLElement => !!el);
    if (ordered.length) box.prepend(...ordered);
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
      if (others.length === 1) roles[others[0]] = 'more';
      else if (others.length > 1) hideOthers = false;
    }

    const show = planHeaderVisibility(roles, maxOurs, hideOthers);
    items.forEach((el, i) => {
      /* 显示/隐藏走 class（`body .view-header .clickable-icon.bzs-host-hidden`
         里带 !important）——主题和别的插件常给自己图标写 !important，
         inline 样式是那时唯一压得住的写法，但官方 lint 禁止直接写样式。 */
      if (show[i]) {
        el.removeClass('bzs-host-hidden');
        el.style.removeProperty('display');
      } else el.addClass('bzs-host-hidden');
    });

    /* scope 之外还有：有些插件不往 .view-actions 里塞，而是直接挂在
       .view-header 上或自己包一层容器。这里一并清掉，但跳过
       .view-header-nav-buttons——那里是宿主的侧栏切换 / 返回前进，
       藏了用户就回不去了。认不出 ⋮ 时（hideOthers=false）一颗都不动。 */
    if (!hideOthers) return;
    const header = scope.closest('.view-header');
    for (const el of Array.from(header?.querySelectorAll<HTMLElement>('.clickable-icon') ?? [])) {
      if (items.includes(el) || el.closest('.view-header-nav-buttons')) continue;
      if (roleOf(el) === 'other') el.addClass('bzs-host-hidden');
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
    /* bd / tk / bl 是引擎侧的链路计数（见 EngineHost.probe）：
       bd 一直 0 = 手势监听没挂上；tk 不涨 = 事件没进来；bl 一直涨 = 被选区/链接/
       划线拦掉了。真机上分得清这三种，就不用再靠猜。 */
    const pr = this.host?.probe;
    this.probeEl.textContent =
      `bz ${ReaderView.BUILD_TAG} · pg${pg ? '✓' : '✗'} hdr${header ? '✓' : '✗'} ttl${title ? '✓' : '✗'} act${acts}` +
      ` · bd${pr?.binds ?? 0} tk${pr?.taps ?? 0} bl${pr?.blocked ?? 0}` +
      ` · tap${this.tapCount}${this.lastZone} ${this.lastKeyBefore || '-'}→${this.lastKeyAfter || '…'}` +
      ` ${Math.round(this.lastPct * 100)}%`;
  }

  /** 命令面板切完诊断角标后调一下：立刻反映，不用重开书 */
  refreshProbe(): void {
    this.renderProbe();
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
    /* 两角小字（左上章节名 / 右下页码）只在沉浸时出现：切完立刻画，
       不等下一次翻页 */
    this.renderChromeText();
    /* 底栏藏起来了：再量一次「底栏压住多少」，全屏时那一段应该是 0。
       不重量的话，退出全屏会少一截、进入全屏会多一截。
       头栏同理：沉浸时它是 display:none，退出后要重新量一次才能贴正文左缘。 */
    window.requestAnimationFrame(() => {
      this.syncBottomGap();
      this.syncHeaderTitle();
    });
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
    /* 测试环境里 rAF 可能在 DOM 桩卸载之后才跑（真机不会） */
    if (typeof document === 'undefined') return;
    /* 手机导航栏与桌面状态栏都是 fixed，压在阅读区上。取两者中更靠上的
       那条顶边算重叠；两条都在时（iPad 带状态栏）也不会算两遍。 */
    const tops: number[] = [];
    for (const sel of ['.mobile-navbar', '.status-bar']) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      /* 沉浸/隐藏时高度是 0、或者元素根本不在视口里 → 不让位 */
      if (r.height <= 0 || r.top <= 0) continue;
      tops.push(r.top);
    }
    const barTop = tops.length ? Math.min(...tops) : null;
    const paneBottom = root.getBoundingClientRect().bottom;
    const gap = chromeBottomOverlap(paneBottom, barTop);
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
   * 当前这本书的翻页方式。
   *
   * PDF 与 EPUB 各存一项（2026-11-11）：以前共用一项，在 PDF 面板里切一次
   * 「连续」，读 EPUB 也跟着变。键盘、点按、排版面板统一问这里，别再各读各的。
   */
  private currentFlow(): 'paged' | 'scroll' {
    return this.host.isPdf ? this.prefs.pdfFlow : this.prefs.flow;
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
       按一下方向键就整页跳走。
       PDF 与 EPUB 的翻页方式已经分开，这里取「当前这本书」的那一项。 */
    const flow = this.currentFlow();
    if (flow === 'scroll') return;
    const dir = pagingKeyAction(e.key, {
      flow,
      contentVertical: this.host.contentVertical,
      contentRtl: this.host.contentRtl,
      /* PDF 是纵向的一叠纸：上下键就是翻页。EPUB 的分页器里没有对应动作 */
      verticalKeys: this.host.isPdf,
    });
    if (!dir) return;
    e.preventDefault();
    this.runCommand(dir);
  }

  runCommand(kind: ReaderCommand): void {
    /* PDF 那一组先分流：EPUB 上没有 pdfUi，绑了全局键也不该弹提示或报错。
       「回到上一处」单独拿出来——它已经不属于 PDF（2026-11-10 起 EPUB 也有），
       命令 id 保留 `pdf-back` 是为了不弄丢用户已经绑好的快捷键。 */
    if (kind === 'pdf-back') {
      this.goBack();
      return;
    }
    if (kind.startsWith('pdf-')) {
      const pdf = this.host.pdfUi;
      if (!pdf) return;
      switch (kind) {
        case 'pdf-zoom-in': pdf.zoomIn(); break;
        case 'pdf-zoom-out': pdf.zoomOut(); break;
        case 'pdf-fit-width': pdf.fitWidth(); break;
        case 'pdf-fit-page': pdf.fitPage(); break;
        case 'pdf-rotate': pdf.rotate((pdf.rotation() + 90) % 360); break;
        case 'pdf-spread': pdf.setSpread(!pdf.spread()); break;
        /* 一屏一页 / 连续滚动是 PDF 自己的偏好：setPaged 里一并落盘 */
        case 'pdf-paged': pdf.setPaged(!pdf.paged()); break;
        case 'pdf-thumbs': pdf.toggleThumbs(); break;
        case 'pdf-copy-link': pdf.copyLink('page'); break;
        case 'pdf-export-page': pdf.exportPage(); break;
        default: break;
      }
      return;
    }
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
        /* 手机端也放开朗读（2026-11-14 用户要求）：以前这里按平台拦一道，
           现在头栏、命令面板、这条兜底三处都能唤起。 */
        this.toggleTts();
        break;
      case 'typography': {
        /* PDF 的「排版」是旋转 / 单双页 / 翻页，不是字号行距（那些来自原文件）。
           内置键 t 与头栏那颗图标走同一个面板，别再弹「PDF 不可调」的提示。 */
        if (this.host.isPdf) {
          this.host.pdfUi?.toggleLayout();
          break;
        }
        const host = this.rootEl;
        if (host) dispatchAction(kind, host);
        break;
      }
      case 'bookmap':
      case 'guide':
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
       tooltip 是 `headerActionSpec().label`，菜单里如果另写一套中文字面量，
       就会出现「界面语言是德语、⋮ 里还是中文」——而这排菜单恰好是手机端
       唯一的入口（头栏图标只露 3 颗，其余全折在这里）。 */
    const other = this.parallelId ? this.api.repo.byId(this.parallelId) : null;
    const root = this.rootEl ?? document.body;
    const pdfRun = pdfActionRun(
      () => this.host.pdfUi,
      /* ⋮ 菜单没有能对齐的按钮：选完排版项浮层回到默认位置 */
      (anchor) => (anchor ? openOverlay({ kind: 'typography', anchor }) : dispatchAction('typography', root)),
    );
    /* 头栏与 ⋮ 共用同一张动作表。以前这里手写十项，加一颗图标要记得改两处，
       漏了就是「头栏有、⋮ 里没有」——手机端尤其致命，⋮ 是唯一入口。
       PDF 四颗只在 PDF 里出现；EPUB 上多四颗点不动的条目就是噪声。 */
    const run: Record<HeaderActionId, (evt?: MouseEvent) => void> = {
      toc: () => this.api.openTocSidebar('toc'),
      search: () => dispatchAction('search', root),
      mark: () => this.toggleBookmark(),
      type: () => pdfRun.type(null),
      thumb: () => pdfRun.thumb(),
      /* ⋮ 里没有稳定的按钮坐标，复制菜单退回工具条上沿那个老位置 */
      copy: () => pdfRun.copy(null),
      history: () => this.goBack(),
      export: () => pdfRun.export(),
      para: () => void this.toggleParallel(),
      paraBook: (evt?: MouseEvent) => this.openParallelPicker(evt),
      tts: () => this.toggleTts(),
      bookmap: () => dispatchAction('bookmap', root),
      guide: () => dispatchAction('guide', root),
      immersive: () => this.toggleImmersive(),
      library: () => getShellSource()?.openStudy('library'),
      /* 剪藏本三颗（2026-11-13）：以前是正文底条上的按钮 */
      clipSave: () => this.onClipAction('clipSave'),
      clipNote: () => this.onClipAction('clipNote'),
      clipPanel: () => this.onClipAction('clipPanel'),
      clipSummary: () => this.onClipAction('clipSummary'),
    };
    /* 三个会变的标题（并排 / 朗读 / 沉浸）说的是「点了会怎样」：
       开着的时候应该是「关闭 / 停止 / 退出」，不是图标名。
       手机上没有这三项（见 availableActions），dynamic 里留着也不影响。 */
    const dynamic: Partial<Record<HeaderActionId, string>> = {
      para: this.parallelOn ? t('menu.para.close') : undefined,
      paraBook: t('menu.compare.title', { title: other?.meta.title ?? t('menu.compare.none') }),
      tts: this.speaking ? t('menu.tts.stop') : undefined,
      immersive: this.immersive ? t('menu.immersive.exit') : undefined,
    };
    /* 头栏、这里、设置页的图标列表共用 availableActions：手机上 ⋮ 是主入口，
       这里漏一处就等于「头栏藏了、菜单里还在」。判据是手机形态而不是真实设备：
       桌面 force-mobile 验收时，菜单也要和真机一致。 */
    const clipCh = this.clipSnap ? this.currentClipChapter() : null;
    let clipSepDone = false;
    for (const id of availableActions(isMobileShell(), this.host.isPdf, !!this.clipSnap)) {
      /* 剪藏三颗按「这一章能不能用」再筛一遍：底条时代它们按需显隐，
         搬进菜单后不筛的话「剪藏笔记」会在没有笔记的章节里常驻、
         「存为剪藏」在已剪藏的章节里还能点到（点了只会 alreadySaved）。 */
      if (id === 'clipSave' && (!clipCh || clipCh.state === 'saved')) continue;
      if (id === 'clipNote' && !clipCh?.notePath) continue;
      if (id === 'clipPanel' && !clipCh) continue;
      /* 剪藏三项自己一组，别和「返回书架」粘在一起 */
      if (isClipAction(id) && !clipSepDone) {
        menu.addSeparator();
        clipSepDone = true;
      }
      const spec = headerActionSpec(id);
      const action = run[id];
      menu.addItem((i) =>
        i
          .setTitle(dynamic[id] ?? spec.label)
          .setIcon(spec.icon)
          /* 二级菜单（选对照书）要落在手指/鼠标的位置上，坐标只有事件里有 */
          .onClick((evt) => action(evt instanceof MouseEvent ? evt : undefined)),
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
    /* 对照卷：PDF 也能并排（每边各自一套引擎，互不认识对方的排版）。
       EPUB 那套 grid 两栏对 canvas 同样成立，不需要特判格式。 */
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

    const host2 = createEngine(other.fileRef.format, this.api.app);
    this.host2 = host2;
    try {
      await host2.mount(inner, other.fileRef.vaultPath, {
        prefs: this.prefs,
        onTap: (zone) => {
          /* 副卷与主栏同一条规矩：桌面点正文默认不翻页，只有设置里开了才翻。
             副卷只在桌面出现，所以这里不判手机。 */
          if (!this.prefs.desktopTapTurn) return;
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
   * 两条路：DeepSeek 真人声（默认）与系统语音。切段、音色、缓存都在
   * `speakPageAi` 里；系统语音原样保留，没配 Key 或用户手动切回时用。
   */
  private speakPage(): void {
    const text = this.host.currentText();
    if (!text) {
      notify(t('notice.tts.noText'));
      this.stopTts();
      return;
    }
    if (this.prefs.ttsEngine === 'deepseek') {
      void this.speakPageAi(text);
      return;
    }
    // 基础版包里 speak() 返回 null —— 那就是「这个环境没有朗读」
    const handle = speak(text, {
      rate: this.prefs.ttsRate,
      /* 书的语言优先（元数据是作者写的，比统计猜测可靠），其次界面语言，
         最后才按内容猜；细节见 core/speak.ts 的 speakLang */
      lang: speakLang(text, this.book?.meta.language, localeTag()),
      onEnd: () => this.onPageSpoken(),
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
   * 一页念完了：跟随就翻页续读，不跟随就停。
   *
   * 系统语音与 DeepSeek 共用——续页是朗读行为，不该因为换了引擎而变。
   */
  private onPageSpoken(): void {
    if (this.closed || !this.speaking) return;
    if (!this.prefs.ttsFollow) {
      this.stopTts();
      return;
    }
    /* 翻页本身会走导航队列，等它落定再取新页（否则拿到的还是上一页）。
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
  }

  /**
   * DeepSeek 朗读：按「旁白 / 对白」切段，两把嗓子交替。
   *
   * 不做自动退回系统语音（用户明确要求）：失败就停并说清原因，
   * 要不要换引擎由用户自己决定。
   */
  private async speakPageAi(text: string): Promise<void> {
    const settings = shellSettings();
    const ai = settings.ai;
    if (!ai.apiKey.trim()) {
      notify(t('notice.tts.noKey'));
      return;
    }
    /* 第一次用朗读：讲清楚「这一页的正文会发给语音服务」，只讲一次。
       与 AI 问答那份 aiAck 分开记——两条出网路径互不代表。 */
    if (!settings.ttsAck) {
      notify(t('notice.tts.privacy'));
      getShellSource()?.setSettings({ ttsAck: true });
    }
    const lang = speakLang(text, this.book?.meta.language, localeTag());
    if (!ttsLangSupported(lang)) {
      notify(t('notice.tts.unsupportedLang'));
      return;
    }
    /* PDF / TXT 取不到块结构时退回整页一段：至少还能念，只是不分角色 */
    const blocks = this.host.currentBlocks?.() ?? [];
    let segments: SegmentWithGender[] = buildScript(blocks.length ? blocks : [{ tag: 'p', text }]);
    if (this.prefs.ttsDialogueOnly) segments = segments.filter((s) => s.kind === 'dialogue');
    if (!segments.length) {
      notify(t('notice.tts.noText'));
      return;
    }
    /* 先停旧的：换页重念时不能两条音频叠在一起 */
    this.stopTts();
    const run = ++this.ttsRun;

    /* 让模型认角色：多等 1–3 秒，换来「男声/女声」；标注失败就按双音色念 */
    if (this.prefs.ttsAiRoles && segments.some((s) => s.kind === 'dialogue')) {
      segments = await this.annotateRoles(segments, blocks);
      if (this.closed || run !== this.ttsRun) return;
    }

    const voices = this.prefs.ttsMultiVoice
      ? { narration: this.prefs.ttsNarrator, dialogue: this.prefs.ttsDialogue }
      : { narration: this.prefs.ttsVoice, dialogue: this.prefs.ttsVoice };
    const voiceOf = (seg: SegmentWithGender): TtsVoice => this.ttsVoiceOf(seg, voices);
    this.ttsChars = segments.reduce((n, s) => n + billedChars(s.text), 0);
    this.ttsCost = estimateCost(this.ttsChars);
    this.addTtsSpend(this.ttsChars, this.ttsCost);
    this.ttsTotal = segments.length;
    this.ttsIndex = 0;
    this.ttsKind = segments[0].kind;
    this.ttsSnippet = snippetOf(segments[0].text);

    const cacheMB = this.prefs.ttsCacheMB;
    const cache = cacheMB > 0 ? new TtsCache() : null;
    const bookId = this.bookId;
    const player = new TtsPlayer(segments, voiceOf, {
      synthesize: (body, voice, signal) =>
        synthesizeSpeech({ baseUrl: ai.baseUrl, apiKey: ai.apiKey, text: body, voice, signal }),
      ...(cache
        ? {
            cache: {
              get: (k) => cache.get(k),
              put: (k, data) => cache.put(k, data, cacheMB * 1024 * 1024),
            },
            cacheKey: (body, voice) => cacheKey(bookId, voice, body),
          }
        : {}),
      onSegment: (index, seg) => {
        this.ttsIndex = index;
        this.ttsKind = seg.kind;
        this.ttsSnippet = snippetOf(seg.text);
        this.showSpeechMark(this.host.speechRects?.(seg.blocks, seg.text) ?? []);
        this.renderTtsBar();
      },
      onEnd: () => this.onPageSpoken(),
      onError: (code, err) => this.onTtsError(code, err),
      onState: () => this.renderTtsBar(),
    });
    this.ttsPlayer = player;
    this.speaking = true;
    this.syncToolState();
    this.showTtsBar();
    player.setRate(this.prefs.ttsRate);
    player.start();
  }

  /** 调模型标角色；失败返回原样（听书不能因为一次标注失败就停） */
  private async annotateRoles(
    segments: SegmentWithGender[],
    blocks: Array<{ text: string }>,
  ): Promise<SegmentWithGender[]> {
    try {
      const res = await aiAsk(shellSettings(), { task: 'roles', text: '', blocks });
      const genders = parseRoleGenders(res.text, blocks.length);
      return applyGenders(segments, genders);
    } catch {
      return segments;
    }
  }

  /** 朗读失败：按错误类型说人话，然后停（不回退系统语音） */
  private onTtsError(code: TtsErrorCode | 'audio', _error: unknown): void {
    const map: Partial<Record<TtsErrorCode | 'audio', MsgKey>> = {
      unauthorized: 'notice.tts.noKey',
      rejected: 'notice.tts.rejected',
      rate: 'notice.tts.rate',
      busy: 'notice.tts.busy',
      network: 'notice.tts.network',
    };
    const key: MsgKey = map[code] ?? 'notice.tts.failed';
    notify(t(key));
    /* 单段被审核拒绝：播放器自己会跳过继续，这里只提示，不掐整页 */
    if (code === 'rejected') return;
    this.stopTts();
  }

  /* ── 朗读控制条 ── */

  private showTtsBar(): void {
    const root = this.rootEl;
    if (!root) return;
    if (!this.ttsBarEl) {
      this.ttsBarEl = el('div', 'bzr-ttsbar-wrap');
      this.ttsBarEl.addEventListener('click', (ev) => this.onTtsBarClick(ev));
      root.appendChild(this.ttsBarEl);
    }
    this.renderTtsBar();
  }

  private renderTtsBar(): void {
    if (!this.ttsBarEl) return;
    this.ttsBarEl.innerHTML = ttsBarHtml({ paused: this.ttsPlayer?.stateName === 'paused' });
    /* 条子上只有图标：按 data-icon 交给 Obsidian 的图标集，
       不自己拼 SVG，也就不用跟着主题换颜色。 */
    for (const slot of this.ttsBarEl.querySelectorAll<HTMLElement>('[data-icon]')) {
      setIcon(slot, slot.dataset.icon ?? '');
    }
  }

  private hideTtsBar(): void {
    this.ttsBarEl?.remove();
    this.ttsBarEl = null;
  }

  /**
   * 把「正在念的这一句」框出来（2026-11-14）。
   *
   * 用宿主上的绝对定位 div，不用 foliate 的 overlayer：分栏模式下后者的
   * 坐标系跟宿主对不上，框会画到侧栏外侧。矩形由引擎统一换算成宿主坐标。
   */
  private showSpeechMark(rects: Array<{ left: number; top: number; width: number; height: number }>): void {
    this.clearSpeechMark();
    const root = this.rootEl;
    if (!root || !rects.length) return;
    const base = root.getBoundingClientRect();
    for (const r of rects) {
      const box = el('div', 'bzr-tts-mark');
      box.style.left = `${r.left - base.left}px`;
      box.style.top = `${r.top - base.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      root.appendChild(box);
      this.ttsMarks.push(box);
    }
  }

  private clearSpeechMark(): void {
    for (const box of this.ttsMarks) box.remove();
    this.ttsMarks = [];
  }

  private onTtsBarClick(ev: MouseEvent): void {
    const target = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-act]');
    if (!target) return;
    /* 条子浮在正文上：不拦住会一路冒到翻页那一层 */
    ev.preventDefault();
    ev.stopPropagation();
    const act = target.dataset.act;
    const p = this.ttsPlayer;
    if (!p) return;
    if (act === 'ttstoggle') {
      if (p.stateName === 'paused') p.resume();
      else p.pause();
      this.renderTtsBar();
    } else if (act === 'ttsstop') {
      this.stopTts();
    } else if (act === 'ttsnext') {
      p.next();
    } else if (act === 'ttsprev') {
      p.prev();
    } else if (act === 'ttsprefetch') {
      void this.prefetchChapter();
    } else if (act === 'ttsexport') {
      void this.exportSpeech();
    }
  }

  /** 按段选声音：旁白一把；对白在开了「模型认角色」时按男女分 */
  private ttsVoiceOf(
    seg: SegmentWithGender,
    voices: { narration: TtsVoice; dialogue: TtsVoice },
  ): TtsVoice {
    if (seg.kind === 'narration') return voices.narration;
    if (this.prefs.ttsAiRoles && seg.gender === 'm') return 'tide';
    if (this.prefs.ttsAiRoles && seg.gender === 'f') return 'stella';
    return voices.dialogue;
  }

  /**
   * 预生成整章音频（2026-11-13）。
   *
   * 逐段合成写缓存，翻页时直接命中，不再等 2–6 秒。代价是这一章的费用
   * 一次付清——超过 5 元先问一句，别让一次误点烧掉一整本书的钱。
   * 再点一次按钮 = 取消（当前这段合完就停）。
   */
  private async prefetchChapter(): Promise<void> {
    if (this.prefetching) {
      this.prefetching = false;
      return;
    }
    const ai = shellSettings().ai;
    if (!ai.apiKey.trim()) {
      notify(t('notice.tts.noKey'));
      return;
    }
    const segments = buildScript(this.host.currentChapterBlocks?.() ?? []);
    if (!segments.length) {
      notify(t('notice.tts.noText'));
      return;
    }
    const chars = segments.reduce((n, s) => n + billedChars(s.text), 0);
    const cost = estimateCost(chars);
    if (cost >= 5 && !window.confirm(t('notice.tts.confirmPrefetch', { cost: cost.toFixed(2) }))) return;
    this.prefetching = true;
    notify(t('notice.tts.prefetching'), 'info', 4000);
    const cacheMB = this.prefs.ttsCacheMB;
    const cache = cacheMB > 0 ? new TtsCache() : null;
    let done = 0;
    let spentChars = 0;
    try {
      for (const seg of segments) {
        if (!this.prefetching || this.closed) break;
        const voice = this.ttsVoiceOf(seg, this.ttsVoices());
        const key = cacheKey(this.bookId, voice, seg.text);
        let buf = cache ? await cache.get(key) : null;
        if (!buf) {
          try {
            buf = await synthesizeSpeech({ baseUrl: ai.baseUrl, apiKey: ai.apiKey, text: seg.text, voice });
          } catch (e) {
            /* 审核拒了这一段就跳过，别让整章预生成停在这里 */
            if ((e as { code?: string }).code === 'rejected') continue;
            throw e;
          }
          if (cache) await cache.put(key, buf, cacheMB * 1024 * 1024);
          spentChars += billedChars(seg.text);
        }
        done++;
      }
      if (done) notify(t('notice.tts.prefetched', { done: String(done) }));
    } catch {
      notify(t('notice.tts.failed'));
    } finally {
      this.prefetching = false;
      if (spentChars) this.addTtsSpend(spentChars, estimateCost(spentChars));
    }
  }

  /**
   * 导出当前页音频（2026-11-13）：逐段合成（缓存优先）→ 拼成一个 wav →
   * 写进 `bz-reader/audio/`。不写库根、不覆盖同名旧文件。
   */
  private async exportSpeech(): Promise<void> {
    const ai = shellSettings().ai;
    if (!ai.apiKey.trim()) {
      notify(t('notice.tts.noKey'));
      return;
    }
    const segments = buildScript(this.host.currentBlocks?.() ?? []);
    if (!segments.length) {
      notify(t('notice.tts.exportEmpty'));
      return;
    }
    const cacheMB = this.prefs.ttsCacheMB;
    const cache = cacheMB > 0 ? new TtsCache() : null;
    const bufs: ArrayBuffer[] = [];
    let spentChars = 0;
    try {
      for (const seg of segments) {
        const voice = this.ttsVoiceOf(seg, this.ttsVoices());
        const key = cacheKey(this.bookId, voice, seg.text);
        let buf = cache ? await cache.get(key) : null;
        if (!buf) {
          buf = await synthesizeSpeech({ baseUrl: ai.baseUrl, apiKey: ai.apiKey, text: seg.text, voice });
          if (cache) await cache.put(key, buf, cacheMB * 1024 * 1024);
          spentChars += billedChars(seg.text);
        }
        bufs.push(buf);
      }
    } catch {
      notify(t('notice.tts.failed'));
      return;
    }
    if (spentChars) this.addTtsSpend(spentChars, estimateCost(spentChars));
    const wav = concatWav(bufs);
    if (!wav) {
      notify(t('notice.tts.exportEmpty'));
      return;
    }
    const dir = 'bz-reader/audio';
    const vault = this.api.app.vault;
    try {
      if (!(await vault.adapter.exists(dir))) await vault.createFolder(dir);
      const name = `${safeFileName(this.book?.meta.title ?? 'book')}-${safeFileName(this.host.pageKey || 'page')}.wav`;
      const path = `${dir}/${name}`;
      if (await vault.adapter.exists(path)) await vault.adapter.remove(path);
      await vault.createBinary(path, wav);
      notify(t('notice.tts.exported', { name }));
    } catch (e) {
      notify(`${t('notice.tts.failed')}：${(e as Error)?.message || ''}`);
    }
  }

  /** 当前偏好下的旁白 / 对白两把嗓子 */
  private ttsVoices(): { narration: TtsVoice; dialogue: TtsVoice } {
    return this.prefs.ttsMultiVoice
      ? { narration: this.prefs.ttsNarrator, dialogue: this.prefs.ttsDialogue }
      : { narration: this.prefs.ttsVoice, dialogue: this.prefs.ttsVoice };
  }

  /** 本地估算累加；只记在这台机器上，不跟库同步 */
  private addTtsSpend(chars: number, cost: number): void {
    if (!chars) return;
    const stats = shellSettings().ttsStats;
    getShellSource()?.setSettings({
      ttsStats: {
        chars: stats.chars + chars,
        cost: Math.round((stats.cost + cost) * 1000) / 1000,
      },
    });
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
    debugEvent('nav', { dir });
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
    if (!this.speaking && !this.ttsPlayer) return;
    this.ttsRun++;
    this.speaking = false;
    this.voice?.stop();
    this.voice = null;
    this.ttsPlayer?.stop();
    this.ttsPlayer = null;
    this.clearSpeechMark();
    this.host.clearSpeechMark?.();
    this.hideTtsBar();
    this.syncToolState();
  }

  /** 强调色 → data-bzaccent；底色、文字、边框全部来自 Obsidian 变量 */
  private applyChrome(): void {
    const root = this.rootEl;
    /* 页码与书名都要跟正文的页边距、字号走，但正文在 iframe 里，宿主侧读不到
       那些值：在 root 上写一份给页码，在 leaf-content 上再写一份给头栏书名
       （书名不在 .bzs-shell 里，继承不到 root 的变量）。只写变量，不碰 DOM 结构。
       leaf-content 那一份写在 root 判空之前：壳还没建出来的首帧也要有值，
       而 leaf-content 本身不会随重开书换掉，写一次就一直有效。 */
    const fontPx = `${this.prefs.fontSize}px`;
    /* 标题、章节名、页码的字体跟着正文字体走：正文在 iframe 里用
       FONT_FAMILIES 的 css，宿主侧照抄一份（book 档不覆盖，退回宿主正文字体）。 */
    const family = FONT_FAMILIES.find((f) => f.value === this.prefs.fontFamily)?.css || 'var(--font-text, inherit)';
    const safeTop = `${this.measureSafeTop()}px`;
    this.containerEl.style.setProperty('--bzr-font-size', fontPx);
    this.containerEl.style.setProperty('--bzr-font-family', family);
    this.containerEl.style.setProperty('--bzr-page-margin', `${this.prefs.margin}px`);
    this.containerEl.style.setProperty('--bzr-safe-top', safeTop);
    if (!root) return;
    if (root.dataset.bzaccent !== this.prefs.accent) root.dataset.bzaccent = this.prefs.accent;
    root.style.setProperty('--bzr-page-margin', `${this.prefs.margin}px`);
    root.style.setProperty('--bzr-font-size', fontPx);
    root.style.setProperty('--bzr-font-family', family);
    root.style.setProperty('--bzr-safe-top', safeTop);
    /* 头栏书名不在 .bzs-shell 里，拿不到壳层的 --copper：把算出来的强调色
       写到 leaf-content 上，标题 hover 与焦点环跟着设置里的强调色走
       （点标题是打开右侧栏目录，颜色得和「强调色」这项对得上）。
       读不到就退回 CSS 里的 --text-accent。 */
    try {
      const accent = getComputedStyle(root).getPropertyValue('--copper').trim();
      if (accent) this.containerEl.style.setProperty('--bzr-accent', accent);
    } catch {
      /* 宿主换主题的瞬间可能读不到：退回 CSS 回退值，不影响标题可用 */
    }
    /* 设置里切了页码口径 / 正文字体：拿最近一次的数字与章节名立刻重算 */
    this.renderChromeText();
    /* 正文字号 / 页边距 / 字体变了，正文左缘跟着变：头栏标题的对齐也要重量 */
    this.syncHeaderTitle();
  }

  /**
   * 状态栏还占着多少高度（px）——是「阅读区顶边之上」的那一段，不是屏幕顶。
   *
   * 手机沉浸时章节名写死 `top: 10px` 会压进系统状态栏。但 Obsidian 自己
   * 已经按 `--safe-area-inset-top` 把阅读区往下推过一截了（真机量到
   * `.bzs-reader` 的顶边就在 59px），再照变量整段叠一遍，正文顶上会白白
   * 多出 59px——用户说的「上方空隙太大」就是这个。
   *
   * 所以取「安全区 - 阅读区已经让掉的量」：宿主让够了就是 0，一点没让才补
   * 到 44（刘海屏实测的最小值）。`env()` 在 Obsidian 的 WebView 里恒为 0，
   * 只能读它自己维护的变量。
   */
  private measureSafeTop(): number {
    if (!isMobileEnv()) return 0;
    let inset = SAFE_TOP_MIN;
    try {
      const v = parseFloat(getComputedStyle(document.body).getPropertyValue('--safe-area-inset-top'));
      if (Number.isFinite(v) && v > 0) inset = Math.max(v, SAFE_TOP_MIN);
    } catch {
      /* 读不到就用下限 */
    }
    const rootTop = this.rootEl?.getBoundingClientRect().top ?? 0;
    return Math.max(0, Math.round(inset - rootTop));
  }

  /**
   * 桌面：页码挂进宿主状态栏的最后（2026-11-12 用户要求）。
   *
   * 阅读区右下角那条页码在桌面会被窗口底部的状态栏挡住；状态栏本来就常驻，
   * 挂进它里面比在正文上再垫高一层干净。沉浸模式下状态栏会被藏起来，
   * 那时页码回到阅读区右下角（见 chromeLabelMode）。
   *
   * 每个阅读 tab 各挂一个 item，但只有活动的那本写字，别的 tab 留空——
   * 否则切 tab 会看到两段页码并排。
   */
  private ensureStatusPage(): void {
    if (this.statusPageEl) return;
    const doc = (this.containerEl as HTMLElement | undefined)?.ownerDocument;
    if (!doc) return;
    const bar = doc.querySelector<HTMLElement>('.status-bar');
    if (!bar) return;
    /* 放最后：状态栏最右是宿主留给「常驻信息」的位置，别插到别人的插件项前面 */
    this.statusPageEl = bar.createDiv({ cls: 'status-bar-item bzr-status-page' });
  }

  /** 宿主状态栏现在可见吗（用户可能在设置里把它关掉） */
  private statusBarVisible(): boolean {
    /* 单测里的假视图没有 containerEl：当状态栏不存在，页码走正文那条路 */
    const doc = (this.containerEl as HTMLElement | undefined)?.ownerDocument;
    const bar = doc?.querySelector<HTMLElement>('.status-bar');
    if (!bar) return false;
    return getComputedStyle(bar).display !== 'none' && bar.getBoundingClientRect().height > 0;
  }

  /**
   * 页码去状态栏还是留正文（2026-11-12 用户要求）。
   *
   * 设置里关掉状态栏：把状态栏那一项摘掉，页码退回正文右下角；
   * 又打开：重新挂上。沉浸时状态栏是我们自己藏起来的，不能当成「用户关了」，
   * 这一拍直接跳过——否则每次全屏都会把那一项摘掉。
   */
  private syncStatusPage(): void {
    if (isMobileShell() || this.host.isPdf) {
      this.statusPageEl?.remove();
      this.statusPageEl = null;
      return;
    }
    if (this.immersive) return;
    if (!this.statusBarVisible()) {
      this.statusPageEl?.remove();
      this.statusPageEl = null;
      return;
    }
    this.ensureStatusPage();
  }

  /** 这个阅读 tab 是不是当前活动的那一个（页码只给活动 tab 写） */
  private isActiveLeaf(): boolean {
    const ws = this.api.app.workspace as unknown as {
      getMostRecentLeaf?: () => WorkspaceLeaf | null;
      activeLeaf?: WorkspaceLeaf | null;
    };
    return (ws.getMostRecentLeaf?.() ?? ws.activeLeaf ?? null) === this.leaf;
  }

  private renderStatusPage(): void {
    const node = this.statusPageEl;
    if (!node) return;
    const text =
      this.isActiveLeaf() && this.lastPageInfo
        ? pageLabelText(this.prefs.pageLabel, this.lastPageInfo)
        : '';
    if (node.textContent !== text) node.textContent = text;
  }

  /**
   * 沉浸模式的两角小字：左上章节名、右下页码。
   *
   * 只在沉浸时出现——非沉浸时头栏有书名、侧栏有进度，正文上再多两行就是噪音。
   * 两角字号、字体完全一致（同一份 CSS 规则），都按正文字号的比例缩放；
   * 左缘 / 右缘分别用引擎量出的正文边距对齐。
   *
   * PDF 不画：它右下角已经有页码浮条（`4 / 278` + 滑杆），再画一块就是两套。
   * 只改 textContent，不重建节点：翻页是热路径，每页重建一次 DOM 没必要。
   */
  private renderChromeText(): void {
    /* 2026-11-12 用户改的口径：非全屏时章节名只在头栏标题里（同色），左上角
       不再重复；全屏头栏藏起来，章节名回到左上角；页码非沉浸挂在状态栏里，
       沉浸（状态栏也藏起来）才回到右下角。口径本身在 view/chrome-labels.ts。 */
    /* 页码在状态栏还是在正文，取决于宿主状态栏还在不在：先对齐挂载再判断口径 */
    this.syncStatusPage();
    const mode = chromeLabelMode({
      immersive: this.immersive,
      mobileShell: isMobileShell(),
      pdf: !!this.host.isPdf,
      statusBar: !!this.statusPageEl,
    });
    const chapter = this.chapterEl;
    let chapterText = '';
    if (chapter) {
      chapterText = mode.chapter && this.prefs.chapterLabel ? this.lastChapterTitle.trim() : '';
      if (chapter.textContent !== chapterText) chapter.textContent = chapterText;
    }
    const node = this.pageNoEl;
    if (node) {
      const text =
        mode.page && this.lastPageInfo ? pageLabelText(this.prefs.pageLabel, this.lastPageInfo) : '';
      if (node.textContent !== text) node.textContent = text;
    }
    this.rootEl?.classList.toggle('is-immersive', this.immersive);
    /* 正文顶部要不要给章节名让位，只看它到底有没有字：关掉开关后
       不该白留一条 28px 的空带 */
    this.rootEl?.classList.toggle('has-chapter', chapterText.length > 0);
    /* 桌面非沉浸的页码在宿主状态栏里，跟两角小字同一个数字来源 */
    this.renderStatusPage();
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

  /**
   * PDF 划词自动复制：等手停下来 500ms 再写剪贴板。
   *
   * 拖动选区时 selectionchange 会连发十几次，每次都写就等于往剪贴板里灌
   * 中间态；只落最后一次才和用户「划完就粘」的直觉一致。
   */
  private schedulePdfLinkCopy(info: SelectionInfo): void {
    if (this.pdfCopyTimer !== null) window.clearTimeout(this.pdfCopyTimer);
    this.pdfCopyTimer = window.setTimeout(() => {
      this.pdfCopyTimer = null;
      const book = this.book;
      if (!book) return;
      const page = pdfLocatorPage(info.cfiRange) ?? 1;
      const link = wikilinkOf(book, {
        text: info.text,
        cfiRange: info.cfiRange,
        pdfSelection: info.pdfSelection,
        pdfRect: info.pdfRect,
        /* 别名跟着设置走：摘录档（默认）贴原文，页码档贴「第 12 页」——
           自动复制和手动点「复制」必须同一种写法，否则同一本书两种链接 */
        display: pdfDisplayLabel(shellPrefs().pdfLinkLabel, {
          title: book.meta.title,
          page,
          text: info.text,
        }),
      });
      if (!link) return;
      void navigator.clipboard?.writeText(link).catch(() => undefined);
    }, 500);
  }

  private hideSelbar(): void {
    if (this.selbarHideTimer !== null) {
      window.clearTimeout(this.selbarHideTimer);
      this.selbarHideTimer = null;
    }
    if (this.pdfCopyTimer !== null) {
      window.clearTimeout(this.pdfCopyTimer);
      this.pdfCopyTimer = null;
    }
    this.selbar?.remove();
    this.selbar = null;
    this.selection = null;
    RT.sel = null;
    RT.selMarkId = '';
  }

  /**
   * 收掉正文里的选区（划词条上「落袋」的动作用完就调）。
   *
   * 只动正文 iframe 里的选区：工具条、浮层、宿主窗口自己的输入框都不碰。
   * 清完浏览器会派发一次 selectionchange，`onSelect(null)` 会把条子收掉——
   * 这正是要的；这里先把条子自己收了，避免那 320ms 的延迟里还挂着。
   */
  clearSelection(): void {
    this.host.clearSelection();
    this.hideSelbar();
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
      pdfSelection: info.pdfSelection,
      pdfRect: info.pdfRect,
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
    const marked = live && book ? findHighlight(book, live) : undefined;
    /* 划词时 `marked` 是空的（选中不落线），可这段字可能已经存过名词/段落：
       按 CFI 再找一次，那两颗才会写「看名词 / 看段落」。以前只看 marked，
       刚存完再选中同一段，按钮还写「存为名词」，点下去却打开了笔记。 */
    const saved = marked ?? (book && info.cfiRange ? findHighlight(book, info.cfiRange) : undefined);
    /* 划词时色点也要亮出「当前用哪个色」：设置页那行和这里读的是同一份
       state.pen。以前只按 marked 判，划词时四个色点都不亮，用户看不出
       上次选的颜色还记着。点已有划线时仍按那条线的颜色亮。 */
    const activeColor = marked?.color ?? getShellState().pen;

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
        colors: info.region ? [] : HIGHLIGHT_COLORS,
        /* 手机只留三颗主路径；桌面窄到放不下时，把知识库两颗收进「⋯」 */
        compact: isMobileEnv(),
        kb,
        narrow: (root.clientWidth || 0) < 520,
        acts: SELECTION_ACTS,
        /* 框选没有文字：想法 / 书摘 / AI / 名词 / 段落 全都无从下手，
           只留「双链」「复制」，色点也收起来（框选高亮走标注那条路） */
        only: info.region ? ['bilink', 'copy'] : undefined,
        /* 存的这本划线已经存过名词 / 段落：那两颗显示成「看名词 / 看段落」 */
        kbDone: kbDoneOf(saved?.kb),
        /* 设置里的工具条样式：文字 / 图标（默认文字） */
        icon: shellPrefs().toolbarStyle === 'icon',
      }),
    );
    /* 图标是宿主画的（模板里只有 data-icon 空壳），插进页面后补一遍 */
    hydrateToolbarIcons(bar);

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
    const ws = this.api.app.workspace as unknown as {
      /* 新接口：最近激活的 leaf。社区目录的机器审查会把 activeLeaf 当弃用建议
         提出来，所以先问它；老版本没有这个方法就退回 activeLeaf——两者都是
         「最近激活的那个 leaf」，语义一致，getLeaf(false) 不能替代（没有活动
         leaf 时它会退回主 leaf）。 */
      getMostRecentLeaf?: () => WorkspaceLeaf | null;
      activeLeaf?: WorkspaceLeaf | null;
    };
    const active = (ws.getMostRecentLeaf?.() ?? ws.activeLeaf ?? null) as unknown as {
      view?: { getViewType?: () => string };
    } | null;
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
      items: this.tocItems(),
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
   * 目录快照：剪藏本额外带「每组几篇 / 每篇读没读过」。
   *
   * 这些状态只存在 handle 里，foliate 的 book.toc 只有 label/href。以前目录
   * 行只有标题，读者看不出哪篇读过、每个源有多长（真机三组都提了）。
   */
  private tocItems(): import('../types/foliate').FoliateTOCItem[] {
    const items = this.host.toc();
    const handle = this.clipHandle;
    if (!handle) return items;
    return items.map((group) => {
      const kids = (group.subitems ?? []).map((sub) => {
        const ch = handle.byHref(sub.href);
        return ch ? { ...sub, state: ch.state } : { ...sub };
      });
      return { ...group, subitems: kids, count: kids.length };
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
      /* 后台那本的反链只在激活时才写进侧栏（见 publishPdfCites / publishEpubCites） */
      setShellState({ bookId: book.id, activeReaderId: book.id, cites: this.cites });
    }
    this.publishToc();
    /* 状态栏那份页码只给活动 tab 写：切回来要立刻显示自己这本的页 */
    this.renderStatusPage();
  }

  private async maybeMount(): Promise<void> {
    if (!this.stage) return;
    if (this.mounted || this.mounting || !this.bookId) return;
    const book = this.api.repo.byId(this.bookId);
    if (!book) {
      this.renderFault('这本书不在书架上', '它可能被移出书架了。回书架重新打开一次。');
      return;
    }
    const clipBook = isClipBookRecord(book);
    if (!clipBook && (book.fileRef as { fileMissing?: boolean }).fileMissing) {
      this.renderFault('找不到这本书的文件', `书架记录还在，但 ${book.fileRef.vaultPath} 已经不在了。`);
      return;
    }

    this.mounting = true;
    this.book = book;
    this.lastChapterIndex = -1;
    /* 换书时先把上一本的剪藏 handle 收掉（两个 tab 各开一本时，
       旧 handle 里的 blob 与轮询不能跟着新书活着） */
    if (this.clipHandle) {
      this.stopClipWatch();
      this.clipHandle.destroy();
      this.clipHandle = null;
      this.clipSnap = null;
      this.clipKey = '';
      this.clipScope = null;
    }
    /* 剪藏本：没有文件可读，打开时现拉一份清单，造一本 foliate 认得的书。
       拉不到（bz 没装 / 没启用 / 剪藏本读不出来）就画错误页，别白屏。 */
    let virtualBook: { book: import('../types/foliate').FoliateBook; meta: import('../data/book-meta').EngineMeta } | undefined;
    if (clipBook) {
      try {
        /* 范围从设置里取：库里几百篇读过的文章不该每次打开都重排一遍 */
        const scope = getShellSource()?.settings().clipScope ?? DEFAULT_CLIP_SCOPE;
        const snap = await loadClipBook(this.api.app, scope);
        this.clipScope = scope;
        /* 一篇都收不到：0 章节的虚拟书交给 foliate 就是整屏纯白（不 relocate、
           不报错）。直接画错误页，和「bz 没启用」同一条降级路径。 */
        if (clipBookIsEmpty(snap)) {
          this.mounting = false;
          this.renderFault(t('clip.bookTitle'), t('clip.err.empty'));
          return;
        }
        const handle = makeClipBookForApp(this.api.app, snap, (index, size) => this.host.setSectionSize?.(index, size));
        this.clipSnap = snap;
        this.clipHandle = handle;
        this.clipVersion = snap.version;
        virtualBook = {
          book: handle.book,
          meta: { title: snap.title, author: t('clip.author'), wordCount: 0 },
        };
      } catch (e) {
        this.mounting = false;
        this.renderFault(t('clip.title'), (e as Error)?.message || t('bz.missing'));
        return;
      }
    }
    /* PDF 走另一套引擎：切书时连同实例一起换。EPUB/TXT/CBZ 复用同一个
       EngineHost（它自己会在 mount 时 destroy 上一本）。 */
    if ((book.fileRef.format === 'pdf') !== this.host.isPdf) {
      await this.host.destroy();
      this.host = createEngine(book.fileRef.format, this.api.app);
    }
    /* 调试日志要能认出这会儿在读哪本：切书后 meta 跟着换，真机把日志
       发回来时才分得清「划词乱跳」发生在这本书还是上一本。 */
    setDebugMeta({ book: book.meta.title || book.id });
    /* 阅读视图是「当前在读哪本」的唯一真相。
       壳层状态要跟着它走，否则侧栏与排版面板会一直以为没有打开的书
       （表现为侧栏一屏「没有打开的书」、方向预览卡写着「这本书」）。 */
    if (getShellState().bookId !== book.id) {
      /* 换书时先清掉上一本的反链：留着只会让侧栏把「上一本被引过」
         画到新书上。两份数据都等挂好之后再推。 */
      setShellState({ bookId: book.id, cites: [], pdfPage: 0 });
    }
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
        virtualBook,
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
          /* PDF 划词自动复制链接（设置里默认关）：拖动选区时 selectionchange
             会连发很多次，等手停下来再写剪贴板，否则一路都是中间态 */
          if (this.host.isPdf && shellPrefs().pdfAutoLink) this.schedulePdfLinkCopy(info);
        },
        onAnnotTap: (info) => this.openHighlight(info),
        /* PDF 视角（旋转 / 双页）按书记住：下次打开还在刚才那个角度 */
        onPdfViewState: (state) => this.savePdfView(state),
        /* PDF 反链：页面上的虚线框由引擎画，这份清单给侧栏「引用」页签 */
        onPdfBacklinks: (rows) => this.publishPdfCites(rows),
        /* 工具栏「复制」：页链接 / 视图链接 / 嵌入 / 本页标注都由壳层拼 */
        onPdfCopy: (kind, info) => this.copyPdfLink(kind, info),
        /* 点页面上的反链框 → 打开来源笔记 */
        onPdfBacklinkTap: (info) => this.openPdfSource(info),
        /* 点文件自带批注 → 就地弹卡 */
        onPdfFileAnnotTap: (info) => this.showFileAnnot(info),
        /* 排版面板里切了「一屏一页 / 连续滚动」：写 PDF 自己那一项，不牵动 EPUB */
        onPdfFlow: (mode) => getShellSource()?.setPrefs({ pdfFlow: mode }),
        /* 跳转历史条数变了：头栏那颗「回到上一处」跟着亮 / 灰。两个引擎都报 */
        onHistoryChange: (count) =>
          this.headerEls.get('history')?.classList.toggle('is-off', count === 0),
        /* 脚注：默认在注释号上方开一小块浮窗，读完接着读。
           设置里选「跳到章末」就退回 foliate 的老行为——我们在同一条链路上
           自己调 goTo，保证两种模式只有一处判断。 */
        onFootnote: (info) => this.handleFootnote(info),
        onReady: (fb, m) => {
          /* 剪藏本：先把底条与计时挂上，再走书目/头栏那一套——后者任何一步
             出岔子都不该让底条消失（它只是阅读页的附属条）。 */
          if (clipBook) {
            this.armClipBook();
            this.rememberClipCounts();
          }
          /* 用户改过名就不再拿文件里的书名覆盖（见 data/book-meta.ts） */
          applyEngineMeta(book, m);
          /* 封面：复用刚解出来的 book 顺手落缓存并回填 coverPath。
             只读书、不开书架的用户也要有这条数据——外部读数据文件时，
             没有它就只能看到一片色块。剪藏本是虚拟书，没有封面可解。 */
          if (!clipBook) {
            void ensureCoverFromFoliate(this.api.app, book, fb).then(() => {
              const path = coverPathOf(book.id);
              if (path && book.meta.coverPath !== path) {
                book.meta.coverPath = path;
                this.api.store.touch();
              }
            });
          }
          /* 先让宿主 updateHeader 把 tab 标题重建成它自己的样子，再写我们
             的章节名：反过来会被 getDisplayText() 的书名盖回去。 */
          this.syncTabTitle();
          this.mountHeader();
          this.publishToc();
          /* EPUB 的反链在挂载完成后再扫：解析 cfi 要这本书的路径，
             太早扫会拿到上一本的书单。PDF 由引擎自己推，这里直接返回。
             扫描结果有缓存（按书路径），开书时清一次，别拿上一次的旧账。 */
          invalidatePdfBacklinks();
          if (!clipBook) this.publishEpubCites();
          this.api.store.touch();
          notifyShell();
        },
      });
      /* 视角必须在这里还原（而不是 mount 之前）：旋转要重建页骨架、
         双页要重算适配比例，都得等视图挂好。顺序也不能反——先按书记忆的
         角度/排法摆好，再套全局的翻页/滚动偏好，否则全局偏好会顶着默认值
         先把「双页」冲掉。 */
      this.host.restorePdfView?.(book.pdfView);
      if (this.host.isPdf) this.host.applyPrefs(this.prefs);
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
            /* 底栏/状态栏的高度与位置也跟着窗口变（移动端旋转、桌面改缩放） */
            this.syncBottomGap();
          }),
        );
      }
      const pending = this.pendingCfi;
      const pendingSection = this.pendingSection;
      this.pendingSection = -1;
      if (pendingSection >= 0 && this.host.startSection) {
        /* 正文改过（摘要）后重开：按章节落，旧 CFI 的字符偏移已经越界了 */
        await this.host.startSection(pendingSection);
      } else {
        await this.host.start(
          pending || book.reading.position.cfi,
          pending ? 0 : book.reading.position.percent || 0,
        );
      }
      this.pendingCfi = '';
      /* 从跨书搜索点过来：词也要标上。搜索本身是在临时引擎里跑的，
         这里不补一次，落到页面上的就只有一张没有记号的书页。 */
      const query = this.pendingQuery;
      this.pendingQuery = '';
      if (query) this.host.highlightQuery?.(query, pending);
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
    /* 打不开的书没有「第几页」：留着上一本的页码会像在报假数 */
    this.lastPageInfo = null;
    this.renderChromeText();
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
    /* 换书时先把上一本的页码收走：新书还没定位，旧数字会骗人 */
    this.lastPageInfo = null;
    this.renderChromeText();
    const box = el('div', '');
    setHtml(box, loadingHtml(title));
    stage.appendChild(box);
  }

  /* ─────────────────── 进度与会话 ─────────────────── */

  /**
   * 把这本书的反链清单交给侧栏。
   *
   * 两本书各开一个 tab 时，只有当前在读的那本写——侧栏是「这本书」的坐标，
   * 后台那本的引用不该顶掉眼前这本。值没变就不写，省掉一次整页重绘。
   */
  /* ─────────────────── PDF：复制 / 反链 / 文件批注 ─────────────────── */

  /**
   * 工具栏「复制」的四种产出。
   *
   * 引擎只报「哪一页、什么视角」，链接怎么拼是壳层的事：书在库里的路径、
   * 别名档位只有这里知道。三条链接都走 PDF++ 兼容的 hash，粘进笔记后
   * Obsidian 原生 PDF 视图、PDF++ 和本插件都能打开——`bzr=` 是给我们的
   * 精确定位，别人忽略它也不影响跳页。
   */
  private copyPdfLink(
    kind: 'page' | 'view' | 'embed' | 'marks',
    info: { page: number; offset: { left: number; top: number; zoom: number } },
  ): void {
    const book = this.book;
    if (!book) return;
    const page = Math.max(1, Math.floor(Number(info.page) || 1));
    if (kind === 'marks') {
      this.copyPageMarks(book, page);
      return;
    }
    const label = pdfDisplayLabel(shellPrefs().pdfLinkLabel, { title: book.meta.title, page });
    const path = book.fileRef.vaultPath;
    /* 嵌入只带页码：Obsidian 原生视图会把多出来的参数当噪声，
       而嵌入本来就是「看这一页」，不需要页内偏移。 */
    if (kind === 'embed') {
      this.writeClipboard(`![[${path}#page=${page}]]`);
      return;
    }
    const offset =
      kind === 'view'
        ? {
            left: Math.round(info.offset.left) || null,
            top: Math.round(info.offset.top) || null,
            zoom: Number(info.offset.zoom) || null,
          }
        : undefined;
    const sub = pdfSubpathOf({ page, offset, locator: pdfPageLocator(page) });
    this.writeClipboard(`[[${path}#${sub}|${label}]]`);
  }

  /**
   * 本页标注 → 一段 callout。
   *
   * 不列成 `- [[长链接|原文]]`：粘进笔记是要读的，一串 hash 会把正文淹掉。
   * 想回到原文再点对应的划线；这里先保住「哪本书、哪一页、写了什么」。
   */
  private copyPageMarks(book: ReaderBook, page: number): void {
    const rows = highlightsOf(book).filter((h) => pdfLocatorPage(h.cfiRange ?? '') === page);
    if (!rows.length) {
      notify(t('pdf.copy.marksEmpty'), 'info');
      return;
    }
    const title = book.meta.title || t('pdf.label.untitled');
    const lines = [`> [!quote] ${t('pdf.label.titlePage', { title, n: String(page) })}`];
    for (const h of rows) {
      const text = String(h.text ?? '').replace(/\s+/g, ' ').trim();
      if (text) lines.push(`> ${text}`);
      const note = String(h.comment ?? '').replace(/\r?\n/g, '\n> ').trim();
      if (note) lines.push('>', `> **${t('side.ideaTag')}** ${note}`);
    }
    this.writeClipboard(lines.join('\n'));
  }

  private writeClipboard(text: string): void {
    if (!text) return;
    const cp = navigator.clipboard;
    if (!cp) {
      notify(t('notice.copy.failed'), 'error');
      return;
    }
    void cp.writeText(text).then(
      () => notify(t('notice.copy.ok')),
      () => notify(t('notice.copy.failed'), 'error'),
    );
  }

  /**
   * 点页面上的反链框 → 打开写这条引用的笔记。
   *
   * 按住 Ctrl / ⌘ 开在新标签：跳出去看笔记是常事，把当前页顶掉就回不来了。
   */
  private openPdfSource(info: { sourcePath: string; event: MouseEvent }): void {
    const file = this.api.app.metadataCache.getFirstLinkpathDest(info.sourcePath, '');
    if (!file) {
      notify(t('pdf.backlink.gone'), 'error');
      return;
    }
    const mod = !!info.event?.metaKey || !!info.event?.ctrlKey;
    const leaf = mod ? this.api.app.workspace.getLeaf('tab') : this.api.app.workspace.getLeaf(false);
    void leaf.openFile(file);
  }

  /**
   * 点 PDF 文件里自带的批注 → 就地弹一小张卡。
   *
   * 不进浮层：批注是「这一句旁边有话说」，看一眼就该收，开全屏浮层等于
   * 把读者从这一页拽走。点别处 / 再点一下同一处都收起。
   */
  private showFileAnnot(info: { contents: string; author: string; anchor: Rect }): void {
    this.hideFileAnnot();
    const root = this.rootEl;
    if (!root) return;
    const card = createDiv();
    card.className = 'bzr-fa-card';
    const head = createDiv();
    head.className = 'bzr-fa-h';
    head.textContent = info.author ? t('pdf.fileannot.by', { name: info.author }) : t('pdf.fileannot.note');
    const body = createDiv();
    body.className = 'bzr-fa-b';
    body.textContent = info.contents || t('pdf.fileannot.empty');
    card.append(head, body);
    root.appendChild(card);
    const rootRect = root.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const pos = anchoredPlacement(
      {
        left: info.anchor.left - rootRect.left,
        top: info.anchor.top - rootRect.top,
        width: info.anchor.width,
        height: info.anchor.height,
      },
      { width: box.width, height: box.height },
      { width: rootRect.width, height: rootRect.height },
      isMobileEnv() ? 'below' : 'above',
    );
    card.style.left = `${pos.left}px`;
    card.style.top = `${pos.top}px`;
    this.faCard = card;
    /* 点卡片以外的地方收起。用捕获阶段，免得被正文的「点一下翻页」吞掉 */
    const off = (ev: MouseEvent): void => {
      if (card.contains(ev.target as Node)) return;
      document.removeEventListener('pointerdown', off, true);
      this.hideFileAnnot();
    };
    window.setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }

  private hideFileAnnot(): void {
    this.faCard?.remove();
    this.faCard = null;
  }

  private publishPdfCites(rows: CiteRow[]): void {
    const book = this.book;
    if (!book) return;
    /* 引擎给的是 PDF++ 的颜色名（Yellow / Red…），侧栏要 CSS 颜色。
       在这里折一次，别让渲染层去认识 PDF++ 的色名表。 */
    const styled = rows.map((row) => {
      const named = pdfColorFromName(row.color);
      return named ? { ...row, color: colorCss(named) } : { page: row.page, sourcePath: row.sourcePath, label: row.label };
    });
    /* 先自己留一份：两本书各开一个 tab 时，后台那本只记不写，等切回来再补 */
    this.cites = styled;
    const cur = getShellState();
    /* 严格比对：库里同时开着两本书时，后挂载的那本不能把先开那本的引用
       顶掉——侧栏画的是「眼前这本」，不是「最后加载的那本」。 */
    if (cur.bookId !== book.id) return;
    if (!sameCites(cur.cites, styled)) setShellState({ cites: styled });
  }

  /**
   * EPUB 的反链：从链接索引里捞「谁引了这本书的哪一句」。
   *
   * EPUB 引擎不上报这份数据（PDF 那份同时用来在页面上画虚线框，
   * EPUB 没有页面框），所以视图自己按书的路径扫。扫描结果由
   * `collectPdfBacklinks` 缓存，链接索引一动就作废重算。
   */
  private publishEpubCites(): void {
    const book = this.book;
    if (!book || this.host.isPdf) return;
    const hits = epubBacklinkHits(
      collectPdfBacklinks(this.api.app, book.fileRef.vaultPath),
      book.fileRef.vaultPath,
    );
    const rows: CiteRow[] = hits.map((h) => ({
      sourcePath: h.sourcePath,
      label: h.label,
      locator: h.cfi,
      chapter: h.chapter,
      pct: h.pct,
      text: h.text,
    }));
    this.cites = rows;
    const cur = getShellState();
    if (cur.bookId !== book.id) return;
    if (!sameCites(cur.cites, rows)) setShellState({ cites: rows });
  }

  /**
   * 链接索引变动后重算 EPUB 反链（防抖）。
   *
   * `resolved` 一次保存能连发好几下；每一下都全库扫一遍（几万篇笔记的库）
   * 会把翻页卡出顿挫。等它安静下来再算。PDF 由引擎自己刷新，不掺和。
   */
  private scheduleEpubCites(): void {
    if (this.host.isPdf) return;
    if (this.citesTimer !== null) window.clearTimeout(this.citesTimer);
    this.citesTimer = window.setTimeout(() => {
      this.citesTimer = null;
      if (this.closed) return;
      /* 链接索引已经变了：作废扫描缓存再算，否则拿到的是上一次的清单 */
      invalidatePdfBacklinks();
      this.publishEpubCites();
    }, 250);
  }

  /**
   * 按书记住 PDF 的视角（旋转 / 双页）。
   *
   * 只在值真的变了时落盘：`onPdfViewState` 在每次转角度、切排法时都会响，
   * 没变也写就是每点一下就 `touch()` 一次存储。
   */
  private savePdfView(state: { rotation: number; spread: boolean }): void {
    const book = this.book;
    if (!book) return;
    const rotation = (((Math.round((Number(state.rotation) || 0) / 90) * 90) % 360) + 360) % 360;
    const spread = state.spread === true;
    const cur = book.pdfView;
    if (cur && cur.rotation === rotation && cur.spread === spread) return;
    book.pdfView = { rotation, spread };
    this.api.store.touch();
  }

  private saveRelocate(info: RelocateInfo): void {
    const book = this.book;
    if (!book) return;
    const chapterChanged =
      (typeof info.chapterIndex === 'number' && info.chapterIndex >= 0 && info.chapterIndex !== this.lastChapterIndex) ||
      (!!info.chapterTitle && info.chapterTitle !== this.lastChapterTitle);
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
    /* 「引用」页签的「只看本页」要知道眼前是第几页。翻一页就整页广播一次
       会把侧栏重绘得很勤，所以常态只静默写入；只有开关真的开着、人又正
       看着引用页签时，才广播一次让列表跟着翻。 */
    if (this.host.isPdf) {
      const page = pdfLocatorPage(info.cfi ?? '') ?? 0;
      const cur = getShellState();
      if (page > 0 && cur.bookId === book.id && cur.pdfPage !== page) {
        if (RT.citesOnlyPage && cur.sideTab === 'cites') setShellState({ pdfPage: page });
        else setStateQuiet({ pdfPage: page });
      }
    }
    if (info.chapterTitle) this.lastChapterTitle = info.chapterTitle;
    if (typeof info.chapterIndex === 'number') this.lastChapterIndex = info.chapterIndex;
    book.reading.stats.lastReadTime = Date.now();
    if (!book.reading.stats.startReadTime) book.reading.stats.startReadTime = Date.now();
    if (
      shouldMarkComplete({
        percent: info.percent,
        live: book.meta.clipBook === true,
        completed: !!book.reading.stats.completedTime,
        threshold: COMPLETE_THRESHOLD,
      })
    ) {
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
    /* 页码：数字先存下来（设置里切口径时不用等下一次翻页），再画右下角。
       引擎已经把本章 / 全书两种口径都整理好了（见 engine/page-info.ts）。 */
    this.lastPageInfo = {
      pageInChapter: info.pageInChapter,
      pagesInChapter: info.pagesInChapter,
      bookPage: info.bookPage,
      bookPages: info.bookPages,
    };
    /* 页码要贴着正文右缘：宽屏时正文区居中、分页器还有列间距，
       只按页边距算会偏到屏幕边上。引擎量出真实距离，这里写成变量。
       章节名在左上角，同一套算法取左边。 */
    const inset = this.host.contentRightInset?.() ?? 0;
    if (inset > 0) this.rootEl?.style.setProperty('--bzr-page-right', `${inset}px`);
    const leftInset = this.host.contentLeftInset?.() ?? 0;
    if (leftInset > 0) this.rootEl?.style.setProperty('--bzr-page-left', `${leftInset}px`);
    this.renderChromeText();
    /* 头栏标题是「现在读到哪」：换章才重写，同章翻页不碰 DOM（翻页是热路径） */
    if (chapterChanged) this.syncHeaderTitle();
    /* 剪藏本：换章就切计时目标、未读的顺手标已读（只在这本书里有 handle） */
    if (chapterChanged) this.onClipChapter(info.chapterHref || '', info.chapterIndex);
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
        .map((h) => ({
          cfiRange: h.cfiRange as string,
          color: colorCss(h.color),
          chapterIndex: h.chapterIndex,
          /* PDF 的标注重开书后要靠原文重新定位；EPUB 忽略这个字段 */
          text: h.text,
        })),
    );
  }

  /** 供 shell/actions 在标注增删后回调（删划线要立刻从书页上消失） */
  refreshAfterNotesChange(): void {
    this.refreshAnnotations();
    this.syncToolState();
  }

  /* ─────────────────── 剪藏本（活书） ───────────────────
   * 三个入口：进章（标已读 + 切计时）、数据变了（换一本并回原位）、
   * 底条（原文 / 存剪藏 / 剪藏笔记 / 剪藏本）。 */

  private armClipBook(): void {
    if (!this.clipSnap || !this.clipHandle) return;
    /* 同一本书只留一个计时器：后开的视图接管，前一个停表停轮询
       （否则同一章秒数被两边各加一遍，时长静默翻倍）。 */
    const bookId = this.book?.id ?? '';
    const prev = clipOwners.claim(bookId, this);
    this.clipOwnerId = bookId;
    prev?.yieldClipBook();
    this.clipClock = new ChapterClock();
    this.clipReported.clear();
    this.clipEmptyNotified = false;
    /* 上一任视图交接时已经把队列发空（yieldClipBook）；这里换新队列防止
       重试挂载时把上一轮的时长再报一次。 */
    this.clipReportQueue = new ClipReportQueue();
    if (this.clipReportTimer !== null) {
      window.clearTimeout(this.clipReportTimer);
      this.clipReportTimer = null;
    }
    this.tracker.setSink((sec) => this.clipClock.add(sec));
    /* 打开书时先认一遍当前章：首拍 relocate 不一定被算成「换章」
       （spine 0 与初始值相同时），底条不能等下一次翻页才出现。 */
    const ch = this.currentClipChapter();
    if (ch) {
      this.clipKey = ch.key;
      this.clipClock.setKey(ch.key);
    }
    /* 头栏四颗要在 snap 就绪后再挂一遍：建壳时剪藏书还没加载完，
       ensureHeaderActions 那一刻拿不到 clipSnap，不会带上这四颗。
       （ensureHeaderActions 幂等：已存在的按 data-bzr-action 复用。） */
    const header = this.containerEl.querySelector<HTMLElement>('.view-header');
    if (header) this.ensureHeaderActions(header);
    this.renderClipBar();
    this.startClipWatch();
  }

  /** 把「几篇 · 几个源」记进书里：书架封面与卡片不用打开书就能显示。 */
  private rememberClipCounts(): void {
    const snap = this.clipSnap;
    const book = this.book;
    if (!snap || !book) return;
    if (
      book.meta.clipArticleCount === snap.articleCount &&
      book.meta.clipSourceCount === snap.sourceCount
    ) {
      return;
    }
    book.meta.clipArticleCount = snap.articleCount;
    book.meta.clipSourceCount = snap.sourceCount;
    this.api.store.touch();
  }

  /** 另一个视图接管了这本书：停表、停轮询，正文照常显示 */
  private yieldClipBook(): void {
    this.stopClipWatch();
    this.flushClipSeconds();
    /* 交接前把攒的秒数发掉：新视图会重建队列，不发就丢了这一段 */
    void this.sendClipReport();
    this.tracker.setSink(null);
    this.clipClock = new ChapterClock();
  }

  /** 当前章：优先按 key，其次按引擎的脊柱序号 */
  private currentClipChapter(): ClipChapter | null {
    const handle = this.clipHandle;
    if (!handle) return null;
    if (this.clipKey) {
      const hit = handle.byKey(this.clipKey);
      if (hit) return hit;
    }
    const idx = this.host.currentChapterIndex;
    return idx >= 0 ? handle.chapters[idx] ?? null : null;
  }

  private startClipWatch(): void {
    this.stopClipWatch();
    this.clipWatch = window.setInterval(() => {
      void this.refreshIfChanged();
    }, 20_000);
  }

  private stopClipWatch(): void {
    if (this.clipWatch !== null) {
      window.clearInterval(this.clipWatch);
      this.clipWatch = null;
    }
  }

  /** 轮询数据版本：变了才重建，没变一个字节都不动 */
  private async refreshIfChanged(): Promise<void> {
    if (this.clipRefreshing || !this.clipSnap || this.closed) return;
    /* 范围改了不算 bz 的数据变化：这里先比一次，不一致直接重建（2026-11-14） */
    const scope = getShellSource()?.settings().clipScope ?? DEFAULT_CLIP_SCOPE;
    if (scope !== this.clipScope) {
      await this.refreshClipBook();
      return;
    }
    const v = await currentClipVersion(this.api.app).catch(() => null);
    if (!v || v === this.clipVersion) return;
    await this.refreshClipBook();
  }

  /**
   * 换一本新的剪藏书，并尽量回到原处。
   *
   * 位置迁移只换 CFI 的脊柱段（章节文件名按文章 key 稳定，章内部分继续有效）；
   * 同一篇文章被删了才退回百分比。
   *
   * `chapterStart`：正文本身改过（生成摘要在章首插了导语）。这时章内字符偏移
   * 全变了，旧 CFI 一个字都不能信——真机上 foliate 解析它会抛 setEnd 越界，
   * 整本书变成「这本书打不开」。直接落到这一篇第一页。
   */
  private async refreshClipBook(opts: { chapterStart?: boolean } = {}): Promise<void> {
    if (this.clipRefreshing || !this.clipHandle || this.closed) return;
    this.clipRefreshing = true;
    const oldHandle = this.clipHandle;
    const oldKey = this.clipKey || oldHandle.byHref(this.host.currentChapterHref())?.key || '';
    const oldChapter = oldKey ? oldHandle.byKey(oldKey) : null;
    const oldIndex = oldKey ? oldHandle.indexOf(oldKey) : -1;
    const oldCfi = this.lastCfi;
    const oldPct = this.lastPct;
    /* 失败时要知道「别拿这个 CFI 重开」：坏 CFI 会再炸一次，从错误页里出不来 */
    let landing: ClipLanding = { cfi: '', section: -1, fraction: oldPct };
    try {
      const scope = getShellSource()?.settings().clipScope ?? DEFAULT_CLIP_SCOPE;
      const snap = await loadClipBook(this.api.app, scope);
      /* 先把「这本书按哪个范围建的」记下来：范围不变但内容没变时走就地同步，
         若不记，下一轮轮询又会判成范围变了，整本书每几秒重建一次。 */
      this.clipScope = scope;
      /* 数据突然一篇都没有（订阅被清空 / 读盘失败）：不要把正在读的书换成
         一本 0 章节的书（那会整屏空白），保留旧书并提示一次。 */
      if (clipBookIsEmpty(snap)) {
        this.noteClipEmpty();
        return;
      }
      /* 只变了已读 / 已剪藏这类状态：就地改，不动排版。
         以前一律重建，标一篇已读就把整本书重排一遍，同一处页码能翻三倍。
         例外：刚生成的摘要改了正文内容，必须重排才能出现（forceClipRebuild）。 */
      if (!this.forceClipRebuild && this.clipSnap && !clipStructureChanged(this.clipSnap, snap)) {
        syncClipChapterMeta(oldHandle, snap);
        this.clipSnap = snap;
        this.clipVersion = snap.version;
        this.clipEmptyNotified = false;
        this.renderClipBar();
        this.publishToc();
        return;
      }
      const handle = makeClipBookForApp(this.api.app, snap, (index, size) =>
        this.host.setSectionSize?.(index, size),
      );
      /* 换书会清掉实测页数；把「同一位置还是同一篇」的那些带过去，
         否则总页数只能拿当前这一章反推（剪藏一篇后 441 → 622）。 */
      const measured = this.host.measuredPages?.() ?? new Map<number, number>();
      const oldKeys = oldHandle.chapters.map((c) => c.key);
      await this.host.reopen?.(handle.book);
      this.host.restoreMeasuredPages?.(
        carryMeasuredPages(
          oldKeys,
          handle.chapters.map((c) => c.key),
          measured,
        ),
      );
      /* 存为剪藏会把 key 从 url: 换成 clip:：按 URL 认回同一篇，别让位置
         漂到相邻一章（真机：停在 417 期，剪藏后跳到 418 期）。 */
      const newKey = migrateClipKey(handle, oldKey, oldChapter?.url ?? '');
      const newIndex = newKey ? handle.indexOf(newKey) : -1;
      landing = clipLanding({ oldCfi, oldIndex, newIndex, oldPct, chapterStart: opts.chapterStart });
      this.clipHandle = handle;
      this.clipSnap = snap;
      this.clipVersion = snap.version;
      this.clipKey = newKey;
      this.clipClock.setKey(newKey);
      this.clipEmptyNotified = false;
      if (landing.section >= 0 && this.host.startSection) {
        await this.host.startSection(landing.section);
      } else {
        await this.host.start(landing.cfi || undefined, landing.fraction);
      }
      oldHandle.destroy();
      this.rememberClipCounts();
      this.renderClipBar();
      this.publishToc();
    } catch {
      /* 热重建失败：`start()` 的清理可能已经把整个 host 视图拆成空壳
         （destroy()），在残壳上再 open 旧书就是「一屏空白」——真机：
         生成摘要后 410 页变 1235 页、正文全白，只能关掉重开。
         这里直接按「重新打开这本书」重来一次（和用户手动重开同一条路），
         位置由 pendingCfi / pendingSection 带回；重开时万一还失败，
         会落到错误页而不是白板。 */
      this.recoverClipBook(landing.cfi, landing.section);
    } finally {
      this.clipRefreshing = false;
      this.forceClipRebuild = false;
    }
  }

  /**
   * 热重建失败后的兜底：整页重开这本书。
   *
   * 不共用 refreshClipBook 的 reopen：start() 一旦超时会先 destroy() 掉
   * host 里的视图，那个 host 已经不能再用（destroyed=true），reopen 只会
   * 留下白屏。走 maybeMount 的完整路径——重新 loadClipBook + 新建视图，
   * 和用户手动关掉再打开一模一样；pendingCfi / pendingSection 把位置带回原处。
   *
   * **绝不把已经失败的 CFI 再喂回去**：能确认坏掉的 CFI 重开一次就是再炸一次，
   * 用户从错误页里出不来。有 section 就按章落（CFI 一律丢掉），没有才用书里
   * 记的位置——而 `host.start` 现在对解析不出来的 CFI 也有兜底（退到章首）。
   */
  private recoverClipBook(cfi: string, section = -1): void {
    this.stopClipWatch();
    try {
      this.clipHandle?.destroy();
    } catch {
      /* 旧书回收失败不拦重开 */
    }
    this.clipHandle = null;
    this.clipSnap = null;
    this.clipKey = '';
    this.clipVersion = '';
    this.forceClipRebuild = false;
    this.mounted = false;
    this.mounting = false;
    this.pendingSection = section;
    /* 按章落时 CFI 一律丢掉；没有章节可依才退回书里记的位置 */
    this.pendingCfi = section >= 0 ? '' : cfi;
    void this.maybeMount();
  }

  /** 剪藏本突然读不到文章：只提示一次，别每 20 秒刷一条 */
  private noteClipEmpty(): void {
    if (this.clipEmptyNotified) return;
    this.clipEmptyNotified = true;
    notify(t('clip.err.empty'), 'info');
  }

  /** 进章：切计时目标 + 未读的标已读（href 优先，拿不到按脊柱序号认） */
  private onClipChapter(href: string, index = -1): void {
    const handle = this.clipHandle;
    if (!handle) return;
    const ch = (href ? handle.byHref(href) : null) ?? (index >= 0 ? handle.chapters[index] : null);
    if (!ch) return;
    if (ch.key !== this.clipKey) {
      this.flushClipSeconds();
      this.clipKey = ch.key;
      this.clipClock.setKey(ch.key);
    }
    this.renderClipBar();
    if (ch.state === 'unread' && !this.clipReported.has(ch.key)) {
      this.clipReported.add(ch.key);
      void markClipChapterRead(this.api.app, ch.key).then((ok) => {
        if (ok) {
          ch.state = 'read';
          this.renderClipBar();
          /* 目录行也要立刻变成已读，别等下一轮 20 秒刷新 */
          this.publishToc();
        }
      });
    }
  }

  /** 把当前章还没结账的秒数写进书的数据（切章 / 关书时调）+ 攒进待上报队列 */
  private flushClipSeconds(): void {
    /* 先结算「上次整拍到现在」：只 take 整拍的话，停 20 秒切走只记 15 秒、
       停 5 秒切走记 0 秒（真机：连续 3 章各停 5 秒，只有前一章记到 15 秒）。 */
    this.tracker.settle();
    const tick = this.clipClock.take();
    if (!tick) return;
    const ch = this.clipHandle?.byKey(tick.key) ?? null;
    /* 剪藏本那边也要这份时长：同一笔秒数写两处——书里 chapterSeconds 给
       状态栏 / 断点续读，bz 那边 readSeconds 给剪藏本列表的「· 3 分钟」。 */
    this.queueClipReport(tick.key, tick.seconds, ch);
    if (!this.book) return;
    const reading = this.book.reading;
    reading.chapterSeconds = addChapterSeconds(reading.chapterSeconds || {}, tick.key, tick.seconds);
    this.api.store.touch();
  }

  /** 攒一段待回写的秒数，并保证有一个节流窗口在跑 */
  private queueClipReport(key: string, seconds: number, ch: ClipChapter | null): void {
    if (!key || seconds <= 0) return;
    this.clipReportQueue.add({
      key,
      seconds,
      title: ch?.title ?? '',
      src: ch?.sourceName ?? '',
    });
    if (this.clipReportTimer !== null) return;
    /* 60 秒窗口：一窗口一次批量上报，同篇在这段时间里翻进翻出会合并成一条 */
    this.clipReportTimer = window.setTimeout(() => {
      this.clipReportTimer = null;
      void this.sendClipReport();
    }, CLIP_REPORT_WINDOW_MS);
  }

  /**
   * 现在就发（关书 / 切走 / 窗口到点）。
   *
   * 发失败不重排：剪藏本那边最坏少记一批，书里的 chapterSeconds 已经是准的，
   * 下一次切章会带新的秒数。反过来（失败就塞回队列）会让长期写不进盘的机器
   * 无限攒内存，不值得。
   */
  private async sendClipReport(): Promise<void> {
    if (this.clipReportTimer !== null) {
      window.clearTimeout(this.clipReportTimer);
      this.clipReportTimer = null;
    }
    const batch = this.clipReportQueue.take();
    if (!batch.length) return;
    await reportClipSeconds(this.api.app, batch);
  }

  private teardownClip(): void {
    this.stopClipWatch();
    this.flushClipSeconds();
    void this.sendClipReport();
    if (this.clipOwnerId) {
      clipOwners.release(this.clipOwnerId, this);
      this.clipOwnerId = '';
    }
    this.tracker.setSink(null);
    this.clipHandle?.destroy();
    this.clipHandle = null;
    this.clipSnap = null;
    this.clipKey = '';
    this.clipReported.clear();
    this.hideClipActions();
    this.renderStatusClip(null);
  }

  /**
   * 剪藏外壳：头栏四颗的可见性 / 保存态，以及左下角状态栏那一行。
   *
   * 2026-11-13 由底条迁来：动作进头栏（手机进 ⋮），状态进状态栏。
   * 时长不写进状态栏（每 15 秒跳一次太吵），只进 aria-label（悬停可见）。
   */
  private renderClipBar(): void {
    const ch = this.currentClipChapter();
    if (!ch) {
      this.hideClipActions();
      this.renderStatusClip(null);
      return;
    }
    if (!this.clipKey) this.clipKey = ch.key;
    const act = (id: 'clipSave' | 'clipNote' | 'clipPanel'): HTMLElement | undefined =>
      this.headerEls.get(id);
    const saveBtn = act('clipSave');
    if (saveBtn) {
      /* 已保存就不再给「存为剪藏」：留着只会被点成 alreadySaved */
      saveBtn.classList.toggle('is-hidden', ch.state === 'saved');
      saveBtn.classList.toggle('is-busy', this.clipSaving);
    }
    act('clipNote')?.classList.toggle('is-hidden', !ch.notePath);
    act('clipPanel')?.classList.remove('is-hidden');
    this.renderStatusClip(ch);
  }

  /** 离开剪藏书：三颗全部收起（普通 EPUB / PDF 里不该出现） */
  private hideClipActions(): void {
    for (const id of ['clipSave', 'clipNote', 'clipPanel'] as const) {
      this.headerEls.get(id)?.classList.add('is-hidden');
    }
  }

  /** 桌面左下角的状态栏项（只挂一次；视图销毁时在 onClose 摘掉） */
  private ensureStatusClip(): void {
    if (this.statusClipEl) return;
    const doc = (this.containerEl as HTMLElement | undefined)?.ownerDocument;
    if (!doc) return;
    const bar = doc.querySelector<HTMLElement>('.status-bar');
    if (!bar) return;
    const node = bar.createDiv({ cls: 'status-bar-item bzr-status-clip' });
    /* 左下角：左侧是宿主自己的库名 / 同步状态，插在它们前面 */
    bar.prepend(node);
    this.statusClipEl = node;
  }

  /**
   * 状态栏那行「来源 · 已读」。
   *
   * 只放这么短的一段：更长的串（这一章读了 N 分钟）会每 15 秒跳一次。
   * 手机没有状态栏、沉浸时状态栏是我们自己藏起来的，两种情况都不挂；
   * 多个阅读 tab 各挂一个，但只有活动的那本写字（与页码同款，免得并排两段）。
   */
  private renderStatusClip(ch: ClipChapter | null): void {
    const doc = (this.containerEl as HTMLElement | undefined)?.ownerDocument;
    const bar = doc?.querySelector<HTMLElement>('.status-bar');
    const usable =
      !isMobileShell() &&
      !!this.clipSnap &&
      !!bar &&
      !this.immersive &&
      getComputedStyle(bar).display !== 'none' &&
      bar.getBoundingClientRect().height > 0;
    if (!usable) {
      this.statusClipEl?.remove();
      this.statusClipEl = null;
      return;
    }
    this.ensureStatusClip();
    const node = this.statusClipEl;
    if (!node) return;
    if (!ch || !this.isActiveLeaf()) {
      if (node.textContent) node.textContent = '';
      node.removeAttribute('aria-label');
      node.classList.add('is-idle');
      return;
    }
    node.classList.remove('is-idle');
    const stateText =
      ch.state === 'saved' ? t('clip.state.saved') : ch.state === 'read' ? t('clip.state.read') : t('clip.state.unread');
    const text = [ch.sourceName, stateText].filter(Boolean).join(' · ');
    if (node.textContent !== text) node.textContent = text;
    const sec = this.book?.reading.chapterSeconds?.[ch.key] || 0;
    const mins = Math.floor(sec / 60);
    node.setAttribute('aria-label', mins > 0 ? t('clip.chapter.minutes', { m: mins }) : text);
  }

  /** 头栏 / ⋮ 里那四颗被点中 */
  private onClipAction(id: HeaderActionId): void {
    const ch = this.currentClipChapter();
    if (!ch) return;
    if (id === 'clipNote') {
      if (ch.notePath) void this.api.app.workspace.openLinkText(ch.notePath, '', false);
      return;
    }
    if (id === 'clipPanel') {
      if (!openClipbookPanel(this.api.app)) notify(t('bz.missing'), 'error');
      return;
    }
    if (id === 'clipSave') {
      if (this.clipSaving || ch.state === 'saved') return;
      this.clipSaving = true;
      this.renderClipBar();
      void saveClipChapter(this.api.app, ch.key)
        .then((r) => {
          if (r.ok || r.code === 'alreadySaved') {
            ch.state = 'saved';
            /* 剪藏刚刚把笔记写出来：立刻把路径补上，「剪藏笔记」那颗图标
               就不用等下一轮 20 秒轮询才出现 */
            if (r.notePath) ch.notePath = r.notePath;
            notify(t('clip.save.done'), 'success');
          } else {
            notify(clipSaveText(r.code), 'error');
          }
          this.clipSaving = false;
          this.renderClipBar();
        })
        .catch(() => {
          this.clipSaving = false;
          this.renderClipBar();
        });
      return;
    }
    if (id === 'clipSummary') {
      if (this.clipSummarizing) return;
      /* 剪藏笔记的摘要来自它自己的 frontmatter（bz 剪藏本里维护）。
         门面只给「还没落地成笔记」的订阅文章生成摘要，这里先分流，
         别让用户点完收到「没有正文」——那会以为文章坏了。 */
      if (ch.notePath) {
        notifyNow(t('clip.summary.clipNote'), 'info');
        return;
      }
      /* 已经有摘要就不重复花一次 AI：内容没变，重算只会得到同一段话。
         想重算的入口在 bz 那边（对剪藏笔记「重新生成当前剪藏摘要」）。 */
      if (ch.summary) {
        notifyNow(t('clip.summary.exists'), 'info');
        return;
      }
      this.clipSummarizing = true;
      this.renderClipBar();
      /* 生成要十几秒：进度条常驻到出结果（默认 3 秒就消失，看着像没点上）。
         出结果时由这里亲手收掉——绝不能留一条只能手动点的通知挂着。 */
      this.dismissClipSummaryNotice();
      this.clipSummaryNotice = notify(t('clip.summary.running'), 'info', 0);
      void summarizeClipChapter(this.api.app, ch.key)
        .then((r) => {
          this.dismissClipSummaryNotice();
          if (r.ok && r.summary) {
            /* 先进内存：这一轮重建用新快照，用户在摘要还没落盘时翻页也能看到 */
            ch.summary = r.summary;
            /* 这颗按钮和通知的位置几乎重合：鼠标压着，宿主的倒计时永远不走。
               用 notifyNow 自己掐表，3 秒后无条件收掉。 */
            notifyNow(t('clip.summary.done'), 'success');
            /* 摘要改了正文内容（章首多一段导语），两个后果：
               1) 就地同步不会重渲染这一章 → 强制换一次书；
               2) 章内字符偏移全变，旧 CFI 一解析就越界 → 落到这一篇第一页。 */
            this.forceClipRebuild = true;
            void this.refreshClipBook({ chapterStart: true });
          } else {
            notifyNow(clipSummaryText(r.code), 'error');
          }
          this.clipSummarizing = false;
          this.renderClipBar();
        })
        .catch(() => {
          this.dismissClipSummaryNotice();
          this.clipSummarizing = false;
          this.renderClipBar();
        });
    }
  }

  /** 收掉「正在生成摘要」那条常驻通知（重复调用无害） */
  private dismissClipSummaryNotice(): void {
    try {
      this.clipSummaryNotice?.hide();
    } catch {
      /* 通知已经自己没了：不拦流程 */
    }
    this.clipSummaryNotice = null;
  }

  async settle(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    /* 在跑的那次全书搜索立刻作废：它对每一条命中都会回调界面 */
    this.searchGen += 1;
    /* 摘要进度条是常驻的：关 tab 时必须收掉，否则它会一直留在屏幕上 */
    this.dismissClipSummaryNotice();
    this.stopCheckinTimer();
    /* 两本书各开一个 tab 时，关掉 A 不该把 B 的目录一起清空——
       目录快照是全局一份，只认自己那本。 */
    if (this.book && getToc()?.bookId === this.book.id) clearToc();
    this.hideSelbar();
    const book = this.book;
    if (book) {
      const session = this.tracker.end();
      /* 剪藏本：会话最后一拍已经进了章节时钟，这里结账并清池 */
      this.teardownClip();
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
    const prev = this.prefs;
    this.prefs = normalizePrefs(next);
    this.host.applyPrefs(this.prefs);
    /* 副卷是另一份引擎、另一份样式：只给主卷 push 的话，调字号/行距/主题
       时并排的右半边一直不动，看起来像「设置只对左半边生效」。 */
    this.host2?.applyPrefs(this.prefs);
    /* 设置页改「单页 / 双页」：值真的变了才动当前这本，并记进这本书。
       打开书时不走这里，所以全局默认不会冲掉每本书自己的记忆。 */
    if (this.host.isPdf && prev.pdfSpread !== this.prefs.pdfSpread) {
      this.host.pdfUi?.setSpread(this.prefs.pdfSpread);
    }
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


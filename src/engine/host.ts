/* ============================================================
 * bz-reader · 引擎宿主（engine/host.ts）
 *
 * 把 foliate-js 包成一件事：给一个 vault 路径，出来一个能翻页的书。
 * 上层（阅读视图）不认识 foliate，只认识这里的方法与回调。
 *
 * 六条纪律：
 *  1. **引擎不碰数据层**：这里只回调进度，存不存、存哪由上层决定。
 *  2. **一次只开一本**：换书先 destroy，否则 iframe 与 ResizeObserver 会叠。
 *  3. **错误就地降级**：解析失败抛出去由上层弹提示，不静默吞成白屏。
 *  4. **输入归宿主**：分页器只管触摸滑动，点哪儿翻页、滚轮算不算翻页、
 *     两指捏合改不改字号，都是阅读器的事，写在这儿是因为只有它知道
 *     iframe 的 document 什么时候换过。
 *  5. **一次手势只翻一页**：滚轮有累计阈值 + 时间闸，触摸滑动交给 foliate 的
 *     snap（它自己按速度吸附），两者都别叠成「滚一下翻三页」。
 *  6. **选字优先**：选区非空、点在链接上、被 `data-bzr-skip-tap` 标记，
 *     一律让给书籍本身处理。
 * ============================================================ */
import type { App } from 'obsidian';
import { makeBook, Overlayer } from './foliate';
import type {
  DrawAnnotationDetail,
  FoliateBook,
  FoliateContent,
  FoliateSection,
  FoliateTOCItem,
  FoliateView,
  ShowAnnotationDetail,
} from '../types/foliate';
import { buildChapterCSS } from './theme';
import { cropToSpan, type Span } from './range-text';
/* 2026-11-14：句子定位改用「块序号 + 块内偏移」，高亮改用 iframe 内的
   CSS Custom Highlight。这两样都不再需要宿主坐标换算。 */
import { anyRectInView, rangeOfAnchor, type Anchor } from '../core/tts-anchor';
import type { PageAnchor } from '../core/tts-script';
import { contentInset } from './content-inset';
import { makeTxtBook, countWords } from './txt';
import { decodeTxtBytes } from './encoding';
import { findTocHref } from './toc';
import { teardownView } from './view-teardown';
import { unionClientRects } from './selection-rect';
import {
  chooseSectionIndex,
  domToFNode,
  findFragmentTarget,
  isFootnoteRef,
  resolveFootnoteText,
  splitFootnoteHref,
} from './footnote';
import { DEFAULT_PREFS, gatedPrefs, type ReaderPrefs } from '../data/prefs';
import { bookPageInfo, chapterPageInfo } from './page-info';
import { safeFraction } from './progress-fraction';
import { COLUMN_APPLY_DELAY, columnMaxInlineSize } from './column-width';
import { can } from '../data/entitlement';
import { engineMetaFromBook, type EngineMeta } from '../data/book-meta';
import { NavHistory } from '../core/nav-history';
import { accumulateEdgeTurn, scrollEdgeOf } from './scroll-edge';
import { isReplayTap, touchTapVerdict, type TapGesture, type TapMark } from './tap-replay';
import { needsGestureBind, pickGestureDoc, zoneFromFrameY } from './gesture-binding';
import { hasLiveSelection } from './tap-gate';
import { debugEvent } from '../data/debug-log';
import { isMobileShell } from '../core/mobile';

/** 宿主坐标系里的矩形（左上角 + 宽高，单位 CSS px） */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 开书过程中视图被关掉（`container` 换了）：这不是失败，调用方该静默放弃。
 * 单独一个错误类型，别再用字符串「开书已取消」去判（P2-14）。
 */
export class OpenCancelledError extends Error {
  constructor() {
    super('开书已取消');
    this.name = 'OpenCancelledError';
  }
}

/** 一次划词：文字 + CFI 范围 + 摆浮层要用的位置 */
export interface SelectionInfo {  text: string;
  cfiRange: string;
  chapterIndex: number;
  /** 选区第一行的矩形（备用；贴浮层现在用整段 bounds） */
  anchor: Rect;
  /** 整个选区的外接矩形（判断上边放不放得下时用） */
  bounds: Rect;
  /**
   * PDF 框选：一块矩形区域（页内比例 0..1）。文字划词时没有这个字段。
   * 有它时 text 是空的——扫描页本来就没有文字可选。
   */
  region?: { page: number; left: number; top: number; width: number; height: number };
  /**
   * PDF 专有：PDF++ 的 `selection=` 四元组（文字块下标 + 块内偏移）。
   * 只给「复制成 PDF++ 兼容链接」用，无关的格式会把它丢掉。
   */
  pdfSelection?: { beginIndex: number; beginOffset: number; endIndex: number; endOffset: number };
  /** PDF 框选的页面坐标矩形（pt），对应 PDF++ 的 `rect=` */
  pdfRect?: { left: number; top: number; width: number; height: number };
}

/** 交给引擎去画的标注（宿主只认定位串与颜色） */
export interface HostAnnotation {
  /** EPUB 是 CFI；PDF 是 `pdf/<页>/<起>-<止>` 定位串 */
  cfiRange: string;
  color?: string;
  /**
   * 划线原文。PDF 的标注没有 DOM Range 可复现，重开书后要靠这段文字
   * 重新定位到页内位置；EPUB 忽略它。
   */
  text?: string;
  /** 章节序号：只重画当前章节的，省得每次翻页解析几百条 CFI */
  chapterIndex?: number;
}

export interface RelocateInfo {
  /** 整书进度 0..1 */
  percent: number;
  cfi: string;
  chapterIndex: number;
  chapterTitle: string;
  /**
   * 当前章节的目录 href。目录里 label 会重复（每个部分下都有「-1-」），
   * 只有 href 能唯一确定是哪一行——目录高亮靠它，别拿 title 比。
   */
  chapterHref: string;
  sectionCurrent: number;
  sectionTotal: number;
  /** 1 基：本章当前屏；0 = 未知（滚动模式 / 整章一屏） */
  pageInChapter: number;
  /** 本章正文屏数；0 = 未知 */
  pagesInChapter: number;
  /** 1 基：按字数估算的全书页码；0 = 未知 */
  bookPage: number;
  /** 全书估算总页数；0 = 未知 */
  bookPages: number;
  /** 剩余阅读时间（秒，foliate 按 1500 字节/秒 估） */
  remainingSeconds: number;
}

export interface SearchHit {
  cfi: string;
  excerpt: string;
}

/**
 * 上游 search.js 的 excerpt 是 {pre, match, post} 对象（不是字符串），
 * 直接传给 UI 层会在文本处理时炸成 TypeError——拍平成一段话。
 */
function excerptText(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    const e = x as { pre?: unknown; match?: unknown; post?: unknown };
    const seg = (v: unknown): string => (typeof v === 'string' ? v : '');
    return `${seg(e.pre)}${seg(e.match)}${seg(e.post)}`;
  }
  return '';
}

/** 一条脚注：点正文里的注释号之后，从目标章节抓出来的那段文本 */
export interface FootnoteInfo {
  /** 脚注正文（空白已压平） */
  text: string;
  /** 书内 href，用于「跳到原文」 */
  href: string;
  /** 目标章节序号 */
  chapterIndex: number;
  /** 被点击那个 <a> 在宿主坐标系里的位置 */
  anchor: Rect;
}

export interface MountOptions {
  prefs: ReaderPrefs;
  onRelocate?: (info: RelocateInfo) => void;
  onReady?: (book: FoliateBook, meta: EngineMeta) => void;
  /** 单指轻触正文：左 / 中 / 右 */
  onTap?: (
    zone: 'prev' | 'next',
    info: {
      x: number;
      y: number;
      width: number;
      source: string;
      scrollLeft: number;
      within: number;
      screenX: number;
    },
  ) => void;
  /** 任何手势要求翻页（滚轮 / 双指横滑 / 按钮） */
  onTurn?: (dir: 'prev' | 'next') => void;
  /** 划词（选区消失时回调 null）。移动端也一样，只是浮层位置不同 */
  onSelect?: (info: SelectionInfo | null) => void;
  /** 点中一条已画好的标注 */
  onAnnotTap?: (info: { cfiRange: string; anchor: Rect }) => void;
  /** 点到脚注引用（给了才弹预览；没给就退回 foliate 的「直接跳过去」） */
  onFootnote?: (info: FootnoteInfo | null) => void;
  /** 某次翻页 / 跳章卡住没有结果。上层据此给一句人话，别让人对着旧页面以为没点到 */
  onStall?: (what: string) => void;
  /** 两指同时轻按（不是捏合）。移动端用来切换沉浸 */
  onTwoFingerTap?: () => void;
  /**
   * iframe 里的键盘事件转发（P2-04）。
   *
   * 正文是 iframe，keydown 不会冒泡到主窗口的 document。不转的话，
   * 「在正文里点一下」之后方向键、空格、PageUp 全部失灵，连 Obsidian
   * 自己的命令热键也失效，只能先点头栏把焦点抢回来。
   *
   * 只转发 keydown；`keyup` 那边已经用于划词检测，别重复。
   */
  onKeyDown?: (ev: KeyboardEvent) => void;
  /**
   * PDF 的视图状态变了（旋转 / 双页并排）。
   *
   * 角度和排法是**每本书**的事：扫描件 A 要转 90°、正文书 B 不用。
   * 存进全局 prefs 就会「转一本，全库都横过来」。视图层只管回调，
   * 落盘由阅读视图按 book 记录（ReaderBook.pdfView）。
   */
  onPdfViewState?: (state: { rotation: number; spread: boolean }) => void;
  /**
   * PDF 的反链清单变了（开书时一次，之后链接索引变动时再补）。
   *
   * 页面上那些虚线框由引擎自己画，这份只给侧栏「引用」页签用：
   * 用户得知道「是谁引了这页」，光看见框不知道出处。
   */
  onPdfBacklinks?: (rows: Array<{ page: number; sourcePath: string; label?: string; color?: string }>) => void;
  /**
   * 工具栏「复制」菜单：壳层拼链接 / 取标注。
   *
   * 引擎只报「哪一页、什么视角」，书在库里的路径、显示文字格式、划线数据
   * 都在壳层——把它们塞进引擎会让 PDF 模块认识整本书的数据结构。
   */
  onPdfCopy?: (
    kind: 'page' | 'view' | 'embed' | 'marks',
    info: { page: number; offset: { left: number; top: number; zoom: number } },
  ) => void;
  /** 点页面上的反链框：打开写这条引用的笔记（带修饰键时壳层决定怎么开） */
  onPdfBacklinkTap?: (info: { sourcePath: string; event: MouseEvent }) => void;
  /** 点 PDF 自带的批注：把正文交给壳层弹卡 */
  onPdfFileAnnotTap?: (info: { contents: string; author: string; anchor: Rect }) => void;
  /**
   * PDF 排版面板里切了「一屏一页 / 连续滚动」。
   *
   * 存的是 PDF 自己的 `prefs.pdfFlow`（2026-11-11 起与 EPUB 的 `flow` 分开），
   * 由壳层落盘再回灌，引擎自己不存——存两份就会「这本书滚、那本书翻」。
   */
  onPdfFlow?: (mode: 'paged' | 'scroll') => void;
  /** 跳转历史条数变了：头栏那颗「回到上一处」据此亮 / 灰。两个引擎共用 */
  onHistoryChange?: (count: number) => void;
  /**
   * 虚拟书（剪藏本，2026-11-13）：不经 vault 文件，直接把造好的 foliate book
   * 交给引擎。有它时 `vaultPath` 只当标识用，不会去读盘。
   */
  virtualBook?: { book: FoliateBook; meta: EngineMeta };
}

/** 滚轮累计到多少才翻一页（像素）。触控板一次轻扫约 30–60，鼠标滚轮一格约 100。 */
const WHEEL_TURN_THRESHOLD = 42;
/** 两次翻页之间的最小间隔，挡住「惯性滚一串」。 */
const WHEEL_COOLDOWN = 300;
/** 拖拽/滑动超过这个距离才算要翻页，短线抖动不算。 */
const SWIPE_MIN = 48;
/**
 * 找脚注时最多解析几章（P2-16）。
 *
 * 以前是 120：锚点写错的书上，每点一次注释号就在主线程解析上百章 XHTML，
 * 手机上直接卡住。8 章覆盖「注文页排在正文后面几章」这个真实布局，
 * 再找不到就明确告诉用户没找到，比冻住界面好。
 */
const MAX_FOOTNOTE_SCAN = 8;
/**
 * 落点高亮（从笔记 / 双链 / 划线列表跳回原文时，目标位置闪一下）。
 *
 * key 是独立的一串，不跟划线的 CFI 抢：覆盖层按 key 存，用同一个 key 画框
 * 会把原来那条划线的填充顶掉——用户看到的是「划线不见了」，不是「就是这里」。
 */
const PULSE_KEY = '__bzr-pulse__';
/** 闪多久。一秒：够看清落点，又不会挡着读下一句 */
const PULSE_MS = 1000;
/** 读不到强调色时的兜底。紫色在四色划线（琥珀 / 朱红 / 松绿 / 黛蓝）里没有，不会认混 */
const PULSE_FALLBACK = '#7c3aed';
/**
 * 落点高亮的颜色：跟随 Obsidian 外观里的强调色。
 *
 * 用 CSS 变量而不是写死：用户换主题、换强调色，落点跟着变，
 * 插件不必再维护一份颜色。
 */
function pulseColor(): string {
  try {
    const v = getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim();
    if (v) return v;
  } catch {
    /* 测试环境 / 启动早期还没有 body */
  }
  return PULSE_FALLBACK;
}
/** 建立渲染器的耐心（毫秒）。这一步只解包/建视图，不画正文，通常几十毫秒 */
const OPEN_TIMEOUT = 15000;
/**
 * 画第一页 / 每次跳转的耐心（毫秒）。
 *
 * 和 OPEN_TIMEOUT 分开：`view.open()` 不认识 iframe，永远挂不住；真正会挂的是
 * `view.init()` / `goTo()` —— 分页器给 iframe 喂 blob 地址，只监听 `load`
 * 不监听 `error`，地址加载不了时 Promise 既不 resolve 也不 reject。
 *
 * 必须比分页器自己的 FAIL_MS（15s）大：让分页器先失败，它的错误更具体
 * （「章节渲染超时」「章节排版失败」），这里只是最后一道闸。
 */
const LOCATE_TIMEOUT = 20000;
/** 一次翻页最多等多久（超时就当没动，交给跨章兜底，别让导航队列卡住） */
const TURN_TIMEOUT = 3000;

/** 视口坐标命中的插入点：节点 + 节点内偏移 */
export interface CaretPoint {
  node: Node;
  offset: number;
}

/**
 * 视口坐标 → 插入点。
 *
 * 有两套 API：标准的 `caretPositionFromPoint`（Chromium 128 起）与 Chromium
 * 私有的 `caretRangeFromPoint`（TS 里标了 deprecated，社区目录会当建议提）。
 * 先问标准的；标准 API 存在但说「这里没有插入点」时也不再去问老的——
 * 两个 API 在同一个内核里边界语义不同，混着用会在页边留一格错位。
 * 老内核（没有标准 API）才退回 `caretRangeFromPoint`，它只通过本地形状调用，
 * 不直接依赖弃用签名。
 */
export function caretPointAt(doc: Document, x: number, y: number): CaretPoint | null {
  /* 两个 API 都通过本地形状调用，不直接吃 lib.dom 的签名：上架 lint 用的是
     宿主那套类型环境，标准 API 在那里解不出 CaretPosition，会连坐成一串
     no-unsafe-*。形状写在这里也顺便说明「只用这两个字段」。 */
  const api = doc as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  try {
    if (typeof api.caretPositionFromPoint === 'function') {
      const pos = api.caretPositionFromPoint(x, y);
      /* 标准 API 明确说这里没有插入点，就不再去问老 API：两者边界语义不同，
         混着用会在页边留一格错位。 */
      return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
    }
    const range = api.caretRangeFromPoint?.(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  } catch {
    return null;
  }
}

export class EngineHost {
  /** EPUB/TXT/CBZ 走 foliate；PDF 是另一个实现（engine/pdf/host.ts） */
  readonly isPdf = false;
  private app: App;
  private view: FoliateView | null = null;
  private book: FoliateBook | null = null;
  private container: HTMLElement | null = null;
  private prefs: ReaderPrefs = DEFAULT_PREFS;
  private opts: MountOptions = { prefs: DEFAULT_PREFS };
  private chapterIndex = 0;
  private chapterTitle = '';
  private chapterHref = '';
  /**
   * 当前页每个朗读块对应的一段原文 Range（2026-11-13，2026-11-14 改成裁到本屏）。
   *
   * 高亮要的是**原文档里的 Range**，不能拿 `cloneContents()` 的副本——副本
   * 不在 iframe 文档里，画不出框。所以 currentBlocks 在过滤可见块时顺手把
   * 「块 ∩ 本屏」的 Range 记在这里；`markSpeechText` 再在里面按句子定位。
   */
  private speechSpots: Array<{ content: FoliateContent; range: Range; el: HTMLElement }> = [];
  /**
   * 整章块对应的 Range（离线包朗读用，2026-11-14）。
   *
   * 和 `speechSpots` 分开存是**修 bug**，不是整洁癖：`speechSpots` 会被
   * 任何一次「取当前页文字」重置成页内块，而离线播放器传的是整章块序号，
   * 一重置就整体错位——真机表现就是「高亮的字有偏移」「念的和亮的不一致」。
   */
  private chapterSpots: Array<{ content: FoliateContent; range: Range; el: HTMLElement }> = [];
  /**
   * 屏幕第一个字在整章正文里的位置（2026-11-14）。
   *
   * 朗读起播靠它，不再拿页首十几个字去整章正文里搜：跨页段落、页首是小
   * 标题、残句都搜不到，静默回到章首——真机表现就是「站在第 20 页点朗读，
   * 它从第一章开头念」。序号是取这一页段落时顺手数出来的，没有搜索这回事。
   *
   * 取不到（PDF / TXT 退路 / 视口算不出来）就是 null，调用方退回文本匹配。
   */
  private pageStartAnchor: PageAnchor | null = null;
  /**
   * 每章字节数（`book.sections[i].size`）：全本页码拿它估算没读过的章节。
   * 换书时重填，空书就是空数组——拿不到 size 的格式（个别 CBZ）估算会跳过。
   */
  private sectionSizes: number[] = [];
  /**
   * 每章实测页数（章节序号 → 页数）。换章时把上一章的页数写进来，
   * 全本页码据此累加；改字号 / 页边距 / 栏数 / 翻页方式后整份作废——
   * 那几项一改，所有章节的页数都会变。
   */
  private chapterPages = new Map<number, number>();
  /** 文档级监听（每换一章重建）与容器级监听（整本书只建一次）分开存，
   *  否则换章时顺手把容器滚轮也解掉了 */
  private docDetachers: Array<() => void> = [];
  private outerDetachers: Array<() => void> = [];
  /**
   * 手势监听现在挂在哪份文档上。
   *
   * 用作「要不要重挂」的判据：relocate 每次可见位置变化都会来，同一个文档
   * 不能重复挂（会把正在进行的滑动打断），换了文档才重挂一次。
   */
  private gestureDoc: Document | null = null;

  /**
   * 真机诊断计数（给阅读页角标看，不参与任何逻辑）。
   *
   * - `binds`：手势监听挂到过几份文档上。一直是 0 = `load` 与 `relocate` 都没把
   *   监听挂上——正文照样能选中、目录照样能跳章，但点按和划词全哑。
   * - `taps`：走到「该翻页了」那一步的点按次数。不涨 = 事件没进来、或者被下面
   *   某一条前置条件拦掉了。
   * - `blocked`：被前置条件拦掉的次数（有选区 / 点在链接 / 点在划线上 / 重播）。
   *
   * 三个数放在一起，一眼就能分清「没挂上」「没进来」「进来又被拦了」。
   */
  readonly probe = { binds: 0, taps: 0, blocked: 0 };

  /** 滚轮累计位移与上次翻页时间（一次手势只翻一页） */
  private wheelAcc = 0;
  private lastTurnAt = 0;
  /**
   * 滚动模式下「贴边后继续滚」的累计位移。
   *
   * 分页模式的累计是 `wheelAcc`（够 42px 翻一页）；滚动模式下滚轮本身在滚，
   * 只有**章节已经贴边**时才需要把同样的手势换算成翻章（见 scroll-edge.ts）。
   */
  private edgeAcc = 0;
  private edgeSide: 'top' | 'bottom' | null = null;
  /** 滚动模式触摸：上一次手指的 Y（算「贴边后继续上滑」的位移） */
  private lastTouchY = 0;
  /** 拖拽翻页期间抑制紧随其后的 click */
  private suppressClickUntil = 0;
  /**
   * 双指手势只剩「两指轻按 = 切换沉浸」。
   *
   * 2026-11-08 用户拍板删掉两个改字号的入口：双指捏合与 Ctrl+滚轮。
   * 它们和系统 / 宿主的缩放手势抢同一只手，而且和「点按翻页」互相误伤——
   * 想放大看一张图，结果翻了三页。改字号回设置面板里去调。
   */
  /** 两指轻按的判定：按下时间 + 两指间距的最大变化 + 手指自身位移 */
  private twoFingerAt = 0;
  private twoFingerMove = 0;
  /** 两指落下时的间距：算「这两指几乎没动」 */
  private twoFingerSpan = 0;
  /** 两指各自的落点：手指**平行**滑走时间距不变，只有这个测得出 */
  private twoFingerPoints: Array<{ x: number; y: number }> = [];
  /**
   * 上一次真的上报出去的点按。
   *
   * 点按同时听 pointer 与 touch 两条路（见 emitTap 的注释）。以前用
   * 「pointer 走过一次完整的 pointerup 就永久只认 pointer」来去重，iPhone 上
   * 会锁死：分页器对带位移的 touchmove 一律 preventDefault，WKWebView 于是
   * 只派 pointercancel、不派 pointerup，两条路同时哑掉，点正文彻底没反应，
   * 只能关书重开。现在两条路各自独立上报，靠这里判「是不是同一次手势的重播」。
   */
  private lastTap: TapMark | null = null;
  /**
   * 阅读区可见宽度（CSS px）。
   *
   * 分页器把整章按列排开，iframe 的 documentElement 会比屏幕宽出一个数量级，
   * 用任何「文档宽度」当分母都会把手指位置判成最左边。真正能用的分母只有
   * 宿主自己知道的这一块画布宽度，由阅读视图量好传进来。
   */
  private viewportWidth = 0;
  /** 阅读区左边界（应用坐标系），用来把 iframe 里的坐标换算回屏幕位置 */
  private viewportLeft = 0;
  /**
   * 每栏宽度下发的防抖句柄与上一次的值。
   *
   * 分发器每次收到新宽度都要整章重排（分页器 `max-inline-size` 的
   * attributeChangedCallback 直接调 render），拖动窗口时不能一帧一次。
   * 值没变也必须跳过：同一次拖动里大量 resize 事件算出来的宽度是一样的。
   */
  private colWidthTimer: number | null = null;
  private colWidthApplied = -1;

  /** relocate 序号与最近一次定位的 cfi：换页是否真的发生，看这两个 */
  private relocateSeq = 0;
  private lastRelocateCfi = '';
  private relocateWaiters: Array<() => void> = [];

  /** 等一次 relocate（最多 ms 毫秒），用来替代「立刻比对页码」那种竞态判断 */
  private waitRelocate(since: number, ms: number): Promise<boolean> {
    if (this.relocateSeq !== since) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), ms);
      this.relocateWaiters.push(() => {
        window.clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /** 阅读视图在挂载与尺寸变化时调用 */
  setViewportWidth(width: number, left = 0): void {
    if (Number.isFinite(width) && width > 0) this.viewportWidth = Math.round(width);
    if (Number.isFinite(left)) this.viewportLeft = Math.round(left);
    this.scheduleColumnWidth();
  }

  /**
   * 每栏宽度跟着阅读区走。
   *
   * 分页器默认每栏 720px 封顶（`--_max-inline-size`），双栏就是整块正文
   * 1440 —— 而且这个上限**完全不看窗口有多大**。于是窗口一宽，多出来的
   * 地方全变成两侧空白：2.7K 的窗口上正文只占一半，两边各空 600 多像素。
   * 2026-11-13 用户报的「两边空白特别多、文字挤在中间」就是这一条。
   *
   * 设置里的页边距管不到这里：它写的是 iframe 里 body 的左右 padding
   * （文字到列边框），而空白来自「列边框到屏幕边」那一层，是分页器的
   * 另一套尺寸计算。所以页边距调到最小也一点用没有。
   *
   * 现在改成「阅读区宽 ÷ 栏数、每栏不超过 880」：窄窗口与旧行为逐像素一致
   * （正文照旧铺满，分页器自己还会按窗口收窄），宽窗口才用上多出来的空间。
   */
  private scheduleColumnWidth(): void {
    if (this.colWidthTimer !== null) return;
    this.colWidthTimer = window.setTimeout(() => {
      this.colWidthTimer = null;
      this.applyColumnWidth();
    }, COLUMN_APPLY_DELAY);
  }

  /** 真正把每栏宽度写给分页器（宽度没变就不碰，重排很贵） */
  private applyColumnWidth(): void {
    if (this.destroyed) return;
    const pag = this.view?.renderer as unknown as
      | { setAttribute?: (name: string, value: string) => void }
      | undefined;
    if (!pag?.setAttribute) return;
    /* 优先用视图报上来的宽度（它量的是阅读区），拿不到才回落到容器 */
    const width = this.viewportWidth || this.container?.clientWidth || 0;
    const height = this.container?.clientHeight || 0;
    /* 分页器在「阅读区宽 < 高」时把栏数强制成 1（`--_max-column-count-portrait`，
       见 vendor 里 `@container (orientation: portrait)`），这时每栏宽不该再
       除以栏数——否则用户选的双栏会退化成「半屏宽的单栏 + 两侧大空白」，
       比不修还难看。竖屏按单栏算，正文照旧铺满。 */
    const cols = height > width ? 1 : gatedPrefs(this.prefs, can('vertical')).columns;
    const px = Math.round(columnMaxInlineSize(width, cols));
    if (px === this.colWidthApplied) return;
    this.colWidthApplied = px;
    pag.setAttribute('max-inline-size', `${px}px`);
  }

  /** 装载到哪一步了。出错时告诉用户卡在哪，而不是「打不开」三个字 */
  private phase: 'idle' | 'read' | 'parse' | 'render' | 'locate' | 'ready' = 'idle';

  /** 当前渲染的章节序号（load 事件给的），用来只重画这一章的标注 */
  private sectionIndex = 0;
  /** 最近一次 relocate 的 CFI：竖排/布局切换重载章节时靠它回到原处 */
  private lastLocationCfi = '';
  /**
   * 跳转历史（「回到上一处」，2026-11-10）。
   *
   * 规则和 PDF 那边一致：**只在显式跳转之前**记一手（目录 / 书签 / 正文链接 /
   * 深链），翻页与滚动不算——否则一路翻过去，回退要按十几次。
   * 退回过程中（`navBacking`）不能再记，否则来回弹的那一处会被反复压进栈。
   */
  private nav = new NavHistory();
  /** 正在执行 back()：这一次 goToCfi 不要把当前位置再记一遍 */
  private navBacking = false;
  /** 待画标注 + CFI → 颜色索引（draw-annotation 回调只能拿到 value） */
  private annots: HostAnnotation[] = [];
  private annotColors = new Map<string, string>();
  /** 落点高亮的撤下计时器（见 pulseAt） */
  private pulseTimer: number | null = null;
  /** 选区检查的防抖句柄与「上一次已报告过哪一段」 */
  private selTimer: number | null = null;
  private lastSelKey = '';

  constructor(app: App) {
    this.app = app;
  }

  get isOpen(): boolean {
    return !!this.view;
  }

  get currentChapterIndex(): number {
    return this.chapterIndex;
  }

  /** 装载阶段（read 读文件 / parse 解包 / render 渲染首章）。出错文案要用 */
  get loadPhase(): string {
    return this.phase;
  }

  toc(): FoliateTOCItem[] {
    return this.book?.toc ?? [];
  }

  /** 当前章节的目录 href；还没 relocate 过就是空串（目录高亮用它定位唯一一行） */
  currentChapterHref(): string {
    return this.chapterHref;
  }

  /** 读 vault 文件 → File。必须整份读进内存：foliate 的 zip loader 需要 seek。 */
  private async readAsFile(vaultPath: string): Promise<File> {
    const buf = await this.app.vault.adapter.readBinary(vaultPath);
    const name = vaultPath.split('/').pop() || 'book.epub';
    return new File([buf], name);
  }

  private async buildBook(vaultPath: string): Promise<{ book: FoliateBook; meta: EngineMeta }> {
    const name = (vaultPath.split('/').pop() || 'book').replace(/\.[^.]+$/, '');
    if (/\.txt$/i.test(vaultPath)) {
      /* TXT 不能按 UTF-8 读（A-06）：中文 txt 大量是 GBK，`adapter.read` 会
         解成一片「锟斤拷」。统一拿字节，交给 decodeTxtBytes 判 BOM / 试编码。 */
      const buf = await this.app.vault.adapter.readBinary(vaultPath);
      const text = decodeTxtBytes(buf).replace(/^\uFEFF/, '');
      const book = makeTxtBook(text, { title: name });
      return { book, meta: { title: name, author: '', wordCount: countWords(text) } };
    }

    const file = await this.readAsFile(vaultPath);
    const book = await makeBook(file);
    // 漫画（cbz）的 section size 是图片字节数——按字数累加会得出「三百多万字」，
    // 书架上吓人。漫画没有字数，直接给 0。
    const wordCount = /\.cbz$/i.test(vaultPath) ? 0 : book.sections.reduce((sum, s) => sum + (s.size ?? 0), 0);
    /* 书目提取全在 data/book-meta.ts：foliate 的 author 是 contributor 对象
       （tidy 之后连数组都不是）。以前那个只认字符串的 pick() 让作者从来没落过盘。 */
    return { book, meta: engineMetaFromBook(book, name, wordCount) };
  }

  async mount(container: HTMLElement, vaultPath: string, opts: MountOptions): Promise<void> {
    await this.destroy();
    /* 上一个 destroy 立的旗子在这里放下：同一个 host 会被反复用来开不同的书，
       旗子不清掉的话，重开之后的标注与搜索全被当成「关书后的迟到回调」丢掉。 */
    this.destroyed = false;
    /* 换书会换一个新的分页器（新元素上没有 max-inline-size 属性）。
       不清掉「上一次下发的值」，同宽度的下一本书就会被判定成「没变化」、
       永远停在默认 720——正是这次要修的那个现象。 */
    this.colWidthApplied = -1;
    /* 换书/重开时上一次点按的记录要丢掉：留着它的话，新书打开后 80ms 内
       在第一下位置点下去会被当成「刚才那一下的重播」，无端少翻一页。 */
    this.lastTap = null;

    this.opts = opts;
    this.prefs = opts.prefs;
    this.container = container;
    /* 换书：上一本记下的「上一处」不能拿来跳这一本 */
    this.nav.clear();
    this.navBacking = false;
    this.lastLocationCfi = '';

    this.phase = 'read';
    const { book, meta } = opts.virtualBook ?? (await this.buildBook(vaultPath));
    /* 解包期间可能已经被关书 / 换书（看门狗、用户点回书架）：这一轮就作废，
       别把书挂到一个已经不存在的画布上。 */
    if (this.container !== container) {
      book.destroy?.();
      throw new OpenCancelledError();
    }
    this.book = book;
    /* 全本页码的估算底数：每章字节数。换书必须重填、旧实测页数必须清掉，
       否则上一本的页数会累加进这一本 */
    this.sectionSizes = (book.sections ?? []).map((s) => Number(s.size) || 0);
    this.chapterPages.clear();

    /* 上层可能先画了「正在打开」占位；foliate 要独占这个容器 */
    container.empty();
    this.phase = 'parse';

    /* foliate-view 是自定义元素（customElements.define 在 foliate 运行时里），
       不在 HTMLElementTagNameMap 的类型表里——createEl 运行时照建不误。 */
    const view = createEl('foliate-view' as unknown as keyof HTMLElementTagNameMap) as unknown as FoliateView;
    view.className = 'bzr-view';

    view.addEventListener('relocate', (e) => {
      const d = (e as CustomEvent).detail as {
        fraction?: number;
        section?: { current: number; total: number };
        time?: { total: number };
        tocItem?: FoliateTOCItem | null;
        cfi?: string;
      };
      const percent = safeFraction(d.fraction);
      /* 正文真的出字了。诊断页靠这个把「卡在读/解包/分页」和「只是在排版」分开 */
      if (this.phase !== 'ready') this.phase = 'ready';
      this.chapterIndex = d.section?.current ?? this.chapterIndex;
      this.chapterTitle = d.tocItem?.label ?? this.chapterTitle;
      this.chapterHref = d.tocItem?.href ?? this.chapterHref;
      this.relocateSeq += 1;
      /* 兜底补挂：`load` 事件在某些真机上整场不派发（iframe 复用换章时最明显），
         那一来点击、划词、滚轮三组监听一个都挂不上——正文照样能选中、目录照样
         能跳章，就是点不动。`relocate` 在每次可见位置变化时必达，用它幂等补一次。 */
      this.ensureDocGestures();
      this.lastRelocateCfi = d.cfi ?? this.lastRelocateCfi;
      debugEvent('relocate', {
        i: this.chapterIndex,
        pct: Math.round(percent * 1000) / 10,
        cfi: (d.cfi ?? '').slice(0, 30),
      });
      const waiters = this.relocateWaiters;
      this.relocateWaiters = [];
      for (const w of waiters) w();
      /* 页码口径统一在这里整理：本章用分页器的屏数；全书按章累加——
         前面各章用实测页数（没读过的按字节数估），本章用当前屏号。
         滚动模式本章没有「屏」，交给 chapterPageInfo 自己判成未知。 */
      const chapter = chapterPageInfo(
        view.renderer as unknown as { page?: number; pages?: number } | undefined,
        this.prefs.flow === 'scroll',
      );
      /* 先记下本章实测页数，再算全书：换章后的第一次 relocate 就能接上上一章 */
      if (chapter.pages > 0) this.chapterPages.set(this.chapterIndex, chapter.pages);
      const book = bookPageInfo({
        sizes: this.sectionSizes,
        measured: this.chapterPages,
        index: this.chapterIndex,
        pageInChapter: chapter.page,
        pagesInChapter: chapter.pages,
      });
      this.opts.onRelocate?.({
        percent,
        cfi: d.cfi ?? '',
        chapterIndex: this.chapterIndex,
        chapterTitle: this.chapterTitle,
        chapterHref: this.chapterHref,
        sectionCurrent: d.section?.current ?? 0,
        sectionTotal: d.section?.total ?? 0,
        pageInChapter: chapter.page,
        pagesInChapter: chapter.pages,
        bookPage: book.page,
        bookPages: book.pages,
        remainingSeconds: Math.round(d.time?.total ?? 0),
      });
    });

    // 每次换章都会来一个 load：手势监听挂在当前文档上，旧文档随 iframe 一起丢弃
    view.addEventListener('load', (e) => {
      const { doc, index } = (e as CustomEvent).detail as { doc: Document; index: number };
      this.sectionIndex = index;
      this.bindDocGestures(doc);
    });

    // 记录最近一次定位（relocate 的 CFI）：竖排切换重载章节时靠它回到原处
    view.addEventListener('relocate', (e) => {
      const cfi = (e as CustomEvent).detail as { cfi?: string };
      if (cfi?.cfi) this.lastLocationCfi = cfi.cfi;
    });

    // 标注：view 只负责按 CFI 解析出 Range，画成什么样由我们决定
    view.addEventListener('draw-annotation', (e) => {
      const d = (e as CustomEvent).detail as DrawAnnotationDetail;
      const color = this.annotColors.get(d.annotation.value);
      if (color === undefined) return;
      try {
        // writingMode 要跟着章节文档走：竖排的划线笔刷落在右半、线压右缘，
        // 横排落在下半、线压底缘（overlayer.highlight 读这个字段分流）
        d.draw(Overlayer.highlight, { color, writingMode: getComputedStyle(d.doc.body).writingMode });
      } catch (err) {
        // 跨段落的选区偶尔解析成空 Range：画不出来就算了，别打断阅读
        console.warn('[bz-reader] 标注画不出来：', err);
      }
    });

    // 覆盖层是延后挂到 iframe 上的：等它挂好再补画这一章的标注
    view.addEventListener('create-overlay', () => {
      queueMicrotask(() => this.redrawAnnotations());
    });

    // 点中已有标注
    view.addEventListener('show-annotation', (e) => {
      const d = (e as CustomEvent).detail as ShowAnnotationDetail;
      if (!this.annotColors.has(d.value)) return;
      const rects = Array.from(d.range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      const doc = d.range.startContainer.ownerDocument;
      /* 整条划线的外接矩形：手机端浮层贴在最后一行下方，桌面端贴第一行上方。
         只取 rects[0] 时多行划线会把下面几行盖住。 */
      const anchor = doc && rects.length ? unionClientRects(rects, this.frameGeom(doc)) : { left: 0, top: 0, width: 0, height: 0 };
      this.opts.onAnnotTap?.({ cfiRange: d.value, anchor });
    });

    /**
     * 链接。foliate 自带一套处理：外部链接 `globalThis.open`，书内链接 `goTo`。
     * 它这两条都不问我们，所以我们只在真正要插手的时候 preventDefault 截下来，
     * 其余原样放行——
     *   · 脚注：弹小窗预览，而不是把人甩到书末再让他自己找回来；
     *   · 外链：只放 http(s)。书是外部文件，里面写 `javascript:` 不稀奇，
     *     跟着 open 一次等于把 Electron 的上下文交出去。
     */
    view.addEventListener('link', (e) => {
      const d = (e as CustomEvent).detail as { a?: HTMLAnchorElement | null; href?: string };
      const href = d?.href;
      const a = d?.a ?? null;
      if (!href || !a || !this.opts.onFootnote) return;
      /* `<sup><a>1</a></sup>` 是老书最常见的写法：锚点自己看不到 sup，
         转换时把祖先标签带上，判定才是完整的 */
      const ancestors = a.closest('sup') ? ['sup'] : [];
      if (!isFootnoteRef(domToFNode(a, { ancestors }))) return;
      e.preventDefault();
      const doc = a.ownerDocument ?? null;
      const anchor = doc ? this.toHostRect(a.getBoundingClientRect(), doc) : { left: 0, top: 0, width: 0, height: 0 };
      const label = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
      void this.readFootnote(href, label)
        .then((info) => {
          if (info) {
            this.opts.onFootnote?.({ ...info, anchor });
            return;
          }
          /* 抓不到正文（结构太怪 / 跨章互链）：退回 foliate 原来的行为，
             直接跳过去，别让人点了没反应。 */
          void this.goToHref(href);
        })
        .catch(() => void this.goToHref(href));
    });

    view.addEventListener('external-link', (e) => {
      const d = (e as CustomEvent).detail as { href?: string };
      e.preventDefault();
      const href = d?.href ?? '';
      if (!/^https?:\/\//i.test(href)) {
        console.warn('[bz-reader] 拦下非 http(s) 链接：', href.slice(0, 80));
        return;
      }
      window.open(href, '_blank', 'noopener,noreferrer');
    });

    container.appendChild(view);

    // iframe 之外的空白（页码栏、边距）也要吃滚轮
    this.bindOuterWheel(container);

    /* 首章渲染必须有出口。
       foliate 的分页器给 iframe 喂的是 blob 地址，且只监听 `load` 不监听
       `error`：地址加载不了时（典型是宿主页面源不透明，blob:null 的 iframe
       永远不发 load）这个 Promise 既不 resolve 也不 reject，界面就停在白屏。
       所以这里自己掐表——超时也当失败处理，好过让用户对着空白猜。 */
    this.phase = 'render';
    try {
      const opened = await Promise.race([
        view.open(book).then(() => 'ok' as const),
        new Promise<'timeout'>((r) => window.setTimeout(() => r('timeout'), OPEN_TIMEOUT)),
      ]);
      if (opened === 'timeout') throw new Error(`渲染首章 ${OPEN_TIMEOUT / 1000}s 无响应`);
      if (this.container !== container) throw new OpenCancelledError();
    } catch (err) {
      /* 首章失败：把 foliate 视图和 book 一起拆掉（P3-21）。
         只 remove() 视图的话，book 里那些已经解出来的章节/资源（blob URL）
         会一直挂着——打开一本坏书就等于漏一次内存。
         必须走 teardownView（B7）：close() 自己抛错时 sections 与 mediaQuery
         监听都还挂在全局对象上，`catch { 忽略 }` 把它们留到了下一次开书。 */
      teardownView(view);
      view.remove();
      book?.destroy?.();
      this.view = null;
      this.book = null;
      this.phase = 'idle';
      throw new Error(`这本书打不开：${(err as Error)?.message || '格式不受支持'}`);
    }

    this.view = view;
    /* 这里**不能**写成 ready：正文一行还没画。等第一次 relocate 再翻牌，
       否则诊断页会把「分页卡死」显示成「已经就绪」，等于没有线索。 */
    this.applyPrefs(this.prefs);
    opts.onReady?.(book, meta);
  }

  /**
   * 换掉当前这本书的内容（剪藏本实时刷新用）。
   *
   * 不重建 foliate-view，只把新 book 塞进去重新 open——DOM 与手势监听都留下，
   * 刷新后调用方自己 `start(cfi)` 回到原位。
   *
   * **必须先 `close()` 再 `open()`**：foliate 的 View.open 每调一次都会
   * `append` 一个新的 renderer（paginator），自己不收旧的、也不复用。只
   * open 的话旧的那份还占着原来的位置，新的被排到它下面（整体下移一个阅读
   * 区高度）：页码、底条、目录高亮都跟着新 renderer 走，屏幕上却一直是刷新
   * 前那一页，翻页/换章都不动。这是剪藏本「读 20 秒就成死书」的根因。
   * close() 只拆 renderer 与历史，不碰宿主 DOM 与事件监听。
   */
  async reopen(book: FoliateBook): Promise<void> {
    const view = this.view;
    if (!view) return;
    try {
      this.book?.destroy?.();
    } catch {
      /* 旧书回收失败不拦换书 */
    }
    try {
      view.close();
    } catch {
      /* 旧 renderer 收尾失败也不能拦新书（最多多留一份到下次开书） */
    }
    this.book = book;
    this.sectionSizes = (book.sections ?? []).map((s) => Number(s.size) || 0);
    this.chapterPages.clear();
    this.chapterIndex = 0;
    this.chapterTitle = '';
    this.chapterHref = '';
    this.lastLocationCfi = '';
    await view.open(book);
    this.applyPrefs(this.prefs);
  }

  /**
   * 某一章的正文长度变准了（剪藏本按需渲染后回填）。
   *
   * 只改估算底数，不动已实测的页数：本章页数来自分页器，其它章按字节估。
   * 下一次 relocate 就会用新底数算全书页码。
   */
  setSectionSize(index: number, size: number): void {
    const n = Number(size);
    if (!Number.isFinite(n) || n <= 0 || index < 0 || index >= this.sectionSizes.length) return;
    this.sectionSizes[index] = n;
  }

  /** 实测页数快照（换书重建时带给新书，避免总页数从当前这一章反推） */
  measuredPages(): Map<number, number> {
    return new Map(this.chapterPages);
  }

  /** 重建后恢复实测页数（调用方只传「同一位置还是同一篇」的那些） */
  restoreMeasuredPages(pages: ReadonlyMap<number, number>): void {
    for (const [index, n] of pages) {
      if (index >= 0 && index < this.sectionSizes.length && n > 0) this.chapterPages.set(index, n);
    }
  }

  /**
   * 打开后定位。优先 CFI；CFI 解析不出来（换过文件、TXT 的 CFI 形状不同）
   * 就退回百分比——宁可差几页，也别每次打开都回到第一页。
   *
   * 这一步才是真正画第一页的地方（`open()` 只挂渲染器，不出字）。分页器等
   * iframe 的 `load` 却不听 `error`，地址加载不了就一直悬着，所以必须掐表：
   * 超时抛出去，由阅读视图画错误页——绝不能让它安静地 await 到天荒地老。
   */
  async start(cfi?: string, fraction = 0): Promise<void> {
    const view = this.view;
    if (!view) return;
    await this.locate(async () => {
      if (cfi) {
        const resolved = view.resolveNavigation(cfi) as { index?: number } | null | undefined;
        if (resolved) {
          try {
            await view.init({ lastLocation: cfi });
            return;
          } catch {
            /* CFI 里带的是重建前正文的字符偏移：正文改过之后（生成摘要在章首
               插了导语），同一个偏移会落到一个更短的文本节点上，foliate 解析
               range 时直接抛 setEnd 越界——真机上就是整本书变「这本书打不开」。
               位置退化到这一章第一页：书能开，人还在这一篇，正文接着读。 */
            const index = Number(resolved.index);
            await view.init({ lastLocation: Number.isFinite(index) ? index : 0 });
            return;
          }
        }
      }
      await view.init({ showTextStart: true });
      if (fraction > 0.002) {
        await view.goToFraction(Math.min(1, fraction)).catch(() => undefined);
      }
    });
  }

  /**
   * 定位到第 index 章的第一页。
   *
   * 和 `start(cfi)` 的分工：正文没变就迁 CFI 接着读原位置；正文变了（摘要
   * 插进章首）CFI 一定对不上，调用方直接用这条落到这一篇开头，不要拿旧
   * CFI 去赌能不能解析出来。
   */
  async startSection(index: number): Promise<void> {
    const view = this.view;
    if (!view) return;
    const count = this.book?.sections?.length ?? 0;
    if (!Number.isFinite(index) || index < 0 || index >= count) {
      await this.start();
      return;
    }
    await this.locate(async () => {
      /* foliate 的 init 收 number 就是「跳到这一章第一页」：
         resolveNavigation(number) → { index } → renderer.goTo({ index })，
         不经过任何 CFI，正文怎么改都不会越界。
         但 `lastLocation: 0` 是假值，foliate 内部会当成「没给位置」而去翻下一页，
         `next()` 在章尾又不动——表现就是「点了没反应」。第 0 章走 text start，
         和用户从书首打开是同一页。 */
      await view.init(index === 0 ? { showTextStart: true } : { lastLocation: index });
    });
  }

  /** 定位的公共流程：掐表、失败拆视图、成功后翻牌（start / startSection 共用） */
  private async locate(render: () => Promise<void>): Promise<void> {
    this.phase = 'locate';
    let timer = 0;
    try {
      const done = await Promise.race([
        render().then(() => 'ok' as const),
        new Promise<'timeout'>((r) => {
          timer = window.setTimeout(() => r('timeout'), LOCATE_TIMEOUT);
        }),
      ]);
      if (done === 'timeout') throw new Error(`正文 ${LOCATE_TIMEOUT / 1000} 秒没能分页出来`);
    } catch (err) {
      /* 分页失败 / 超时：**先把视图拆干净再抛**（B4）。
         以前只把 phase 改回 locate 就抛：界面上是错误页，内存里整本书的
         sections 与 blob 注册表还在，用户再点一次开书就是第二份。 */
      await this.destroy();
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
    this.phase = 'ready';
    /* 首章渲染出来之后再下发每栏宽度：mount 结束时 renderer 还没挂上，
       那一次 applyColumnWidth 会被跳过，页面就停在分页器默认的 720。 */
    this.applyColumnWidth();
  }

  /* ─────────────────── 输入 ─────────────────── */

  private turn(dir: 'prev' | 'next'): void {
    const now = Date.now();
    if (now - this.lastTurnAt < WHEEL_COOLDOWN) return;
    this.lastTurnAt = now;
    debugEvent('turn', { dir });
    this.opts.onTurn?.(dir);
  }

  /**
   * 滚动模式：章节已经贴边，还在继续往同一个方向滚 → 翻到相邻章。
   *
   * 返回 true 表示这次手势已经转成翻章。非滚动模式、固定版式
   * （foliate-fxl 没有这些 getter）、位置读不到时都直接 false。
   *
   * 以前完全没有这条路：`#container` 滚到底就停住，用户只能去点目录。
   * 判断与累计都交给 scroll-edge.ts，这里只负责读 paginator 的位置。
   */
  private scrollEdgeTurn(delta: number): boolean {
    if (this.prefs.flow !== 'scroll' || !delta) return false;
    const r = this.view?.renderer as unknown as
      | { start?: number; end?: number; viewSize?: number }
      | undefined;
    if (!r) return false;
    let start = 0;
    let end = 0;
    let viewSize = 0;
    try {
      /* 三个 getter 都读 #container / #view；换章的空窗里可能是空的 */
      start = Number(r.start);
      end = Number(r.end);
      viewSize = Number(r.viewSize);
    } catch {
      return false;
    }
    const edge = scrollEdgeOf({ start, end, viewSize });
    const res = accumulateEdgeTurn({ acc: this.edgeAcc, side: this.edgeSide }, delta, edge);
    this.edgeAcc = res.state.acc;
    this.edgeSide = res.state.side;
    if (!res.turn) return false;
    this.turn(res.turn);
    return true;
  }

  /**
   * 滚轮翻页。`deltaMode` 1 = 行（Firefox 鼠标滚轮报的是行数，一格约 3），
   * 2 = 页。统一折算成像素再比阈值，否则 Firefox 上永远翻不动。
   */
  private handleWheel(ev: WheelEvent): void {
    const unit = ev.deltaMode === 1 ? 32 : ev.deltaMode === 2 ? 800 : 1;
    const dy = ev.deltaY * unit;
    const dx = ev.deltaX * unit;
    const main = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
    if (!main) return;

    /* Ctrl/⌘ + 滚轮不再改字号（用户拍板删掉这个入口）。
       默认行为要拦：不拦的话这一下会落到宿主 / 浏览器的整页缩放上，
       用户以为「字号入口删了」，实际变成把整个界面放大缩小。 */
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      return;
    }

    /* 滚动模式（P2-02）：滚轮交给浏览器自己滚，不拦、不翻页。
       这是桌面阅读的第一诉求——想往上回看两行，分页模式只能整页翻回去。

       只有「已经滚到章末/章首还继续滚」才接管，换来「一章滚完自动下一章」。 */
    if (this.prefs.flow === 'scroll') {
      this.scrollEdgeTurn(main);
      return;
    }

    ev.preventDefault();
    this.wheelAcc += main;
    if (Math.abs(this.wheelAcc) < WHEEL_TURN_THRESHOLD) return;
    const dir = this.wheelAcc > 0 ? 'next' : 'prev';
    this.wheelAcc = 0;
    this.turn(dir);
  }

  private bindOuterWheel(container: HTMLElement): void {
    const onWheel = (ev: WheelEvent): void => this.handleWheel(ev);
    container.addEventListener('wheel', onWheel, { passive: false });
    this.outerDetachers.push(() => container.removeEventListener('wheel', onWheel));
  }

  /** 绑到 iframe 当前文档：点按三区 / 滚轮 / 鼠标拖拽 / 双指 */
  private bindGestures(doc: Document): void {
    // 竖排感知：注入的 writing-mode 在引擎判定方向前就已生效，这里读到的是准的。
    // 竖排从右往左读，「下一页」在左边——点击与拖拽的方向映射全部反过来。
    /* 读方向只是元信息：拿不到就保持上一次的判断，**绝不能让它抛出去**。
       这个函数是整组监听的总入口，前面一抛，后面所有 addEventListener 都跑不到，
       表现就是「正文能选中、目录能跳章，但点按和划词全哑」。 */
    try {
      const computed = doc.defaultView?.getComputedStyle(doc.body);
      const writingMode = computed?.writingMode ?? '';
      this.verticalContent = writingMode.startsWith('vertical');
      this.rtlContent = (computed?.direction ?? '') === 'rtl';
    } catch {
      /* 下一次 load 会再读一遍 */
    }

    /* ① 点按三区。
       不用 `click`：移动端一次触摸可能合成两次 click（一次给 iframe、一次给
       应用），一次点按被记成两次翻页——「翻过去又翻回来」就是它。
       也不用「只看 pointer」：部分 WebView 在 preventDefault 过的 iframe 里
       干脆不派发 pointer 事件，那样真机上会完全没反应。所以 pointer 与 touch
       两条路都听，都汇到 emitTap，由 tap-replay 判掉重复的那一次。

       两条路必须**各自独立**能翻页（这一条是 2026-11-08 改的）：以前用一个
       `pointerWorks` 单向开关，pointer 走过一次完整 pointerup 就永久关掉
       触摸兜底。iPhone 上分页器对带位移的 touchmove 一律 preventDefault，
       WKWebView 只派 pointercancel 不派 pointerup，于是开关已经立起来、
       兜底又被关掉——点正文彻底没反应，只能关书重开。 */
    const TAP_MOVE_PX = 12;
    const TAP_LONG_PRESS_MS = 500;

    /* 屏上正在进行的那次触摸手势。`reported` 由 emitTap 置位：
       pointer 这条路报过之后，touchend 只是回声，不能再翻一页。 */
    let touchTap: TapGesture | null = null;

    const emitTap = (
      x: number,
      y: number,
      target: EventTarget | null,
      source: string,
      screenX = 0,
      screenY = 0,
    ): void => {
      const now = Date.now();
      if (now < this.suppressClickUntil) {
        this.probe.blocked += 1;
        debugEvent('blocked', { why: 'suppress', src: source });
        return;
      }
      if (hasLiveSelection(doc)) {
        /* 有选区时点正文不翻页，但**一个字都不动**。
           这里曾经顺手 `removeAllRanges()`，安卓上就变成「长按选字、抬手闪一下
           没了」：长按后的抬手本身会被判成一次点按，刚选中的字立刻被清掉，
           selectionchange 又把工具条一并收起。收起选区是浏览器原生行为（点空白
           处自己收），不需要我们代劳；代劳只会毁掉用户刚做的选择。 */
        this.probe.blocked += 1;
        debugEvent('blocked', { why: 'selection', src: source });
        return;
      }
      const node = target as HTMLElement | null;
      if (node?.closest?.('a[href], [data-bzr-skip-tap]')) {
        this.probe.blocked += 1;
        debugEvent('blocked', { why: 'link', src: source });
        return;
      }
      /* 点在划线上是要看那条标注，不是要翻页 */
      if (this.hitsAnnotation({ clientX: x, clientY: y })) {
        this.probe.blocked += 1;
        debugEvent('blocked', { why: 'annot', src: source });
        return;
      }
      /* 分母必须是「一页有多宽」，不是 html 元素的宽。
         分页器把整章按列排开，documentElement.clientWidth 会是整章的宽度
         （实测 14611px），拿它当分母时手指点哪儿都判成最左边，
         于是每次点按都往「上一页」翻——用户看到的「点一下往上翻」就是它。 */
      const win = doc.defaultView;
      const frame = (win?.frameElement ?? null) as HTMLIFrameElement | null;
      /* 分母用阅读区可见宽度（见 viewportWidth 注释）；没有就退回帧宽 */
      const width = this.viewportWidth || frame?.clientWidth || win?.innerWidth || 1;
      /* 真机的 clientX 会带上整章的平移量（同一位置连着翻页时 x 每页加一个页宽），
         直接当屏幕位置用会把整章后段全部判成最右边。这里把 iframe 的坐标先换算回
         应用坐标系（加上帧自身的 left），再减掉阅读区左边界，才是「点在可见区的哪儿」。 */
      /* 坐标换算：真机上 clientX 会带上整章的平移量（同一位置连着翻页时 x 每页
         加一个页宽），桌面上却又是视口坐标。screenX 两边都是「屏幕上的位置」，
         减掉窗口自己的 screenX 就回到应用坐标，再减阅读区左边界即可。 */
      /* 阅读区的位置每次点按都重新量：挂载时量的那一次可能是抽屉/侧栏还开着
         （真机上量到 left≈170，于是所有点按都被算到偏左，整屏都成了“上一页”）。 */
      /* 阅读区只量**自己这份**：以前在主文档里全局查 `.bzs-stage`，两个阅读
         tab 并存时命中另一个（后台 leaf 的 rect 全 0），于是 withinY 恒等于 1，
         每次点按都判成「下一页」。frame.closest 拿到的是本视图的舞台。 */
      const stageEl = (frame?.closest('.bzs-stage') as HTMLElement | null) ?? this.container ?? null;
      const stageRect = stageEl?.getBoundingClientRect() ?? null;
      const stageLeft = stageRect ? Math.round(stageRect.left) : this.viewportLeft;
      const liveWidth = stageRect ? Math.round(stageRect.width) : 0;
      const live = liveWidth > 0 ? liveWidth : width;
      const winLeft = win?.screenX ?? 0;
      const screenRel = screenX > 0 ? screenX - winLeft : x;
      const rect = frame?.getBoundingClientRect();
      const scrollLeft = rect ? rect.left : 0;
      const within = Math.max(0, Math.min(live, screenRel - stageLeft));
      /* 分区是**上下**，不是左右：屏幕下方 = 下一页，上方 = 上一页。
         真机上手指的横向位置本来就随意，按左右分区会让同一个点忽左忽右，
         方向就来回翻。纵向比例稳定得多，也和同目录 weave 的
         resolveTapZone(clientY, frameHeight) 一致（上 40% 上一页）。 */
      const stageTop = stageRect ? Math.round(stageRect.top) : 0;
      const liveH = stageRect ? Math.round(stageRect.height) : 0;
      const winTop = win?.screenY ?? 0;
      const screenRelY = screenY > 0 ? screenY - winTop : y;
      const withinY = Math.max(0, Math.min(liveH || 1, screenRelY - stageTop));
      /* 分区：手机按**正文自己的高度**比例算（见 gesture-binding.ts）。
         绕到屏幕坐标再减回来在 iOS 上会对不上，判成「上一页」而人正在第一页时
         点哪儿都不动。桌面仍走宿主坐标：那里屏幕坐标是准的，且窗口不最大化时
         帧高与可见正文高度不一定相同。 */
      const frameH = win?.innerHeight ?? doc.documentElement?.clientHeight ?? 0;
      /* 判据用 isMobileShell 而不是 isMobileEnv：桌面开着 force-mobile 验收时
         也要走这条，否则分区算法和下面视图层的方向映射对不上，桌面上就复现不了。 */
      const zone: 'prev' | 'next' = isMobileShell()
        ? zoneFromFrameY(y, frameH)
        : (withinY < (liveH || 1) * 0.4 ? 'prev' : 'next');
      /* 两条路报的是同一次触摸：pointerup 先到，touchend 紧随其后。
         只有第一次算数（详见 tap-replay.ts）。放在所有「点这儿不算翻页」的
         判断之后——被链接 / 标注拦掉的那一下不该占住这个位置，否则紧接着
         真要点别处会被误判成重播。 */
      if (isReplayTap(this.lastTap, now, x, y)) {
        this.probe.blocked += 1;
        debugEvent('blocked', { why: 'replay', src: source });
        return;
      }
      this.lastTap = { at: now, x, y };
      this.probe.taps += 1;
      debugEvent('tap', { zone, src: source, x: Math.round(x), y: Math.round(y) });
      /* 把「这次手势已经上报过」记在手势自己身上：紧随其后的 touchend
         隔着多久都能认出来（手机上翻页的重排会把 touchend 拖到上百毫秒后）。 */
      if (source === 'pointer' && touchTap) touchTap.reported = true;
      this.opts.onTap?.(zone, { x, y, width: live, source, scrollLeft, within, screenX });
    };

    // ② 滚轮：iframe 内也要拦（外层的 wheel 传不进来）
    const onWheel = (ev: WheelEvent): void => this.handleWheel(ev);

    // ③ 鼠标拖拽横移 → 翻页。起手若落在选区上就不接管，避免和「划词」抢
    let dragX = 0;
    let dragY = 0;
    let dragging = false;
    let tapId = -1;
    let tapX = 0;
    let tapY = 0;
    let tapAt = 0;
    let tapMoved = false;
    let tapPointers = 0;

    const onPointerDown = (ev: PointerEvent): void => {
      tapPointers += 1;
      if (tapPointers > 1) {
        /* 多指：这次手势不是点按（两指轻按由 onTwoFingerTap 处理） */
        tapMoved = true;
        return;
      }
      tapId = ev.pointerId;
      tapX = ev.clientX;
      tapY = ev.clientY;
      tapAt = Date.now();
      tapMoved = false;
      if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed) return;
      dragX = ev.clientX;
      dragY = ev.clientY;
      dragging = true;
    };
    const onPointerMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== tapId) return;
      if (Math.hypot(ev.clientX - tapX, ev.clientY - tapY) > TAP_MOVE_PX) tapMoved = true;
    };
    const onPointerUp = (ev: PointerEvent): void => {
      tapPointers = Math.max(0, tapPointers - 1);
      /* 鼠标拖拽（原有桌面行为） */
      if (dragging && ev.pointerId === tapId) {
        dragging = false;
        if (ev.pointerType === 'mouse') {
          const sel = doc.getSelection();
          if (!sel || sel.isCollapsed) {
            const dx = ev.clientX - dragX;
            const dy = ev.clientY - dragY;
            if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) >= Math.abs(dy) * 1.2) {
              this.suppressClickUntil = Date.now() + 320;
              const dir: 'next' | 'prev' = this.verticalContent
                ? (dx < 0 ? 'prev' : 'next')
                : (dx < 0 ? 'next' : 'prev');
              this.opts.onTurn?.(dir);
              tapMoved = true;
            }
          }
        }
      }
      if (ev.pointerId !== tapId) return;
      const held = Date.now() - tapAt;
      tapId = -1;
      if (tapMoved || held > TAP_LONG_PRESS_MS) return;
      emitTap(ev.clientX, ev.clientY, ev.target, 'pointer', ev.screenX, ev.screenY);
    };
    const onPointerCancel = (): void => {
      tapPointers = 0;
      tapId = -1;
      tapMoved = true;
      dragging = false;
    };

    // ④ 触摸：单指点按兜底 + 两指捏合改字号 + 两指轻按
    const distance = (t: TouchList): number => {
      const a = t[0];
      const b = t[1];
      if (!a || !b) return 0;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onTouchStart = (ev: TouchEvent): void => {
      if (ev.touches.length === 1) {
        const t = ev.touches[0];
        this.lastTouchY = t?.clientY ?? 0;
        touchTap = { x: t.clientX, y: t.clientY, at: Date.now(), moved: 0, fingers: 1, reported: false };
        debugEvent('touch', { phase: 'start', x: Math.round(t.clientX), y: Math.round(t.clientY) });
      } else if (touchTap) {
        touchTap.fingers = ev.touches.length;
        debugEvent('touch', { phase: 'start', n: ev.touches.length });
      }
      if (ev.touches.length !== 2) return;
      this.twoFingerSpan = distance(ev.touches);
      this.twoFingerAt = Date.now();
      this.twoFingerMove = 0;
      this.twoFingerPoints = Array.from(ev.touches).map((t) => ({ x: t.clientX, y: t.clientY }));
    };
    const onTouchMove = (ev: TouchEvent): void => {
      /* 滚动模式下的「滚到章末继续上滑 → 下一章」。
         手指上滑 = 内容往下走，位移取正；到边缘后继续滑才累计。
         不 preventDefault：原生滚动照旧，只在够阈值时切章。 */
      if (this.prefs.flow === 'scroll' && ev.touches.length === 1) {
        const t = ev.touches[0];
        if (t) {
          const dy = this.lastTouchY - t.clientY;
          this.lastTouchY = t.clientY;
          if (Math.abs(dy) >= 1) this.scrollEdgeTurn(dy);
        }
      }
      if (touchTap) {
        if (ev.touches.length > 1) touchTap.fingers = ev.touches.length;
        const t = ev.touches[0];
        if (t) {
          touchTap.moved = Math.max(
            touchTap.moved,
            Math.hypot(t.clientX - touchTap.x, t.clientY - touchTap.y),
          );
        }
      }
      if (ev.touches.length !== 2) return;
      const span = distance(ev.touches);
      this.twoFingerMove = Math.max(this.twoFingerMove, Math.abs(span - this.twoFingerSpan));
      /* 每指自己走了多远：平行拖动时间距不变，只看间距会误判成「没动」 */
      const from = this.twoFingerPoints;
      Array.from(ev.touches).forEach((t, i) => {
        const p0 = from[i];
        if (!p0) return;
        this.twoFingerMove = Math.max(this.twoFingerMove, Math.hypot(t.clientX - p0.x, t.clientY - p0.y));
      });
    };
    const onTouchEnd = (ev: TouchEvent): void => {
      /* 两指轻按：时间短、两指间距几乎没变 */
      if (ev.touches.length < 2 && this.twoFingerAt) {
        const startedAt = this.twoFingerAt;
        const moved = this.twoFingerMove;
        this.twoFingerAt = 0;
        this.twoFingerMove = 0;
        this.twoFingerPoints = [];
        /* 1.0.0 收紧：原来 400ms / 14px 太松——两指同时划过屏幕、或读屏软件的
           两指手势都会被当成「切沉浸」，静读时也容易误触。现在要求更短的按压
           （≤320ms）与更小的位移（≤10px，且两指**各自**都要没怎么动）。 */
        if (Date.now() - startedAt <= 320 && moved <= 10) {
          /* 吞掉同一手势末尾合成的那次 click，免得顺带翻一页 */
          this.suppressClickUntil = Date.now() + 500;
          this.opts.onTwoFingerTap?.();
        }
      }
      /* 手指全抬离 = 这次手势结束。单指点按的判定已经全在捕获层做完
         （见 onTouchEndCapture）：以前这里还留了一份「pointer 不可用时的兜底」，
         可捕获层没拦下来的时候（多指 / 长按 / 滑动）本来就不该翻页，
         拦下来的那一次又早已经上报过——留着它只会让人读不出到底谁在翻页。 */
      if (ev.touches.length === 0) touchTap = null;
    };

    /* 点按拦截：在捕获阶段吞掉这次 touchend，分页器就收不到它，
       也就不会跑「零速度吸附」——「翻过去又被吸回来」的另一半源头。
       这一层不依赖 vendor 补丁是否生效：插件重载后旧的自定义元素还在页面上，
       补丁不会重新注册，只有这层能兜住。

       触摸这条路**无条件**上报，不再看 pointer 有没有走过（那正是 iPhone 上
       彻底点不动的根因，见 tap-replay.ts 的文件头）。同一次手势的重播由
       touchTapVerdict 按手势身份去掉——不看时间：手机上翻页的重排会把
       touchend 拖到 80ms 之后才派发，窗口判空就是「一次点按翻两页」。 */
    const onTouchEndCapture = (ev: TouchEvent): void => {
      const verdict = touchTapVerdict(touchTap, {
        now: Date.now(),
        remaining: ev.touches.length,
        longPressMs: TAP_LONG_PRESS_MS,
        movePx: TAP_MOVE_PX,
      });
      debugEvent('touch', { phase: 'end', verdict, n: ev.touches.length });
      /* 不是点按：长按 / 拖动 / 多指都要把 touchend 留给分页器收尾 */
      if (verdict === 'skip') return;
      /* 已经由 pointer 报过：不再报第二遍，但这屏点按仍要吞掉 touchend */
      if (verdict === 'report') {
        const t = ev.changedTouches[0];
        if (t) emitTap(t.clientX, t.clientY, ev.target, 'touch', t.screenX, t.screenY);
      }
      /* 这次手势已经结算，别再让 bubble 层的收尾把它当成「还没结束」 */
      touchTap = null;
      /* 拦下这一条，分页器就收不到 touchend，不会跑零速度吸附 */
      ev.stopImmediatePropagation();
    };

    // ⑤ 划词：桌面拖选、移动端长按拖选都会走 selectionchange。
    //    这里防抖 140ms —— 拖动过程中每动一下都是新选区，实时上报会让浮层
    //    跟着手指抖，还会把一次划词记成几十条
    const onSelectionChange = (): void => this.scheduleSelection(doc, 140);
    const onPointerUpAny = (): void => this.scheduleSelection(doc, 0);
    const onKeyUp = (ev: KeyboardEvent): void => {
      // Shift + 方向键 / Ctrl+A 也算划词
      if (ev.shiftKey || ev.key === 'a' || ev.key === 'A') this.scheduleSelection(doc, 0);
    };
    /* 正文 iframe 里的键盘不会冒泡到宿主 document：点过正文之后所有快捷键
       全哑（P2-04）。这里转一份出去，由阅读视图按同一套规则处理。 */
    const onKeyDown = (ev: KeyboardEvent): void => this.opts.onKeyDown?.(ev);

    doc.addEventListener('wheel', onWheel, { passive: false });
    doc.addEventListener('pointerdown', onPointerDown);
    doc.addEventListener('pointermove', onPointerMove);
    doc.addEventListener('pointerup', onPointerUp);
    doc.addEventListener('pointercancel', onPointerCancel);
    doc.addEventListener('pointerup', onPointerUpAny);
    doc.addEventListener('touchstart', onTouchStart, { passive: true });
    doc.addEventListener('touchmove', onTouchMove, { passive: false });
    doc.addEventListener('touchend', onTouchEndCapture, true);
    doc.addEventListener('touchcancel', onTouchEndCapture, true);
    doc.addEventListener('touchend', onTouchEnd);
    doc.addEventListener('touchcancel', onTouchEnd);
    doc.addEventListener('selectionchange', onSelectionChange);
    doc.addEventListener('keyup', onKeyUp);
    doc.addEventListener('keydown', onKeyDown);

    this.docDetachers.push(() => {
      doc.removeEventListener('wheel', onWheel);
      doc.removeEventListener('pointerdown', onPointerDown);
      doc.removeEventListener('pointermove', onPointerMove);
      doc.removeEventListener('pointerup', onPointerUp);
      doc.removeEventListener('pointercancel', onPointerCancel);
      doc.removeEventListener('pointerup', onPointerUpAny);
      doc.removeEventListener('touchstart', onTouchStart);
      doc.removeEventListener('touchmove', onTouchMove);
      doc.removeEventListener('touchend', onTouchEndCapture, true);
      doc.removeEventListener('touchcancel', onTouchEndCapture, true);
      doc.removeEventListener('touchend', onTouchEnd);
      doc.removeEventListener('touchcancel', onTouchEnd);
      doc.removeEventListener('selectionchange', onSelectionChange);
      doc.removeEventListener('keyup', onKeyUp);
      doc.removeEventListener('keydown', onKeyDown);
    });
  }

  /** 选区检查（防抖）。同一段选区只上报一次，避免浮层被重复 show 打断输入 */  private scheduleSelection(doc: Document, delay: number): void {
    if (!this.opts.onSelect) return;
    if (this.selTimer !== null) window.clearTimeout(this.selTimer);
    this.selTimer = window.setTimeout(() => {
      this.selTimer = null;
      const info = this.readSelection(doc);
      const key = info?.cfiRange ?? '';
      debugEvent('sel', {
        cfi: (info?.cfiRange ?? '').slice(0, 40),
        len: info?.text?.length ?? 0,
        same: key === this.lastSelKey,
      });
      if (key === this.lastSelKey) return;
      this.lastSelKey = key;
      this.opts.onSelect?.(info);
    }, delay);
  }

  private readSelection(doc: Document): SelectionInfo | null {
    const view = this.view;
    const sel = doc.getSelection();
    if (!view || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    let cfiRange = '';
    try {
      cfiRange = view.getCFI(this.sectionIndex, range);
    } catch {
      return null;
    }
    if (!cfiRange) return null;
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
    if (!rects.length) return null;
    const first = rects[0];
    const g = this.frameGeom(doc);
    const bounds = unionClientRects(rects, g);
    return {
      text: text.slice(0, 5000),
      cfiRange,
      chapterIndex: this.sectionIndex,
      anchor: {
        left: g.left + first.left * g.scale,
        top: g.top + first.top * g.scale,
        width: first.width * g.scale,
        height: first.height * g.scale,
      },
      bounds,
    };
  }

  /** iframe 在宿主视口里的位置与缩放（被 CSS 缩放时 getClientRects 不跟着变，得自己乘） */
  private frameGeom(doc: Document): { left: number; top: number; scale: number } {
    const frame = (doc.defaultView?.frameElement as HTMLElement | null) ?? null;
    if (!frame) return { left: 0, top: 0, scale: 1 };
    const box = frame.getBoundingClientRect();
    return { left: box.left, top: box.top, scale: frame.clientWidth ? box.width / frame.clientWidth : 1 };
  }

  /** iframe 内的视口坐标 → 宿主坐标 */
  private toHostRect(r: DOMRect, doc: Document): Rect {
    const g = this.frameGeom(doc);
    return {
      left: g.left + r.left * g.scale,
      top: g.top + r.top * g.scale,
      width: r.width * g.scale,
      height: r.height * g.scale,
    };
  }

  /** 点是否落在某条我们画过的标注里（overlayer 用命中矩形判断，和渲染同源） */
  private hitsAnnotation(point: { clientX: number; clientY: number }): boolean {
    const contents = this.view?.renderer?.getContents?.() ?? [];
    for (const c of contents) {
      const overlayer = c.overlayer;
      if (!overlayer) continue;
      try {
        const [value] = overlayer.hitTest({ x: point.clientX, y: point.clientY });
        if (value && this.annotColors.has(value)) return true;
      } catch {
        /* 覆盖层跟着章一起拆了：这次按「没命中」处理，点按照常翻页 */
      }
    }
    return false;
  }

  /* ─────────────────── 标注 ─────────────────── */

  /**
   * 把落点闪一下。
   *
   * 跳转本身是无声的：用户只知道「翻到别处了」，不知道落到哪一句。这里在
   * 目标范围外面画一个框，几秒后自己撤掉。
   *
   * 用独立 key 直接写覆盖层，不走 `addAnnotation`：那条路的 key 是 CFI，
   * 和划线同 key 时会把划线的填充顶掉——原划线闪完就没了。
   */
  async pulseAt(cfi: string): Promise<void> {
    const view = this.view;
    if (!view || !cfi) return;
    this.clearPulse();
    try {
      const resolved = (await view.resolveNavigation(cfi)) as
        | { index?: number; anchor?: (doc: Document) => Range | null }
        | null
        | undefined;
      if (!resolved || typeof resolved.index !== 'number' || !resolved.anchor) return;
      const content = view.renderer.getContents().find((c) => c.index === resolved.index && c.overlayer);
      if (!content?.overlayer) return;
      const range = resolved.anchor(content.doc);
      if (!range) return;
      content.overlayer.add(PULSE_KEY, range, Overlayer.outline, { color: pulseColor(), width: 2 });
      this.pulseTimer = window.setTimeout(() => this.clearPulse(), PULSE_MS);
    } catch (err) {
      /* CFI 坏了 / 章节还没挂好：不闪就是了，别为了一个提示打断阅读 */
      console.debug('[bz-reader] 落点高亮没画出来：', err);
    }
  }

  /** 撤掉落点框。定时器到点、或下一次跳转前都会调 */
  clearPulse(): void {
    if (this.pulseTimer !== null) {
      window.clearTimeout(this.pulseTimer);
      this.pulseTimer = null;
    }
    const view = this.view;
    if (!view) return;
    for (const content of view.renderer.getContents()) {
      try {
        content.overlayer?.remove(PULSE_KEY);
      } catch {
        /* 章节已经卸载，覆盖层跟着没了 */
      }
    }
  }

  /** 全量替换待画标注（打开书、增删改之后调）。当前章节的立刻重画 */
  setAnnotations(list: HostAnnotation[]): void {
    const view = this.view;
    const prev = [...this.annotColors.keys()];
    this.annots = list.filter((a) => !!a.cfiRange);
    this.annotColors = new Map();
    for (const a of this.annots) this.annotColors.set(a.cfiRange, a.color ?? '');
    if (!view) return;
    // 先删旧的再画新的：删掉一条划线时，覆盖层里那块 SVG 不会自己消失，
    // 少了这一步就是「侧栏删了，书页上还留着一条」。
    // 串行做是刻意的——删除和重画都是异步的，交错跑会把刚画上的又删掉。
    void (async () => {
      for (const value of prev) {
        if (this.destroyed || this.view !== view) return;
        if (this.annotColors.has(value)) continue;
        await view.deleteAnnotation({ value }).catch(() => undefined);
      }
      this.redrawAnnotations();
    })();
  }

  /**
   * 重画当前章节的标注。
   * 只重画这一章：`addAnnotation` 每条都要解析一次 CFI，整本书几百条逐个跑
   * 会在翻页时卡一下。其它章节会在它自己 load 完的那一刻补上（见 create-overlay）。
   */
  private redrawAnnotations(): void {
    const view = this.view;
    if (!view || this.destroyed) return;
    for (const a of this.annots) {
      if (a.chapterIndex != null && a.chapterIndex !== this.sectionIndex) continue;
      void view.addAnnotation({ value: a.cfiRange }).catch((err: unknown) => {
        /* 关书之后 addAnnotation 会抛在已经拆掉的渲染器上，那属于正常收尾，
           不是「标注定位失败」——别在控制台里制造假的报错线索。 */
        if (this.destroyed || this.view !== view) return;
        console.warn('[bz-reader] 标注定位失败：', err);
      });
    }
  }

  /**
   * 清掉书里的选区（划词条上落袋的动作做完调，否则手机上系统手柄与菜单
   * 会一直挂着、压在刚弹出来的浮层下面）。
   *
   * 遍历**所有**已加载的分片，不只第一个：分页器会预载相邻章，选区通常不在
   * `getContents()[0]` 里。只清第一片时表现就是「点了按钮，选区还在」。
   * 顺带清掉 `lastSelKey`：清完浏览器会派发 selectionchange，不清它的话
   * 下一轮读到同样的空选区会被去重逻辑挡掉。
   */
  clearSelection(): void {
    const contents = this.view?.renderer?.getContents?.() ?? [];
    for (const c of contents) {
      const sel = c?.doc?.getSelection?.();
      if (sel && !sel.isCollapsed) sel.removeAllRanges();
    }
    this.lastSelKey = '';
  }

  private unbindDocGestures(): void {
    for (const off of this.docDetachers.splice(0)) off();
    this.gestureDoc = null;
  }

  /**
   * 把点按 / 滚轮 / 划词监听挂到这份文档上（幂等）。
   *
   * 同一份文档重复挂会把一次点按算成两次、也会让正在进行的滑动被打断，
   * 所以换文档才重挂。挂在 `load` 与 `relocate` 两处调用，详见 gesture-binding.ts。
   */
  private bindDocGestures(doc: Document): void {
    if (!needsGestureBind(this.gestureDoc, doc)) return;
    this.unbindDocGestures();
    this.bindGestures(doc);
    this.gestureDoc = doc;
    this.probe.binds += 1;
  }

  /** 渲染器当前显示的那份文档（还没就绪时为 null） */
  private visibleDoc(): Document | null {
    const contents = this.view?.renderer?.getContents?.() ?? [];
    return pickGestureDoc(contents);
  }

  /** `load` 没来时的补挂路径：按当前可见文档对齐监听 */
  private ensureDocGestures(): void {
    const doc = this.visibleDoc();
    if (doc) this.bindDocGestures(doc);
  }

  /**
   * 当前章节内容是不是竖排。每次章节装载时从文档 computed style 读一次——
   * 注入的 writing-mode 在 foliate 判定方向之前就已生效，所以读到的就是我们写的值。
   * 视图层用它把「点左边 = 上一页」这类物理方向映射反转过来。
   */
  get contentVertical(): boolean {
    return this.verticalContent;
  }
  private verticalContent = false;

  /**
   * 当前章节是不是 RTL（阿拉伯语 / 希伯来语等）。
   *
   * 和竖排一样在 bindGestures 里从 computed style 读一次：书自带的
   * `dir="rtl"` 会落到 body 的 `direction` 上，而注入的样式之后才生效，
   * 所以那一刻读到的值既包含书的语义也包含我们的覆盖。
   */
  get contentRtl(): boolean {
    return this.rtlContent;
  }
  private rtlContent = false;

  /** 已经 destroy 过：之后的异步回调（搜索、标注、导航）一律不再碰视图 */
  private destroyed = false;

  /**
   * 宿主换主题（明暗 / 社区主题）时重注入章节样式。
   *
   * 书页的底色、字色是打开那一刻算出来的，不重注就会一直是旧主题：
   * 用户在深色模式下打开一本白页书，切到浅色再切回来，页面也不会动。
   */
  refreshTheme(): void {
    const renderer = this.view?.renderer as unknown as { setStyles?: (css: string) => void } | undefined;
    const eff = gatedPrefs(this.prefs, can('vertical'));
    renderer?.setStyles?.(buildChapterCSS(eff));
  }

  /** 主题/字号/行距变化时调，只换样式不重开书 */
  applyPrefs(prefs: ReaderPrefs): void {
    const prev = this.prefs;
    this.prefs = prefs;
    /* 版式一改，所有章节的页数都会变：全本页码的实测缓存整份作废，
       等翻页时重新测。字号/页边距/栏数/翻页方式/方向各算一项。 */
    if (
      prev &&
      (prev.fontSize !== prefs.fontSize ||
        prev.margin !== prefs.margin ||
        prev.columns !== prefs.columns ||
        prev.flow !== prefs.flow ||
        prev.layout !== prefs.layout)
    ) {
      this.chapterPages.clear();
    }
    // 竖排仍是高级能力：到期或未解锁时按横排渲染，用户存的选择留在
    // prefs 里，重新激活后自动恢复。双栏已下放基础版，不参与门控。
    const verticalOk = can('vertical');
    const eff = gatedPrefs(prefs, verticalOk);
    const prevEff = gatedPrefs(prev, verticalOk);
    this.refreshTheme();
    const pag = this.view?.renderer as unknown as (HTMLElement & { render?: () => void }) | undefined;
    /* 栏数走两条路，缺一不可：
       ① `max-column-count` 属性——paginator 的 attributeChangedCallback 会把它
          写成 shadow 内 `#top` 的**内联** `--_max-column-count` 并自己重排。
          这是唯一不依赖「自定义属性从宿主继承进 shadow」的通道。
       ② `--_column-count` —— 补丁把 `#top` 的 `--_max-column-count` 接成了
          `var(--_column-count, 2)`；旧版自定义元素（插件重载后页面上还留着
          上一份定义）认这条。缺了它，默认值 2 会让单栏永远显示成双栏。 */
    if (pag) {
      const cols = String(eff.columns);
      pag.setCssProps?.({ '--_column-count': cols });
      if (pag.getAttribute?.('max-column-count') !== cols) pag.setAttribute?.('max-column-count', cols);
      /* 栏数变了「每栏多宽」也跟着变（双栏要平分）。放在栏数之后：
         分页器的 --_max-width 是「每栏宽 × 栏数」，先定栏数才算得准。 */
      this.applyColumnWidth();
    }
    /* 分页器的每页上下留白（--_pad-top/--_pad-bottom）由注入进书页文档的
       buildChapterCSS 给，值写死在 theme.ts。宿主元素上的变量跨不进 iframe，
       所以这里不再写它们——写了也不会生效。 */
    /* 翻页 / 滚动模式（P2-02）：foliate 的 paginator 认 `flow` 属性，
       设成 `scrolled` 之后 `#container` 变成 overflow:auto，滚轮和触控板
       自然滚动，`next()` / `prev()` 也自动改成「滚一屏」。
       属性变化会走 attributeChangedCallback → render()，不需要重开书。 */
    const flow = prefs.flow === 'scroll' ? 'scrolled' : 'paginated';
    if (pag && pag.getAttribute?.('flow') !== flow) pag.setAttribute?.('flow', flow);
    /* 换模式时清掉贴边累计：上一个模式留下的 40px 不该算进下一次滚轮 */
    if (prev?.flow !== prefs.flow) {
      this.edgeAcc = 0;
      this.edgeSide = null;
      this.wheelAcc = 0;
    }
    if (!this.view || !prev) return;
    if (prevEff.layout !== eff.layout) {
      // 竖排切换必须重新装载章节：引擎只在 load 时读一次 writing-mode，
      // 中途改注入不会重排。goTo 当前位置会让同章节重新 load，落回原处。
      /* 走导航队列（A-34）：排版切换同样会重载 iframe，和翻页/跳章并发时
         会把章节顶掉。失败交给 navigate 的出口（onStall / 日志），
         不再 `catch(() => undefined)` 静默吞——否则用户只看到「点了没反应」。 */
      const cfi = this.lastLocationCfi;
      if (cfi) {
        void this.enqueue(() => this.navigate(() => this.view?.goTo(cfi), '切换排版'));
      }
    } else if (prevEff.columns !== eff.columns) {
      // 栏数不用重新 load：重算布局即可，锚点自己会回到原处
      pag?.render?.();
    }
  }

  /**
   * 一次会触碰 iframe 的翻页 / 跳转。
   *
   * 分页器等 iframe 的 `load`，却从不监听 `error`：地址加载不了时 Promise
   * 永远悬着。翻页、跳章、点目录、拖进度条全走这条链，所以每个入口都得有出口，
   * 否则表现就是「点了没反应」或「跳过去一片空白」。
   *
   * 超时不抛错：调用点大多是 `void host.xxx()`，抛出去只会变成
   * unhandledrejection，用户照样什么都看不见。改走 onStall 让上层提示。
   *
   * 返回值给调用方判断「这次导航到底完成了没有」：超时/异常之后底层操作
   * 可能还在跑，此时再叠一次兜底跳转，就会和未完成的那次并发、
   * 出现「点一下跳一章」。
   */
  private async navigate(
    run: () => Promise<unknown> | undefined,
    what: string,
    timeoutMs = LOCATE_TIMEOUT,
  ): Promise<'ok' | 'timeout' | 'error'> {
    let timer = 0;
    const timeout = new Promise<'timeout'>((r) => {
      timer = window.setTimeout(() => r('timeout'), timeoutMs);
    });
    try {
      const done = await Promise.race([Promise.resolve(run()).then(() => 'ok' as const), timeout]);
      if (done === 'timeout') {
        this.opts.onStall?.(what);
        return 'timeout';
      }
      return 'ok';
    } catch {
      /* 引擎自己的错误已经有地方报了（读文件/解包在 mount 里），这里只管「不结算」 */
      this.opts.onStall?.(what);
      return 'error';
    } finally {
      window.clearTimeout(timer);
    }
  }

  /** 当前「章:页」的位置指纹，用来判断一次翻页到底有没有动 */
  get pageKey(): string {
    const r = this.view?.renderer as unknown as { page?: number; pages?: number } | undefined;
    return `${this.chapterIndex}:${r?.page ?? -1}/${r?.pages ?? 0}`;
  }

  /**
   * 量一次正文边缘要用的几何量。
   *
   * 2026-11-12 修：以前这里用 `(阅读区宽 - html.clientWidth) / 2` 猜 iframe
   * 的居中量，但分页器把 iframe 的宽度撑成了「所有列加起来」（真机上是
   * 34129px），于是那个差值恒为负数、被 clamp 成 0——分页器实际把 iframe
   * 横向平移的那十几像素整段漏掉，两角小字就贴着屏幕边、和正文对不上。
   *
   * 现在直接量 iframe 元素自己的位置，再对「一列的宽度」取余：翻到第几页
   * `frame.left` 都是 -18503 这种大数，但余数恒为 13.54px，那才是正文相对
   * 阅读区左边真正挪动的量（见 `engine/content-inset.ts`）。
   *
   * 拿不到 iframe / 样式（换章空窗）时返回 null，调用方退回 0 让 CSS 兜底。
   */
  private contentGeometry(): { left: number; right: number } | null {
    const root = this.container;
    const doc = this.view?.renderer?.getContents?.()[0]?.doc;
    if (!root || !doc?.documentElement || !doc.body) return null;
    try {
      /* 一定要用 iframe 自己的 window 读样式：主 window 的 getComputedStyle
         对另一个文档的元素会给出默认值（padding 读成 0）。 */
      const win = doc.defaultView;
      if (!win) return null;
      const rootRect = root.getBoundingClientRect();
      const frame = win.frameElement as HTMLElement | null;
      const frameLeft = frame ? frame.getBoundingClientRect().left - rootRect.left : 0;
      const htmlStyle = win.getComputedStyle(doc.documentElement);
      const bodyStyle = win.getComputedStyle(doc.body);
      return contentInset({
        rootWidth: rootRect.width,
        frameLeft,
        /* html 的 CSS width 是「一整页」：手机单栏、桌面双栏时是两栏 + 列间距。
           分页器一次翻一整页，右缘也从整页右边算，双栏时页码才落在右栏外沿。 */
        pageWidth: parseFloat(htmlStyle.width) || 0,
        htmlPadLeft: parseFloat(htmlStyle.paddingLeft) || 0,
        htmlPadRight: parseFloat(htmlStyle.paddingRight) || 0,
        bodyPadLeft: parseFloat(bodyStyle.paddingLeft) || 0,
        bodyPadRight: parseFloat(bodyStyle.paddingRight) || 0,
      });
    } catch {
      /* 换章的空窗里 getContents 可能给不出样式：退回 CSS 兜底 */
      return null;
    }
  }

  /**
   * 正文右缘距阅读区右边的距离（px）。页码贴着这条线。
   * 算法见 `engine/content-inset.ts`。
   */
  contentRightInset(): number {
    return this.contentGeometry()?.right ?? 0;
  }

  /**
   * 正文左缘距阅读区左边的距离（px）。沉浸模式左上角的章节名贴着这条线。
   */
  contentLeftInset(): number {
    return this.contentGeometry()?.left ?? 0;
  }

  /**
   * 所有会动 iframe 的导航都排成一条队（P1-15）。
   *
   * 两次翻页并发时，后一次会在分页器 `#locked` 期间被吞掉，或者两次各跳一节、
   * 互相把 iframe 顶掉——表现就是「点一下前进、再点一下退回」。串行化之后
   * 每次点按都对应一次完整导航。同目录 weave 的 `enqueueNavigation` 同理。
   *
   * 2026-11-04 之前只有 next / prev 走这里，跳章、跳 CFI、拖进度条全部绕开：
   * 「点完翻页立刻点目录」时两次导航同时改同一个渲染器，最后停在哪一章
   * 取决于谁后完成，而且不报错。现在四处都进队。
   */
  private navChain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.navChain.then(run, run);
    this.navChain = next.catch(() => undefined);
    return next;
  }

  async next(): Promise<void> {
    debugEvent('hostTurn', { dir: 'next' });
    await this.enqueue(() => this.turnOnce('next'));
  }

  async prev(): Promise<void> {
    debugEvent('hostTurn', { dir: 'prev' });
    await this.enqueue(() => this.turnOnce('prev'));
  }

  private async turnOnce(dir: 'next' | 'prev'): Promise<void> {
    const before = this.pageKey;
    const cfiBefore = this.lastRelocateCfi;
    const seqBefore = this.relocateSeq;
    /* 翻页的等待上限要短：分页器在换章时会短暂上锁，那次 next() 可能
       永不结算；用 20 秒的定位超时会让整条导航队列卡死，后面每次点击
       都像「没反应」。3 秒足够一次翻页，超时就当它没动，走下面的跨章兜底。 */
    const result = await this.navigate(
      () => (dir === 'next' ? this.view?.next() : this.view?.prev()),
      dir === 'next' ? '翻到下一页' : '翻回上一页',
      TURN_TIMEOUT,
    );
    /* 分页器的 replace 与 relocate 是异步的：刚 await 完 next() 时页码往往还是旧的，
       立刻比对会误判成「没翻动」，接着又跳一次相邻章——一次点击翻两页就是这么来的。
       等一次 relocate（或 600ms）再判定。 */
    await this.waitRelocate(seqBefore, 600);
    /* 超时/异常时，底层这次 next() 可能还在推进。此时再叠加一次跨章 goTo，
       两条导航并发，结果就是「点一下跳过整章」。只对「真的完成了但没动」
       的情况走章末兜底。 */
    if (result !== 'ok') return;
    if (this.lastRelocateCfi !== cfiBefore || this.pageKey !== before) return;
    /* 章末/章首：分页器把「下一页」判成 false，页面一动不动，用户看到的就是
       「点了没反应」。这里显式翻到相邻章。 */
    const count = this.book?.sections.length ?? 0;
    const idx = dir === 'next' ? this.chapterIndex + 1 : this.chapterIndex - 1;
    if (idx < 0 || idx >= count) return;
    await this.navigate(
      () => this.view?.goTo(idx),
      dir === 'next' ? '翻到下一章' : '翻回上一章',
      TURN_TIMEOUT,
    );
  }

  /**
   * 当前屏幕上的正文纯文本（朗读用）。
   *
   * `renderer.getContents()` 返回的是**整章**的文档（分页器把一个 section 的
   * 所有页都排在一个 document 里），所以直接取 body.textContent 会从本章第一句
   * 开始念——翻到第 20 页再按朗读又回到开头。这里取可见区左上/右下两个插入点，
   * 拼成一段 Range 只取屏幕上这一页；取不到才退回整章。
   */
  currentText(): string {
    return this.currentBlocks()
      .map((b) => b.text)
      .join(' ')
      .trim();
  }

  /**
   * 当前屏幕上的**段落**（朗读脚本用，2026-11-13）。
   *
   * `currentText()` 把整页压成一串字，段落边界和引号位置都丢了；朗读要
   * 分「旁白 / 对话」就必须保留段落。
   *
   * 取元素而不是 `cloneContents()` 的片段：高亮要拿原文档里的元素画框。
   * 分页器把整章排在一个 document 里，用「块与视口相交」筛出这一页。
   * 一块都筛不出来（固定版式 / 没有块级元素的 TXT）时退回可见 Range 文本。
   */
  /**
   * 当前屏幕上这一页的文字（朗读脚本用）。
   *
   * 分栏模式有两套坐标：块元素与 `getClientRects()` 是整章布局坐标
   * （0–38529），caret 只认 iframe 视口（0–632）。所以「这一屏从哪开始」
   * 不能问 caret，只能用块的逐字符矩形跟可见区间比（cropToSpan）。
   * 这样起点就是屏幕第一个字，跨页段落也只念屏幕上那一段。
   */
  currentBlocks(): Array<{ tag: string; text: string; raw: string }> {
    this.speechSpots = [];
    this.pageStartAnchor = null;
    const contents = this.view?.renderer?.getContents?.() ?? [];
    const out: Array<{ tag: string; text: string; raw: string }> = [];
    /* 整章块序号：必须与 `currentChapterBlocks` 完全同一套遍历（同顺序、
       同「空文本跳过」规则），否则这个序号在起播定位时对不上句子。 */
    let chapterBlock = 0;
    for (const c of contents) {
      const doc = c.doc;
      if (!doc?.body) continue;
      const h = doc.defaultView?.innerHeight || doc.documentElement.clientHeight || 0;
      const span = h >= 8 ? this.visibleSpanOf(doc) : null;
      if (!span) continue;
      for (const el of leafBlocks(doc.body)) {
        /* 计数按「整章有文本的块」走：这一块在本页看不见也要占一个号 */
        const whole = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!whole) continue;
        const index = chapterBlock++;
        const range = cropToSpan(el, span, h);
        if (!range) continue;
        /* raw 必须与 range 同源：句子锚点是「相对这个 range 的起点」记的，
           拿 el.textContent 当基准，跨页段落一定错位。 */
        const raw = range.toString() || '';
        const text = raw.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (!this.pageStartAnchor) {
          this.pageStartAnchor = { block: index, offset: textOffsetOf(el, range) };
        }
        out.push({ tag: el.tagName.toLowerCase(), text, raw });
        this.speechSpots.push({ content: c, range, el });
      }
    }
    debugEvent('tts.page', {
      n: out.length,
      first: out[0]?.text.slice(0, 24) ?? '',
      block: this.pageStartAnchor?.block ?? -1,
      offset: this.pageStartAnchor?.offset ?? -1,
    });
    return out;
  }

  /**
   * 屏幕第一个字在整章正文里的位置（见 `pageStartAnchor`）。
   *
   * 只在上一次 `currentBlocks()` 成功数出来时才有值。
   */
  pageAnchor(): PageAnchor | null {
    return this.pageStartAnchor;
  }

  /**
   * 当前章的全部段落（预生成整章音频用，不做可见过滤）。
   *
   * 2026-11-14：**同时填 `speechSpots`**。离线包播的是整章，脚本里的
   * `blocks` 是整章块序号，而 `speechRects` 按 `speechSpots[index]` 定位；
   * 不在这里填，整章播放就只有第一块对得上（其余全空），手机上表现为
   * 「有声音、没高亮」。
   */
  currentChapterBlocks(): Array<{ tag: string; text: string; raw: string }> {
    this.chapterSpots = [];
    const contents = this.view?.renderer?.getContents?.() ?? [];
    const out: Array<{ tag: string; text: string; raw: string }> = [];
    for (const c of contents) {
      if (!c.doc?.body) continue;
      for (const el of leafBlocks(c.doc.body)) {
        const raw = el.textContent ?? '';
        const text = raw.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const range = c.doc.createRange();
        range.selectNodeContents(el);
        out.push({ tag: el.tagName.toLowerCase(), text, raw });
        this.chapterSpots.push({ content: c, range, el });
      }
    }
    /* 没有块标签的纯文本（TXT）：退回按换行切，高亮会瞎，但至少念得出来 */
    if (!out.length) {
      this.chapterSpots = [];
      for (const c of contents) if (c.doc?.body) collectBlocks(c.doc.body, out);
    }
    return out;
  }

  /** 当前章标题（预生成 / 导出音频时命名用） */
  currentChapterTitle(): string {
    const fromToc = (this.toc()[this.currentChapterIndex]?.label ?? '').trim();
    return fromToc || this.chapterTitle.trim();
  }

  /**
   * 句子锚点 → Range（页级朗读用）。
   *
   * 2026-11-14：定位从「拿文本去 DOM 里搜」改成「块序号 + 块内偏移」。
   * 文本搜索的最后一级退路是在整块里找，同一块里的重复短语、标点差异
   * 都会命到别处——真机表现就是离线朗读的高亮偏几个字、实时朗读不偏。
   */
  speechRange(anchor: Anchor): Range | null {
    return this.rangeOfSpot(this.speechSpots[anchor.block], anchor);
  }

  /**
   * 整章块的 Range（离线包朗读用）。
   *
   * 必须和 `speechRange` 分开取坐标表：页级那份会被翻页重填，整章序号
   * 一旦按页内序号去取，整章往后全部偏移。
   */
  speechRangeChapter(anchor: Anchor): Range | null {
    return this.rangeOfSpot(this.chapterSpots[anchor.block], anchor);
  }

  /** 这一句落在哪个书页文档里（高亮要在它自己的 realm 里注册） */
  speechDoc(anchor: Anchor, chapter = false): Document | null {
    const spot = (chapter ? this.chapterSpots : this.speechSpots)[anchor.block];
    return spot?.content.doc ?? null;
  }

  /**
   * 这一句在不在眼前。
   *
   * 只在 iframe 内比：`getClientRects()` 是当前栏的视口坐标，屏外那一栏
   * 是负数或大于宽度。以前把它搬回宿主再跟阅读区比，中间每一步换算都是
   * 一个偏差来源。
   */
  speechInView(anchor: Anchor, chapter = false): boolean {
    const spot = (chapter ? this.chapterSpots : this.speechSpots)[anchor.block];
    const range = this.rangeOfSpot(spot, anchor);
    if (!spot || !range) return false;
    const doc = spot.content.doc;
    const w = doc.documentElement.getBoundingClientRect().width || doc.defaultView?.innerWidth || 0;
    const h = doc.defaultView?.innerHeight || doc.documentElement.clientHeight || 0;
    try {
      return anyRectInView(range.getClientRects(), w, h);
    } catch {
      return false;
    }
  }

  /**
   * 把「正在念的这一句」滚到眼前（离线整章播放跟随用）。
   *
   * 交给分页器：`scrollToAnchor(range)` 取 range 的第一个非零矩形、按页宽
   * 折成页码再滚过去，foliate-js 自己的 `tts.js` 也是这么跟着念的。
   * 自己数页在这套布局里没有解——分栏下有整章布局与视口两套坐标系。
   *
   * 幂等：这句已经在当前页时，分页器算出的偏移与当前一致。
   */
  async revealAnchor(anchor: Anchor, chapter = false): Promise<boolean> {
    const spot = (chapter ? this.chapterSpots : this.speechSpots)[anchor.block];
    const range = this.rangeOfSpot(spot, anchor);
    if (!range) return false;
    const renderer = this.view?.renderer as unknown as
      | { scrollToAnchor?: (anchor: Range, select?: boolean) => Promise<void> }
      | undefined;
    if (!renderer?.scrollToAnchor) return false;
    try {
      /* 第二个参数 false：只滚动，不把用户的选区改成这一句 */
      await renderer.scrollToAnchor(range, false);
      return true;
    } catch {
      return false;
    }
  }

  private rangeOfSpot(
    spot: { content: FoliateContent; range: Range; el: HTMLElement } | undefined,
    anchor: Anchor,
  ): Range | null {
    if (!spot) return null;
    try {
      return rangeOfAnchor(spot.range, anchor);
    } catch {
      return null;
    }
  }

  /**
   * 兜底高亮：老内核没有 CSS Custom Highlight 时，用 foliate 的覆盖层。
   *
   * SVG 在 iframe 内，矩形由 `getClientRects()` 直接给，不经宿主坐标。
   * 缺点是要在翻页后 `redraw()`，所以只当兜底，主路径仍交给浏览器。
   */
  drawSpeechOverlay(anchor: Anchor, chapter = false): boolean {
    const spot = (chapter ? this.chapterSpots : this.speechSpots)[anchor.block];
    const range = this.rangeOfSpot(spot, anchor);
    const overlayer = spot?.content.overlayer;
    if (!range || !overlayer) return false;
    try {
      overlayer.add(SPEECH_KEY, range, Overlayer.highlight, {
        color: 'var(--interactive-accent, #9a7434)',
      });
      return true;
    } catch {
      return false;
    }
  }

  /** 撤掉朗读高亮（兜底路径用：CSS Highlight 那条由视图层清） */
  clearSpeechMark(): void {
    for (const c of this.view?.renderer?.getContents?.() ?? []) {
      try {
        c.overlayer?.remove(SPEECH_KEY);
      } catch {
        /* 覆盖层跟着章一起拆了 */
      }
    }
  }

  /* 两套 API 各有用武之地：caretPositionFromPoint 是标准（Chromium 128+），
     caretRangeFromPoint 是 Chromium 私有且在 TS 的 DOM 类型里标了 deprecated
     （社区目录会把它当建议提出来）。所以先问标准的，没有才退回老的——
     后者只通过本地形状调用，既留住了老内核的兜底，也不再直接依赖弃用签名。 */
  /** 可见区文字：两点 Range（拿不到返回空串，由调用方退回整章） */
  private visibleText(doc: Document): string {
    return this.visibleFragment(doc)?.textContent ?? '';
  }

  /** 可见区的 DOM 片段：朗读取段落、正文取纯文本共用同一刀 */
  private visibleFragment(doc: Document): DocumentFragment | null {
    const r = this.pageRange(doc);
    return r ? r.cloneContents() : null;
  }

  /**
   * 这一屏的 Range：左上角落一次 caret、右下角落一次 caret。
   *
   * caret API 吃的是 **iframe 视口坐标**（分栏模式下就是当前那一栏，宽 632），
   * 不是 `getClientRects()` 那种整章布局坐标（0–38529）。两者混用会取到
   * 「屏幕外左边一栏」的字——真机表现为从段落中间靠前的位置开始念。
   */
  private pageRange(doc: Document): Range | null {
    const win = doc.defaultView;
    if (!win) return null;
    try {
      /* 分栏模式下 `win.innerWidth` 是整章宽（实测 38577），文档元素的
         渲染宽才是当前一栏（632）。caret 只认后者。 */
      const w = doc.documentElement.getBoundingClientRect().width || win.innerWidth || 0;
      const h = win.innerHeight || doc.documentElement.clientHeight || 0;
      if (w < 8 || h < 8) return null;
      const start = caretPointAt(doc, 2, 2);
      const end = caretPointAt(doc, w - 4, h - 4);
      if (!start || !end) return null;
      const r = doc.createRange();
      r.setStart(start.node, start.offset);
      r.setEnd(end.node, end.offset);
      return r;
    } catch {
      return null;
    }
  }

  /**
   * 这一屏在 iframe 内容坐标里的横区间（2026-11-14 重做）。
   *
   * 三套量以前混着用，谁跟谁都比不上：块的 `getBoundingClientRect()` 是
   * iframe 内坐标（实测首块 left=32、跨栏段落 left=1297），foliate 的
   * `renderer.start` 是另一个数（实测 2530），`renderer.viewSize` 又是整章
   * 宽（5059）。拿 `viewSize` 当一页宽，区间 [0, 5059] 覆盖整章，每块都算
   * 可见——`currentBlocks()` 返回整章 23 块，朗读永远从章首念。
   *
   * 唯一恒成立的换算是：iframe 在宿主里被平移（实测 left=-1530），所以
   * 「内容坐标 = 宿主坐标 − iframe.left」。把阅读区（foliate-view）的左右
   * 边界减掉 iframe.left，就是这一屏在内容坐标里的区间，跟块矩形同口径。
   */
  private visibleSpanOf(doc: Document): Span | null {
    const view = this.view as unknown as Element | null;
    const frame = doc.defaultView?.frameElement ?? null;
    if (!view || !frame) return null;
    try {
      const vr = view.getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      if (!(vr.width >= 8) || !(fr.width >= 8)) return null;
      const span = { x0: vr.left - fr.left, x1: vr.right - fr.left };
      debugEvent('tts.span', {
        frame: Math.round(fr.left),
        view: Math.round(vr.left),
        width: Math.round(vr.width),
        x0: Math.round(span.x0),
        x1: Math.round(span.x1),
      });
      return span;
    } catch {
      return null;
    }
  }

  /** 跳到 TOC 项（href 由 foliate 解析成章节 + 锚点） */
  async goToHref(href: string): Promise<void> {
    this.recordSpot();
    await this.enqueue(() => this.navigate(() => this.view?.goTo(href), '跳到这一章'));
  }

  /**
   * 按章名跳转（AI 回答的来源点开用）。
   *
   * 画像里存的是「章名 + 第几块」，没有 href；这里回目录换一次。
   * 找不到就返回 false、什么都不做——跳回开头比不跳更像坏了。
   */
  async goToChapter(title: string): Promise<boolean> {
    const href = findTocHref(this.book?.toc, title);
    if (!href) return false;
    await this.goToHref(href);
    return true;
  }

  /**
   * 逐章导出正文（全书画像用）。
   *
   * 与 `currentText()` 的分工：那个取「屏幕上这一页」，这个取**整本**——
   * 建画像要的是全书，翻到哪一页与它无关。逐章走 `section.createDocument()`，
   * 和脚注读取同一条路（foliate 的 search 也是这么干的），不另开第二个 view。
   *
   * 三个必须守住的点：
   *   1. **一章失败不拖垮整本**：坏章节跳过并继续，只有全空才算失败；
   *   2. **能中途停**：`shouldStop` 每章问一次，用户点取消不必等整本读完；
   *   3. **读完就 unload**：sections 钉着整本书的文本引用，几十章一起留着，
   *      手机端直接 OOM（view-teardown 里那条注释是同一件事）。
   */
  async exportChapters(
    opts: {
      onProgress?: (done: number, total: number, title: string) => void;
      shouldStop?: () => boolean;
    } = {},
  ): Promise<Array<{ title: string; text: string }>> {
    const book = this.book;
    if (!book) return [];
    const sections = book.sections ?? [];
    if (!sections.length) return [];

    /* href → 章名：目录里的 label 才是读者认的名字，section 只有路径 */
    const labelOf = new Map<string, string>();
    const walk = (items: FoliateTOCItem[] | undefined): void => {
      for (const it of items ?? []) {
        const href = (it.href ?? '').split('#')[0];
        const label = (it.label ?? '').trim();
        if (href && label && !labelOf.has(href)) labelOf.set(href, label);
        walk(it.subitems);
      }
    };
    walk(book.toc);

    const out: Array<{ title: string; text: string }> = [];
    for (let i = 0; i < sections.length; i += 1) {
      if (opts.shouldStop?.()) break;
      const section = sections[i];
      const title = labelOf.get((section.href ?? '').split('#')[0]) || `第 ${i + 1} 节`;
      let text = '';
      try {
        const doc = await section.createDocument?.();
        text = doc?.body?.textContent ?? '';
      } catch {
        /* 单章解析失败：留空继续，不让一章毁掉整本 */
        text = '';
      }
      try {
        section.unload?.();
      } catch {
        /* 卸不掉不影响已读到的内容 */
      }
      if (text.trim()) out.push({ title, text });
      opts.onProgress?.(i + 1, sections.length, title);
    }
    return out;
  }

  /**
   * 定位到 CFI，返回**是否真的完成**。
   *
   * 以前返回 void，而 navigate() 会吞掉超时与异常；`locateFromLink` 的
   * try/catch 因此永远不进，CFI 失效时也报成功，后面「原文片段 → 百分比」
   * 两级兜底全成了死代码。
   */
  async goToCfi(cfi: string): Promise<boolean> {
    if (!cfi) return false;
    this.recordSpot();
    return (await this.enqueue(() => this.navigate(() => this.view?.goTo(cfi), '定位到这一页'))) === 'ok';
  }

  /* ─────────── 跳转历史（「回到上一处」） ─────────── */

  /**
   * 头栏那颗图标要的两个动作。和 picUi 一样**现取**：换书后旧对象作废。
   *
   * 没有 `view` 也给得出来：EPUB 在解包阶段还建不出页面，但那时栈是空的，
   * `canBack()` 为 false，按钮本来就不亮。
   */
  get historyUi() {
    return {
      back: () => this.backStep(),
      canBack: () => this.nav.canBack,
    };
  }

  /**
   * 记下「现在在哪」，供 back() 退回去。
   *
   * 只由显式跳转调用（goToCfi / goToHref）；翻页、滚动、进度条都不记——
   * PDF 那边是同一套规则，两边对不齐时用户会发现「翻几页再回退」跳得莫名其妙。
   */
  private recordSpot(): void {
    if (this.navBacking) return;
    if (this.nav.push({ cfi: this.lastLocationCfi, label: this.chapterTitle })) {
      this.opts.onHistoryChange?.(this.nav.size);
    }
  }

  /** 退回上一处；没有历史就安静地什么都不做 */
  private backStep(): void {
    const spot = this.nav.pop();
    this.opts.onHistoryChange?.(this.nav.size);
    if (!spot) return;
    /* 这一次 goToCfi 是「退回」，不能把当前这一处又压回栈里 */
    this.navBacking = true;
    void this.goToCfi(spot.cfi).finally(() => {
      this.navBacking = false;
    });
  }

  /**
   * 把一条脚注的正文从目标章节里抓出来。
   *
   * 不开第二个 `foliate-view`（foliate 自带的 FootnoteHandler 是那么做的：为了
   * 看两行注释，把整本书重新 open 一遍），而是直接让 section 造一份 Document，
   * 再按 fragment 找元素。四步兜底，缺一步都会出现「点注释号读不出正文」：
   *
   *  1. 按 href 路径对 `book.sections`，**不用** resolveHref 的 index：
   *     foliate 的 sections 是 spine 过滤过的，下标会错位；
   *  2. 路径对不上（href 是相对路径 / 编码不同）时，用 resolveHref 的 anchor；
   *  3. 目标文档里 `getElementById` / `name` / `xml:id` 都试一遍；
   *  4. 还找不到，就按「注文页优先」扫全书——尾注常被拆成独立章节。
   */
  private async readFootnote(href: string, label: string): Promise<Omit<FootnoteInfo, 'anchor'> | null> {
    const book = this.book;
    if (!book) return null;
    const sections = book.sections ?? [];
    const { path, fragment } = splitFootnoteHref(href);

    /* foliate 的 anchor 只在同章节锚点时可靠；spine 下标则可能因 spine 过滤错位 */
    let anchorFn: ((doc: Document) => Node | null) | null = null;
    let resolvedIndex = -1;
    try {
      const resolved = book.resolveHref?.(href) ?? null;
      if (resolved && typeof resolved.anchor === 'function') {
        anchorFn = resolved.anchor as (doc: Document) => Node | null;
      }
      if (resolved && typeof resolved.index === 'number') resolvedIndex = resolved.index;
    } catch {
      /* resolveHref 失败不影响后面的路径匹配 */
    }

    const index = chooseSectionIndex({
      sections,
      path,
      currentIndex: this.chapterIndex,
      resolvedIndex,
    });

    if (index >= 0) {
      const target = await this.loadFootnoteTarget(sections[index], fragment, anchorFn);
      if (target) {
        const info = this.buildFootnoteInfo(target, href, index, label);
        if (info) return info;
      }
    }

    const found = await this.findFootnoteAcrossSections(fragment);
    if (!found) return null;
    return this.buildFootnoteInfo(found.element, href, found.index, label);
  }

  /** 在一章里找 fragment 指向的元素；找不到再用 foliate 的 anchor */
  private async loadFootnoteTarget(
    section: FoliateSection | undefined,
    fragment: string,
    anchorFn: ((doc: Document) => Node | null) | null,
  ): Promise<Element | null> {
    if (!section?.createDocument) {
      return null;
    }
    let doc: Document;
    try {
      doc = await section.createDocument();
    } catch {
      return null;
    }
    if (fragment) {
      const el = findFragmentTarget(doc, fragment);
      if (el) return el;
    }
    if (!anchorFn) return null;
    try {
      const node = anchorFn(doc);
      if (!node) return null;
      if (node.nodeType === 1) return node as Element;
      const parentNode = node.parentNode;
      return parentNode && parentNode.nodeType === 1 ? (parentNode as Element) : null;
    } catch {
      return null;
    }
  }

  /**
   * 全书中找 fragment。
   *
   * 尾注页可能不在 spine 里（index = -1），或 href 路径与 section.id 对不上。
   * 先扫「看着像注文页」的章节，再扫其余。
   *
   * 上限从 120 章降到 8 章（P2-16）：有些书的注释锚点就是找不到（id 写错、
   * 注文页不在 spine），这时每次点注释号都会在主线程连续解析上百个章节的
   * XHTML——单章解析本身就可能几百毫秒，4 秒的 deadline 只在**两次解析之间**
   * 检查，用户看到的是「点了没反应、界面卡住」，然后可能被甩到书末。
   *
   * 8 章足够覆盖「注文页排在正文后面几章」这个真实布局；真找不到就走
   * 下面那句人话提示，而不是把手机卡死。
   */
  private async findFootnoteAcrossSections(
    fragment: string,
  ): Promise<{ index: number; element: Element } | null> {
    const sections = this.book?.sections ?? [];
    if (!fragment || !sections.length) return null;
    const order: number[] = [];
    sections.forEach((section, i) => {
      if (/notes?|footnote|endnote/i.test(section?.id ?? '')) order.push(i);
    });
    for (let i = 0; i < sections.length; i += 1) {
      if (!order.includes(i)) order.push(i);
    }
    const deadline = Date.now() + 4000;
    let tried = 0;
    let hit: { index: number; element: Element } | null = null;
    for (const i of order) {
      if (tried >= MAX_FOOTNOTE_SCAN || Date.now() > deadline) break;
      const section = sections[i];
      if (!section?.createDocument) continue;
      tried += 1;
      try {
        const doc = await section.createDocument();
        const el = findFragmentTarget(doc, fragment);
        if (el) {
          hit = { index: i, element: el };
          break;
        }
      } catch {
        /* 这一章打不开就跳过，下一章还能命中 */
      }
    }
    return hit;
  }

  private buildFootnoteInfo(
    el: Element,
    href: string,
    index: number,
    label: string,
  ): Omit<FootnoteInfo, 'anchor'> | null {
    /* context: true —— 注文正文往往不在目标元素里（目标常是空锚点），
       要把父容器与兄弟一起转进来，候选评分才有东西可挑 */
    const node = domToFNode(el, { context: true });
    const text = resolveFootnoteText(node, label);
    if (!text) return null;
    return { text, href, chapterIndex: index };
  }

  /**
   * 整书百分比跳转（移动端进度滑杆松手时用）。
   *
   * 2026-11-04 两处改：
   *   - 进导航队列（P1-15），不再和翻页/跳章并发改同一个 iframe；
   *   - 去掉内层 `.catch(() => undefined)`（P2-21）。它让 navigate 只看到
   *     「成功」，于是 `locateFromLink` 的「按百分比兜底」永远返回 true、
   *     `start()` 恢复上次进度失败也静默回第一页。错误要能传上去。
   */
  async goToPercent(fraction: number): Promise<void> {
    const f = Math.min(1, Math.max(0, fraction));
    await this.enqueue(() => this.navigate(() => this.view?.goToFraction(f), '跳到这个进度'));
  }

  /**
   * 搜索。`chapterOnly` 只搜当前章节（基础版能力），关掉是全书（高级版）。
   * 底层是同一个 foliate 接口，区别只在传不传 index。
   *
   * 全书搜索要遍历整本书的每一章，几秒很正常。`onHit` 是给界面用的：
   * 搜到一条报一条，结果列表边搜边长——否则用户面对一块空白等三秒，
   * 会以为插件卡死了。
   */
  async search(
    query: string,
    opts: {
      chapterOnly?: boolean;
      onHit?: (hit: SearchHit & { chapterIndex: number; chapterLabel: string }) => void;
      /**
       * 逐章检查「要不要停」（P2-05）。
       *
       * 以前停止只发生在「下一本书开扫前」，当前这本仍会把剩下的章节逐章扫完
       * ——几十本时用户点了停止，界面还要再转好几秒，离屏 iframe 和引擎
       * 也一直占着内存。
       */
      shouldStop?: () => boolean;
    } = {},
  ): Promise<Array<SearchHit & { chapterIndex: number; chapterLabel: string }>> {
    const view = this.view;
    const q = query.trim();
    if (!view || !q) return [];
    const out: Array<SearchHit & { chapterIndex: number; chapterLabel: string }> = [];
    const iter = view.search(opts.chapterOnly ? { query: q, index: this.chapterIndex } : { query: q });
    let stopped = false;
    for await (const item of iter) {
      if (item === 'done') break;
      if (opts.shouldStop?.()) {
        stopped = true;
        break;
      }
      if (item.subitems?.length) {
        for (const sub of item.subitems) {
          const hit = { cfi: sub.cfi, excerpt: excerptText(sub.excerpt), chapterIndex: item.index ?? 0, chapterLabel: item.label ?? '' };
          out.push(hit);
          opts.onHit?.(hit);
        }
      } else if (item.cfi) {
        const hit = { cfi: item.cfi, excerpt: excerptText(item.excerpt), chapterIndex: this.chapterIndex, chapterLabel: '' };
        out.push(hit);
        opts.onHit?.(hit);
      }
    }
    /* 用户点了停止：主动关掉生成器，让它别再逐章扫下去（P2-05）。
       `for await` 提前 break 只是不读了，foliate 那边的循环还在跑。 */
    if (stopped) {
      try {
        await iter.return?.(undefined);
      } catch {
        /* 关不掉也不影响返回已有结果 */
      }
    }
    return out;
  }

  clearSearch(): void {
    this.view?.clearSearch();
  }

  async destroy(): Promise<void> {
    /* 先立旗：拆卸要 await 导航队列，这期间可能还有 relocate / 标注事件
       摸进来，它们必须看见「已经关了」。 */
    this.destroyed = true;
    this.unbindDocGestures();
    for (const off of this.outerDetachers.splice(0)) off();
    /* 等排队的导航收口再拆 iframe（P1-15）：不等的话，正在跑的 goTo 会在
       view 已经置空之后继续操作一个被 remove 掉的容器。 */
    await this.navChain.catch(() => undefined);
    this.wheelAcc = 0;
    this.edgeAcc = 0;
    this.edgeSide = null;
    if (this.selTimer !== null) {
      window.clearTimeout(this.selTimer);
      this.selTimer = null;
    }
    /* 列宽防抖还挂着的就撤掉：关书后再触发会去碰已经拆掉的分页器 */
    if (this.colWidthTimer !== null) {
      window.clearTimeout(this.colWidthTimer);
      this.colWidthTimer = null;
    }
    this.colWidthApplied = -1;
    this.annots = [];
    this.annotColors.clear();
    this.lastSelKey = '';
    this.sectionIndex = 0;
    const view = this.view;
    this.view = null;
    const book = this.book;
    this.book = null;
    if (view) {
      /* 关书兜底（A-08）：close() 自己会调 renderer.destroy()，但它一旦抛错
         （分页器的 #view 已被置空时就是这么抛的），sections 与 mediaQuery
         监听都会留在全局对象上。teardownView 负责断链，见其文件头。 */
      teardownView(view);
      view.remove();
    }
    book?.destroy?.();
    this.container = null;
  }
}

/** 块级元素：一页正文按这些切开朗读（li / blockquote 里常再套 p，下面只取叶子） */
const BLOCK_TAGS = 'p, h1, h2, h3, h4, h5, h6, blockquote, li, pre, dd, dt';

/** 朗读高亮在覆盖层里的 key（与划线、落点框分开） */
const SPEECH_KEY = 'bzr-tts-speech';

function leafBlocks(root: ParentNode): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_TAGS));
  return all.filter((el) => !el.querySelector(BLOCK_TAGS));
}

/**
 * 一个 Range 的起点在所在块原始文本里的字符偏移（2026-11-14）。
 *
 * 不用 `el.textContent.indexOf(raw)`：同一块里重复的短语会把偏移算到前一处，
 * 起播就偏到前面去。两段 Range 之间有几个字符，DOM 自己最清楚。
 * 取不到给 -1——调用方会当块首处理，比从章首念强。
 */
function textOffsetOf(el: HTMLElement, range: Range): number {
  try {
    const doc = el.ownerDocument;
    const whole = doc.createRange();
    whole.selectNodeContents(el);
    const pre = doc.createRange();
    pre.setStart(whole.startContainer, whole.startOffset);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  } catch {
    return -1;
  }
}

/** 块与 iframe 视口相交就算「这一页的」 */
function inViewport(el: HTMLElement, w: number, h: number): boolean {
  try {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < h && r.right > 0 && r.left < w;
  } catch {
    return false;
  }
}

/**
 * 从可见 Range 的片段里收集段落。
 *
 * 只取叶子块：`<li><p>…</p></li>` 收 p 不收 li，否则同一句话念两遍。
 * 一个块都没有的文档（TXT 常见：纯文本 + `<br>`）退回按换行切。
 */
function collectBlocks(
  root: ParentNode,
  out: Array<{ tag: string; text: string; raw: string }>,
): void {
  const before = out.length;
  const all = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_TAGS));
  const leaves = all.filter((el) => !el.querySelector(BLOCK_TAGS));
  for (const el of leaves) {
    const raw = el.textContent ?? '';
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text) out.push({ tag: el.tagName.toLowerCase(), text, raw });
  }
  if (out.length > before) return;
  /* 纯文本 + <br> 的书没有块可锚：句子只能按行切，高亮整章那边对不上，
     但念得出来。raw 用行本身，至少文本匹配的那套兜底还能用 */
  const all2 = (root.textContent ?? '').replace(/\r/g, '');
  for (const line of all2.split(/\n+/)) {
    const text = line.replace(/\s+/g, ' ').trim();
    if (text) out.push({ tag: 'p', text, raw: line });
  }
}

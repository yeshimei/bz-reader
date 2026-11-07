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
  FoliateSection,
  FoliateTOCItem,
  FoliateView,
  ShowAnnotationDetail,
} from '../types/foliate';
import { buildChapterCSS } from './theme';
import { makeTxtBook, countWords } from './txt';
import { decodeTxtBytes } from './encoding';
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
import { DEFAULT_PREFS, FONT_SIZE_RANGE, gatedPrefs, type ReaderPrefs } from '../data/prefs';
import { can } from '../data/entitlement';
import { isMobileEnv } from '../core/mobile';
import { engineMetaFromBook, type EngineMeta } from '../data/book-meta';
import { accumulateEdgeTurn, scrollEdgeOf } from './scroll-edge';

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
}

/** 交给引擎去画的标注（宿主只认 CFI 范围与颜色） */
export interface HostAnnotation {
  cfiRange: string;
  color?: string;
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
  /** 两指捏合或 Ctrl+滚轮要求改字号 */
  onFontSize?: (size: number) => void;
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


export class EngineHost {
  private app: App;
  private view: FoliateView | null = null;
  private book: FoliateBook | null = null;
  private container: HTMLElement | null = null;
  private prefs: ReaderPrefs = DEFAULT_PREFS;
  private opts: MountOptions = { prefs: DEFAULT_PREFS };
  private chapterIndex = 0;
  private chapterTitle = '';
  private chapterHref = '';
  /** 文档级监听（每换一章重建）与容器级监听（整本书只建一次）分开存，
   *  否则换章时顺手把容器滚轮也解掉了 */
  private docDetachers: Array<() => void> = [];
  private outerDetachers: Array<() => void> = [];

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
  /** 两指捏合起始距离与基准字号 */
  private pinchStart = 0;
  private pinchBase = 0;
  /**
   * 捏合时的字号节流（P2-19）。
   *
   * 以前 `touchmove` 里每次两指距离变化都回调 `onFontSize`，上层
   * `applyPrefs` 会重新生成整份 CSS（`resolveTheme` + `accentColor` 各来一次
   * `getComputedStyle(document.body)`）再 `setStyles` 进 iframe。捏一次缩放
   * 就是几十次全量重算，手机上直接卡成幻灯片。
   *
   * 现在 80ms 合并一次，松手时再补最后一次。
   */
  private pinchPending: number | null = null;
  private pinchTimer: number | null = null;
  /** 两指轻按的判定：按下时间 + 两指间距的最大变化 */
  private twoFingerAt = 0;
  private twoFingerMove = 0;
  /** 两指落下时的间距（移动端不做捏合，拔掉 pinchBase 后仍要它算位移） */
  private twoFingerSpan = 0;
  /** 这个 iframe 里 pointer 事件是否可用（可用就只认 pointer，避免重复计数） */
  private pointerWorks = false;
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
  }

  /** 装载到哪一步了。出错时告诉用户卡在哪，而不是「打不开」三个字 */
  private phase: 'idle' | 'read' | 'parse' | 'render' | 'locate' | 'ready' = 'idle';

  /** 当前渲染的章节序号（load 事件给的），用来只重画这一章的标注 */
  private sectionIndex = 0;
  /** 最近一次 relocate 的 CFI：竖排/布局切换重载章节时靠它回到原处 */
  private lastLocationCfi = '';
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

    this.opts = opts;
    this.prefs = opts.prefs;
    this.container = container;

    this.phase = 'read';
    const { book, meta } = await this.buildBook(vaultPath);
    /* 解包期间可能已经被关书 / 换书（看门狗、用户点回书架）：这一轮就作废，
       别把书挂到一个已经不存在的画布上。 */
    if (this.container !== container) {
      book.destroy?.();
      throw new OpenCancelledError();
    }
    this.book = book;

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
      const percent = typeof d.fraction === 'number' ? Math.min(1, Math.max(0, d.fraction)) : 0;
      /* 正文真的出字了。诊断页靠这个把「卡在读/解包/分页」和「只是在排版」分开 */
      if (this.phase !== 'ready') this.phase = 'ready';
      this.chapterIndex = d.section?.current ?? this.chapterIndex;
      this.chapterTitle = d.tocItem?.label ?? this.chapterTitle;
      this.chapterHref = d.tocItem?.href ?? this.chapterHref;
      this.relocateSeq += 1;
      this.lastRelocateCfi = d.cfi ?? this.lastRelocateCfi;
      const waiters = this.relocateWaiters;
      this.relocateWaiters = [];
      for (const w of waiters) w();
      this.opts.onRelocate?.({
        percent,
        cfi: d.cfi ?? '',
        chapterIndex: this.chapterIndex,
        chapterTitle: this.chapterTitle,
        chapterHref: this.chapterHref,
        sectionCurrent: d.section?.current ?? 0,
        sectionTotal: d.section?.total ?? 0,
        remainingSeconds: Math.round(d.time?.total ?? 0),
      });
    });

    // 每次换章都会来一个 load：手势监听挂在当前文档上，旧文档随 iframe 一起丢弃
    view.addEventListener('load', (e) => {
      const { doc, index } = (e as CustomEvent).detail as { doc: Document; index: number };
      this.sectionIndex = index;
      this.unbindDocGestures();
      this.bindGestures(doc);
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
         会一直挂着——打开一本坏书就等于漏一次内存。 */
      try {
        view.close();
      } catch {
        /* 没 open 成功的视图再 close 会抛，忽略 */
      }
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
    this.phase = 'locate';

    const render = async (): Promise<void> => {
      if (cfi) {
        const resolved = view.resolveNavigation(cfi);
        if (resolved) {
          await view.init({ lastLocation: cfi });
          return;
        }
      }
      await view.init({ showTextStart: true });
      if (fraction > 0.002) {
        await view.goToFraction(Math.min(1, fraction)).catch(() => undefined);
      }
    };

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
      this.phase = 'locate';
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
    this.phase = 'ready';
  }

  /* ─────────────────── 输入 ─────────────────── */

  private turn(dir: 'prev' | 'next'): void {
    const now = Date.now();
    if (now - this.lastTurnAt < WHEEL_COOLDOWN) return;
    this.lastTurnAt = now;
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

    // Ctrl/⌘ + 滚轮：改字号。桌面端这是最顺手的缩放，比去开面板快
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      const step = main > 0 ? -1 : 1;
      const next = Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, this.prefs.fontSize + step));
      if (next !== this.prefs.fontSize) this.opts.onFontSize?.(next);
      return;
    }

    /* 滚动模式（P2-02）：滚轮交给浏览器自己滚，不拦、不翻页。
       这是桌面阅读的第一诉求——想往上回看两行，分页模式只能整页翻回去。
       Ctrl/⌘ + 滚轮仍然改字号（那是最顺手的缩放，两种模式都该有）。

       只有「已经滚到章末/章首还继续滚」才接管，换来「一章滚完自动下一章」。 */
    if (this.prefs.flow === 'scroll' && !ev.ctrlKey && !ev.metaKey) {
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
    const writingMode = doc.defaultView?.getComputedStyle(doc.body).writingMode ?? '';
    this.verticalContent = writingMode.startsWith('vertical');

    /* ① 点按三区。
       不用 `click`：移动端一次触摸可能合成两次 click（一次给 iframe、一次给
       应用），一次点按被记成两次翻页——「翻过去又翻回来」就是它。
       也不用「只看 pointer」：部分 WebView 在 preventDefault 过的 iframe 里
       干脆不派发 pointer 事件，那样真机上会完全没反应。所以 pointer 与 touch
       两条路都听，最后都汇到 emitTap，用时间戳去重，一次手势只算一次。 */
    const TAP_MOVE_PX = 12;
    const TAP_LONG_PRESS_MS = 500;

    const emitTap = (
      x: number,
      y: number,
      target: EventTarget | null,
      source: string,
      screenX = 0,
      screenY = 0,
    ): void => {
      const now = Date.now();
      if (now < this.suppressClickUntil) return;
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed) return;
      const node = target as HTMLElement | null;
      if (node?.closest?.('a[href], [data-bzr-skip-tap]')) return;
      /* 点在划线上是要看那条标注，不是要翻页 */
      if (this.hitsAnnotation({ clientX: x, clientY: y })) return;
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
      const zone: 'prev' | 'next' = withinY < (liveH || 1) * 0.4 ? 'prev' : 'next';
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
      /* 走完一次完整的 pointerup 才认定 pointer 可用：有的 WebView 只发
         pointerdown 不发 pointerup，那种情况下还要靠触摸兜底 */
      this.pointerWorks = true;
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
    let touchTap: { x: number; y: number; at: number; moved: number; fingers: number } | null = null;

    const onTouchStart = (ev: TouchEvent): void => {
      if (ev.touches.length === 1) {
        const t = ev.touches[0];
        this.lastTouchY = t?.clientY ?? 0;
        touchTap = { x: t.clientX, y: t.clientY, at: Date.now(), moved: 0, fingers: 1 };
      } else if (touchTap) {
        touchTap.fingers = ev.touches.length;
      }
      if (ev.touches.length !== 2) return;
      this.twoFingerSpan = distance(ev.touches);
      this.twoFingerAt = Date.now();
      this.twoFingerMove = 0;
      /* 移动端不再用双指捏合改字号：它和系统/宿主的缩放手势抢同一只手。
         两指轻按（切换沉浸）仍然保留。 */
      if (!isMobileEnv()) {
        this.pinchStart = this.twoFingerSpan;
        this.pinchBase = this.prefs.fontSize;
      }
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
      /* 移动端捏合已关：pinchStart 恒为 0，到这里就返回，既不拦默认行为也不改字号 */
      if (!this.pinchStart) return;
      ev.preventDefault();
      const ratio = span / this.pinchStart;
      const next = Math.min(
        FONT_SIZE_RANGE.max,
        Math.max(FONT_SIZE_RANGE.min, Math.round(this.pinchBase * ratio)),
      );
      this.queueFontSize(next);
    };
    const onTouchEnd = (ev: TouchEvent): void => {
      /* 松手时把节流里最后那一档字号补上，否则停在中途的那一档就丢了 */
      if (ev.touches.length < 2) this.flushFontSize();
      /* 两指轻按：时间短、两指间距几乎没变。捏合会改字号，这里不拦。 */
      if (ev.touches.length < 2 && this.twoFingerAt) {
        const startedAt = this.twoFingerAt;
        const moved = this.twoFingerMove;
        this.pinchStart = 0;
        this.twoFingerAt = 0;
        this.twoFingerMove = 0;
        if (Date.now() - startedAt < 400 && moved < 14) {
          /* 吞掉同一手势末尾合成的那次 click，免得顺带翻一页 */
          this.suppressClickUntil = Date.now() + 500;
          this.opts.onTwoFingerTap?.();
        }
      }
      /* 单指点按兜底：只在 pointer 事件根本不来时才用（少数 WebView）。
         pointer 一旦可用就走 pointer，两条都用会把一次点按算两次。 */
      if (!this.pointerWorks && touchTap && ev.touches.length === 0) {
        const state = touchTap;
        touchTap = null;
        const t = ev.changedTouches[0];
        if (
          state.fingers === 1 &&
          t &&
          Date.now() - state.at < TAP_LONG_PRESS_MS &&
          state.moved < TAP_MOVE_PX
        ) {
          emitTap(t.clientX, t.clientY, ev.target, 'touch-fallback', t.screenX, t.screenY);
        }
      }
    };

    /* 点按拦截：在捕获阶段吞掉这次 touchend，分页器就收不到它，
       也就不会跑「零速度吸附」——「翻过去又被吸回来」的另一半源头。
       这一层不依赖 vendor 补丁是否生效：插件重载后旧的自定义元素还在页面上，
       补丁不会重新注册，只有这层能兜住。 */
    const onTouchEndCapture = (ev: TouchEvent): void => {
      const tap = touchTap;
      if (!tap || tap.fingers !== 1 || ev.touches.length > 0) return;
      if (Date.now() - tap.at >= TAP_LONG_PRESS_MS) return;
      if (tap.moved >= TAP_MOVE_PX) return;
      if (!this.pointerWorks) {
        const t = ev.changedTouches[0];
        if (t) emitTap(t.clientX, t.clientY, ev.target, 'touch', t.screenX, t.screenY);
      }
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

  /** 捏合字号：80ms 合并，只把最后一档交出去（P2-19） */
  private queueFontSize(next: number): void {
    this.pinchPending = next;
    if (this.pinchTimer !== null) return;
    this.pinchTimer = window.setTimeout(() => {
      this.pinchTimer = null;
      this.flushFontSize();
    }, 80);
  }

  /** 立刻提交待发的字号（松手 / 销毁时调） */
  private flushFontSize(): void {
    if (this.pinchTimer !== null) {
      window.clearTimeout(this.pinchTimer);
      this.pinchTimer = null;
    }
    const next = this.pinchPending;
    this.pinchPending = null;
    if (next !== null && next !== this.prefs.fontSize) this.opts.onFontSize?.(next);
  }

  /** 选区检查（防抖）。同一段选区只上报一次，避免浮层被重复 show 打断输入 */  private scheduleSelection(doc: Document, delay: number): void {
    if (!this.opts.onSelect) return;
    if (this.selTimer !== null) window.clearTimeout(this.selTimer);
    this.selTimer = window.setTimeout(() => {
      this.selTimer = null;
      const info = this.readSelection(doc);
      const key = info?.cfiRange ?? '';
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
      const [value] = overlayer.hitTest({ x: point.clientX, y: point.clientY });
      if (value && this.annotColors.has(value)) return true;
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
    if (!view) return;
    for (const a of this.annots) {
      if (a.chapterIndex != null && a.chapterIndex !== this.sectionIndex) continue;
      void view.addAnnotation({ value: a.cfiRange }).catch((err: unknown) => {
        console.warn('[bz-reader] 标注定位失败：', err);
      });
    }
  }

  /** 清掉书里的选区（画完线、点走浮层之后调，否则菜单会一直挂着） */
  clearSelection(): void {
    const sel = this.view?.renderer?.getContents?.()[0]?.doc?.getSelection?.();
    sel?.removeAllRanges();
    this.lastSelKey = '';
  }

  private unbindDocGestures(): void {
    for (const off of this.docDetachers.splice(0)) off();
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
    await this.enqueue(() => this.turnOnce('next'));
  }

  async prev(): Promise<void> {
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
   * 开始念——翻到第 20 页再按朗读又回到开头。这里用 caretRangeFromPoint 取
   * 可见区左上/右下两个点，拼成一段 Range 只取屏幕上这一页；取不到才退回整章。
   */
  currentText(): string {
    const contents = this.view?.renderer?.getContents?.() ?? [];
    const parts: string[] = [];
    for (const c of contents) {
      const doc = c.doc;
      if (!doc?.body) continue;
      const visible = this.visibleText(doc);
      const t = (visible || doc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    }
    return parts.join(' ').trim();
  }

  /* caretRangeFromPoint 在 TS 的 DOM 类型里标了 deprecated，但 Chromium 只认
     它——caretPositionFromPoint 在 Obsidian 支持的内核里还没实现。这里做的是
     iframe 内的坐标命中测试，换 API 等于整个可见区文字退化成空串。
     项目 eslint 配置里关掉了 no-deprecated，理由同上。 */
  /** 可见区文字：两点 Range（拿不到返回空串，由调用方退回整章） */
  private visibleText(doc: Document): string {
    const win = doc.defaultView;
    if (!win || typeof doc.caretRangeFromPoint !== 'function') return '';
    try {
      const w = win.innerWidth || doc.documentElement.clientWidth || 0;
      const h = win.innerHeight || doc.documentElement.clientHeight || 0;
      if (w < 8 || h < 8) return '';
      const start = doc.caretRangeFromPoint(2, 2);
      const end = doc.caretRangeFromPoint(w - 4, h - 4);
      if (!start || !end) return '';
      const range = doc.createRange();
      range.setStart(start.startContainer, start.startOffset);
      range.setEnd(end.endContainer, end.endOffset);
      return range.cloneContents().textContent ?? '';
    } catch {
      return '';
    }
  }

  /** 跳到 TOC 项（href 由 foliate 解析成章节 + 锚点） */
  async goToHref(href: string): Promise<void> {
    await this.enqueue(() => this.navigate(() => this.view?.goTo(href), '跳到这一章'));
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
    return (await this.enqueue(() => this.navigate(() => this.view?.goTo(cfi), '定位到这一页'))) === 'ok';
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
    this.unbindDocGestures();
    for (const off of this.outerDetachers.splice(0)) off();
    /* 等排队的导航收口再拆 iframe（P1-15）：不等的话，正在跑的 goTo 会在
       view 已经置空之后继续操作一个被 remove 掉的容器。 */
    await this.navChain.catch(() => undefined);
    this.wheelAcc = 0;
    this.edgeAcc = 0;
    this.edgeSide = null;
    this.pinchStart = 0;
    if (this.pinchTimer !== null) {
      window.clearTimeout(this.pinchTimer);
      this.pinchTimer = null;
    }
    this.pinchPending = null;
    if (this.selTimer !== null) {
      window.clearTimeout(this.selTimer);
      this.selTimer = null;
    }
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

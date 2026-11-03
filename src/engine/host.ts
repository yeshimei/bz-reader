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
import { makeBook, Overlayer, View } from './foliate';
import type { DrawAnnotationDetail, FoliateBook, FoliateTOCItem, FoliateView, ShowAnnotationDetail } from '../types/foliate';
import { buildChapterCSS } from './theme';
import { makeTxtBook, countWords } from './txt';
import { DEFAULT_PREFS, FONT_SIZE_RANGE, type ReaderPrefs } from '../data/prefs';
import { dlog } from '../core/debug-log';

/** 宿主坐标系里的矩形（左上角 + 宽高，单位 CSS px） */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 一次划词：文字 + CFI 范围 + 摆浮层要用的位置 */
export interface SelectionInfo {
  text: string;
  cfiRange: string;
  chapterIndex: number;
  /** 选区第一行的矩形——浮层优先贴在它上方，比贴整个选区准 */
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
  onReady?: (book: FoliateBook, meta: { title: string; author: string; wordCount: number }) => void;
  /** 单指轻触正文：左 / 中 / 右 */
  onTap?: (
    zone: 'left' | 'middle' | 'right',
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
}

/** 滚轮累计到多少才翻一页（像素）。触控板一次轻扫约 30–60，鼠标滚轮一格约 100。 */
const WHEEL_TURN_THRESHOLD = 42;
/** 两次翻页之间的最小间隔，挡住「惯性滚一串」。 */
const WHEEL_COOLDOWN = 300;
/** 拖拽/滑动超过这个距离才算要翻页，短线抖动不算。 */
const SWIPE_MIN = 48;
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

/** EPUB 3 的 epub:type 命名空间 */
const OPS_NS = 'http://www.idpf.org/2007/ops';
/** 整章文本超过这个长度就不当脚注看了——那是章节互链，不是注释 */
const FOOTNOTE_MAX = 4000;

/**
 * 这个 <a> 是不是脚注引用？
 *
 * 三档判据，从硬到软：
 *  1. `<a epub:type="noteref">` / `role="doc-noteref"` —— 规范写法，最可靠；
 *  2. 被 `<sup>` 包着（或者自己就是 sup 里的 a）—— 老书最常见的写法；
 *  3. 链接文字就是「[1]」「①」「*」这种纯标记 —— 没有 type 也没有 sup 时的兜底。
 *
 * 判错了的代价不对称：误判成脚注 = 点章节互链弹出一小窗文字（还带「跳到原文」，
 * 点一下照样能过去）；漏判 = 点注释号直接跳走，读者回不来。
 */
function isFootnoteRef(a: HTMLAnchorElement | null): boolean {
  if (!a) return false;
  const type = a.getAttributeNS(OPS_NS, 'type') ?? '';
  if (/noteref|footnote|endnote|rearnote|\bnote\b/.test(type)) return true;
  const role = a.getAttribute('role') ?? '';
  if (/doc-noteref|doc-footnote|doc-endnote|doc-glossref|doc-biblioref/.test(role)) return true;
  if (a.closest('sup')) return true;
  const label = (a.textContent ?? '').replace(/\s+/g, '');
  return label.length > 0 && label.length <= 6 && /^[[(（【]?[\d*†‡§①-⑳ivxlcdmIVXLCDM]{1,4}[\])）】]?$/.test(label);
}

export class EngineHost {
  private app: App;
  private view: FoliateView | null = null;
  private book: FoliateBook | null = null;
  private container: HTMLElement | null = null;
  private prefs: ReaderPrefs = DEFAULT_PREFS;
  private opts: MountOptions = { prefs: DEFAULT_PREFS };
  private chapterIndex = 0;
  private chapterTitle = '';
  /** 文档级监听（每换一章重建）与容器级监听（整本书只建一次）分开存，
   *  否则换章时顺手把容器滚轮也解掉了 */
  private docDetachers: Array<() => void> = [];
  private outerDetachers: Array<() => void> = [];

  /** 滚轮累计位移与上次翻页时间（一次手势只翻一页） */
  private wheelAcc = 0;
  private lastTurnAt = 0;
  /** 拖拽翻页期间抑制紧随其后的 click */
  private suppressClickUntil = 0;
  /** 两指捏合起始距离与基准字号 */
  private pinchStart = 0;
  private pinchBase = 0;
  /** 两指轻按的判定：按下时间 + 两指间距的最大变化 */
  private twoFingerAt = 0;
  private twoFingerMove = 0;
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
    dlog('viewport', { w: this.viewportWidth, left: this.viewportLeft });
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

  /** 读 vault 文件 → File。必须整份读进内存：foliate 的 zip loader 需要 seek。 */
  private async readAsFile(vaultPath: string): Promise<File> {
    const buf = await this.app.vault.adapter.readBinary(vaultPath);
    const name = vaultPath.split('/').pop() || 'book.epub';
    return new File([buf], name);
  }

  private async buildBook(vaultPath: string): Promise<{ book: FoliateBook; meta: { title: string; author: string; wordCount: number } }> {
    const name = (vaultPath.split('/').pop() || 'book').replace(/\.[^.]+$/, '');
    if (/\.txt$/i.test(vaultPath)) {
      const raw = await this.app.vault.adapter.read(vaultPath);
      const text = raw.replace(/^\uFEFF/, '');
      const book = makeTxtBook(text, { title: name });
      return { book, meta: { title: name, author: '', wordCount: countWords(text) } };
    }

    const file = await this.readAsFile(vaultPath);
    const book = await makeBook(file);
    const md = book.metadata ?? {};
    const pick = (v: unknown): string => (typeof v === 'function' ? String((v as () => string)()) : typeof v === 'string' ? v : '');
    const title = pick(md.title) || name;
    const author = pick(md.author);
    // 漫画（cbz）的 section size 是图片字节数——按字数累加会得出「三百多万字」，
    // 书架上吓人。漫画没有字数，直接给 0。
    const wordCount = /\.cbz$/i.test(vaultPath) ? 0 : book.sections.reduce((sum, s) => sum + (s.size ?? 0), 0);
    return { book, meta: { title, author, wordCount } };
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
      throw new Error('开书已取消');
    }
    this.book = book;

    /* 上层可能先画了「正在打开」占位；foliate 要独占这个容器 */
    container.empty();
    this.phase = 'parse';

    const view = document.createElement('foliate-view') as unknown as FoliateView;
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
      const anchor = doc && rects.length ? this.toHostRect(rects[0] as DOMRect, doc) : { left: 0, top: 0, width: 0, height: 0 };
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
      if (!href || !this.opts.onFootnote) return;
      if (!isFootnoteRef(d.a ?? null)) return;
      e.preventDefault();
      const a = d.a ?? null;
      const doc = a?.ownerDocument ?? null;
      const anchor = a && doc ? this.toHostRect(a.getBoundingClientRect(), doc) : { left: 0, top: 0, width: 0, height: 0 };
      void this.readFootnote(href)
        .then((info) => this.opts.onFootnote?.(info ? { ...info, anchor } : null))
        .catch(() => this.opts.onFootnote?.(null));
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
      if (this.container !== container) throw new Error('开书已取消');
    } catch (err) {
      view.remove();
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
      const rect = frame?.getBoundingClientRect();
      const winLeft = win?.screenX ?? 0;
      const screenRel = screenX > 0 ? screenX - winLeft : x;
      const scrollLeft = rect ? rect.left : 0;
      const within = Math.max(0, Math.min(width, screenRel - this.viewportLeft));
      const zone = within < width * 0.3 ? 'left' : within > width * 0.7 ? 'right' : 'middle';
      this.opts.onTap?.(zone, { x, y, width, source, scrollLeft, within, screenX });
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
      emitTap(ev.clientX, ev.clientY, ev.target, 'pointer', ev.screenX);
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
        touchTap = { x: t.clientX, y: t.clientY, at: Date.now(), moved: 0, fingers: 1 };
      } else if (touchTap) {
        touchTap.fingers = ev.touches.length;
      }
      if (ev.touches.length !== 2) return;
      this.pinchStart = distance(ev.touches);
      this.pinchBase = this.prefs.fontSize;
      this.twoFingerAt = Date.now();
      this.twoFingerMove = 0;
    };
    const onTouchMove = (ev: TouchEvent): void => {
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
      if (ev.touches.length !== 2 || !this.pinchStart) return;
      ev.preventDefault();
      const span = distance(ev.touches);
      this.twoFingerMove = Math.max(this.twoFingerMove, Math.abs(span - this.pinchStart));
      const ratio = span / this.pinchStart;
      const next = Math.min(
        FONT_SIZE_RANGE.max,
        Math.max(FONT_SIZE_RANGE.min, Math.round(this.pinchBase * ratio)),
      );
      if (next !== this.prefs.fontSize) this.opts.onFontSize?.(next);
    };
    const onTouchEnd = (ev: TouchEvent): void => {
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
          emitTap(t.clientX, t.clientY, ev.target, 'touch-fallback', t.screenX);
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
        if (t) emitTap(t.clientX, t.clientY, ev.target, 'touch', t.screenX);
      }
      /* 拦下这一条，分页器就收不到 touchend，不会跑零速度吸附 */
      dlog('tap.blockSnap', { moved: Math.round(tap.moved), ms: Date.now() - tap.at, pointerWorks: this.pointerWorks });
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
    });
  }

  /** 选区检查（防抖）。同一段选区只上报一次，避免浮层被重复 show 打断输入 */
  private scheduleSelection(doc: Document, delay: number): void {
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
    const first = rects[0] as DOMRect;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const r of rects) {
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    const g = this.frameGeom(doc);
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
      bounds: {
        left: g.left + left * g.scale,
        top: g.top + top * g.scale,
        width: (right - left) * g.scale,
        height: (bottom - top) * g.scale,
      },
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

  /** 主题/字号/行距变化时调，只换样式不重开书 */
  applyPrefs(prefs: ReaderPrefs): void {
    const prev = this.prefs;
    this.prefs = prefs;
    const renderer = this.view?.renderer as unknown as { setStyles?: (css: string) => void } | undefined;
    renderer?.setStyles?.(buildChapterCSS(prefs));
    // 栏数走 CSS 变量进 shadow 的 #top（vendor 补丁把它接成了 var(--_column-count, 2)）；
    // 挂在 paginator 元素上，自定义属性会继承进 shadow 树
    const pag = this.view?.renderer as unknown as (HTMLElement & { render?: () => void }) | undefined;
    pag?.style?.setProperty('--_column-count', String(prefs.columns));
    // 分页模式下 foliate 用内联 !important 把 documentElement 的 padding 覆成
    // 「左右列距、上下 0」（columnize()），注入的 body padding 只对章首页生效——
    // 章中页顶端只剩 shadow 的 48px 边距行。vendor 补丁把上下 padding 接成
    // var(--_pad-top/bottom)。自绘工具栏撤了之后这里给 0，留白全由 theme.ts 管。
    pag?.style?.setProperty('--_pad-top', '0px');
    pag?.style?.setProperty('--_pad-bottom', '8px');
    if (!this.view || !prev) return;
    if (prev.layout !== prefs.layout) {
      // 竖排切换必须重新装载章节：引擎只在 load 时读一次 writing-mode，
      // 中途改注入不会重排。goTo 当前位置会让同章节重新 load，落回原处。
      if (this.lastLocationCfi) {
        void this.view.goTo(this.lastLocationCfi).catch(() => undefined);
      }
    } else if (prev.columns !== prefs.columns) {
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
   */
  private async navigate(
    run: () => Promise<unknown> | undefined,
    what: string,
    timeoutMs = LOCATE_TIMEOUT,
  ): Promise<void> {
    let timer = 0;
    const timeout = new Promise<'timeout'>((r) => {
      timer = window.setTimeout(() => r('timeout'), timeoutMs);
    });
    try {
      const done = await Promise.race([Promise.resolve(run()).then(() => 'ok' as const), timeout]);
      if (done === 'timeout') {
        dlog('nav.timeout', { what, timeoutMs });
        this.opts.onStall?.(what);
      }
    } catch {
      /* 引擎自己的错误已经有地方报了（读文件/解包在 mount 里），这里只管「不结算」 */
      dlog('nav.error', { what });
      this.opts.onStall?.(what);
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
   * 所有会动 iframe 的导航都排成一条队。
   *
   * 两次翻页并发时，后一次会在分页器 `#locked` 期间被吞掉，或者两次各跳一节、
   * 互相把 iframe 顶掉——表现就是「点一下前进、再点一下退回」。串行化之后
   * 每次点按都对应一次完整导航。同目录 weave 的 `enqueueNavigation` 同理。
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
    await this.navigate(
      () => (dir === 'next' ? this.view?.next() : this.view?.prev()),
      dir === 'next' ? '翻到下一页' : '翻回上一页',
      TURN_TIMEOUT,
    );
    /* 分页器的 replace 与 relocate 是异步的：刚 await 完 next() 时页码往往还是旧的，
       立刻比对会误判成「没翻动」，接着又跳一次相邻章——一次点击翻两页就是这么来的。
       等一次 relocate（或 600ms）再判定。 */
    await this.waitRelocate(seqBefore, 600);
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
   * 当前渲染出的正文纯文本（朗读用）。
   *
   * 只取 renderer 里已经挂上去的那几个 section 文档——分页模式下通常
   * 就是屏幕上这一两页；不另开 section 去解压整章，那会让「按下朗读」
   * 卡上几百毫秒。取不到就返回空串，由调用方提示。
   */
  currentText(): string {
    const contents = this.view?.renderer?.getContents?.() ?? [];
    const parts: string[] = [];
    for (const c of contents) {
      const body = c.doc?.body;
      if (!body) continue;
      const t = (body.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    }
    return parts.join(' ').trim();
  }

  /** 跳到 TOC 项（href 由 foliate 解析成章节 + 锚点） */
  async goToHref(href: string): Promise<void> {
    await this.navigate(() => this.view?.goTo(href), '跳到这一章');
  }

  async goToCfi(cfi: string): Promise<void> {
    if (!cfi) return;
    await this.navigate(() => this.view?.goTo(cfi), '定位到这一页');
  }

  /**
   * 把一条脚注的正文从目标章节里抓出来。
   *
   * 不开第二个 `foliate-view`（foliate 自带的 FootnoteHandler 是那么做的：为了
   * 看两行注释，把整本书重新 open 一遍），而是直接让 section 造一份 Document，
   * 按 `resolveHref` 给的 anchor 找元素取文本。抓到的文本超过 FOOTNOTE_MAX
   * 说明这是章节互链而不是注释——那种情况返回 null，交回 foliate 直接跳过去。
   */
  private async readFootnote(href: string): Promise<Omit<FootnoteInfo, 'anchor'> | null> {
    const book = this.book;
    if (!book) return null;
    const target = book.resolveHref?.(href) ?? null;
    if (!target || typeof target.index !== 'number' || target.index < 0) return null;
    const section = book.sections[target.index];
    if (!section?.createDocument) return null;
    let doc: Document;
    try {
      doc = await section.createDocument();
    } catch {
      return null;
    }
    const anchorFn = target.anchor;
    const el = typeof anchorFn === 'function' ? (anchorFn as (d: Document) => Node | null)(doc) : null;
    if (!el) return null;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > FOOTNOTE_MAX) return null;
    return { text, href, chapterIndex: target.index };
  }

  /** 整书百分比跳转（移动端进度滑杆松手时用） */
  async goToPercent(fraction: number): Promise<void> {
    const view = this.view;
    if (!view) return;
    const f = Math.min(1, Math.max(0, fraction));
    await this.navigate(() => view.goToFraction(f).catch(() => undefined), '跳到这个进度');
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
    opts: { chapterOnly?: boolean; onHit?: (hit: SearchHit & { chapterIndex: number; chapterLabel: string }) => void } = {},
  ): Promise<Array<SearchHit & { chapterIndex: number; chapterLabel: string }>> {
    const view = this.view;
    const q = query.trim();
    if (!view || !q) return [];
    const out: Array<SearchHit & { chapterIndex: number; chapterLabel: string }> = [];
    const iter = view.search(opts.chapterOnly ? { query: q, index: this.chapterIndex } : { query: q });
    for await (const item of iter) {
      if (item === 'done') break;
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
    return out;
  }

  clearSearch(): void {
    this.view?.clearSearch();
  }

  async destroy(): Promise<void> {
    this.unbindDocGestures();
    for (const off of this.outerDetachers.splice(0)) off();
    this.wheelAcc = 0;
    this.pinchStart = 0;
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
      try {
        view.close();
      } catch {
        /* 已卸载的书再 close 会抛，忽略 */
      }
      view.remove();
    }
    book?.destroy?.();
    this.container = null;
  }
}

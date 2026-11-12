/* ============================================================
 * bz-reader · PDF 阅读视图（engine/pdf/view.ts）
 *
 * 连续滚动 + 按页虚拟化。和 EPUB 的分页器不是一回事：
 *   · EPUB 一章一个 iframe，靠 foliate 的分页器排版；
 *   · PDF 一页一张 canvas，滚动容器里只保留可视区附近的几张，其余页
 *     用等尺寸占位撑高度——一本 1000 页的 PDF 才不会把内存吃光。
 *
 * 三个容易写错的地方（都在真机上踩过）：
 *  1. **canvas 内部分辨率与文字层缩放必须分开**：canvas 乘 dpr 提清晰度，
 *     文字层只按 CSS 缩放摆，混了就会「字和画错位」。
 *  2. **选区坐标要归一化后再存**：滚动、缩放、重开书之后，绝对像素全失效，
 *     只有「相对页宽高的比例」能复现。
 *  3. **点按翻页要让位于选区**：刚选完字点一下是收工具条，不是翻页。
 * ============================================================ */

import type { Rect, RelocateInfo, SelectionInfo } from '../host';
import { parsePdfLinkHash } from '../../data/pdf-link';
import { debugEvent } from '../../data/debug-log';
import type { PdfDocument, PdfPageSize, PdfRenderTask } from './document';
import type { PdfBacklinkHit } from '../../data/pdf-backlink';
import { pdfColorFromName, type PdfLinkSelection } from '../../data/pdf-link';
import { colorCss } from '../../data/notes';
import { t } from '../../i18n';
import { fitScaleFor, needsFitWidth, pickFitSize, resolveInitialZoom, type PdfBox, type PdfZoomMode } from './fit';
import { PDF_BAR_ITEMS, PDF_LAYOUT_ROWS, PDF_ZOOM_MODES, zoomTargetPlan, type PdfZoomTarget } from './panel';
import { anchoredBelowRightIn } from '../../shell/anchored-style';
import { pageAtRow, turnPage } from './layout';
import { pageLabelText } from './pagelabels';
import { mergeRects } from './rects';
import { rangesInText } from './search';
import { PdfThumbPanel } from './thumbs';
import type { PdfFileAnnot } from './annots';
import {
  encodePdfLocator,
  encodePdfRectLocator,
  normalizePdfRect,
  parsePdfLocator,
  pdfPageLocator,
  rotateNormRect,
} from './locator';
import { beginTwoFinger, endTwoFinger, moveTwoFinger, type FingerPoint, type TwoFingerTapState } from './two-finger-tap';

export interface PdfViewCallbacks {
  onRelocate?: (info: RelocateInfo) => void;
  onSelect?: (info: SelectionInfo | null) => void;
  onAnnotTap?: (info: { locator: string; anchor: Rect }) => void;
  onTwoFingerTap?: () => void;
  onStall?: (what: string) => void;
  /** 视图状态变了（旋转 / 双页）：宿主负责按书记住，下次打开还原 */
  onViewState?: (state: PdfViewState) => void;
  /** 导出某一页为图片。渲染与落盘都在宿主那边，视图只负责触发 */
  onExportPage?: (page: number) => Promise<void>;
  /**
   * 工具栏「复制」菜单里的四种产出。字符串只描述「要什么」，拼链接、
   * 取标注都在壳层做——引擎不认识书在库里的路径，也不认识划线数据。
   */
  onCopy?: (kind: PdfCopyKind) => void;
  /** 点页面上的反链框：打开写这条引用的笔记 */
  onBacklinkTap?: (info: { sourcePath: string; event: MouseEvent }) => void;
  /** 点 PDF 自带的批注图标：把批注正文交给壳层弹卡 */
  onFileAnnotTap?: (info: { contents: string; author: string; anchor: Rect }) => void;
  /**
   * 「这一页该怎么写成链接」——缩略图拖到笔记里时用。
   * 引擎不知道书名与库内路径，所以只问一句、不自己拼。
   */
  linkForPage?: (page: number) => string;
  /** 当前 PDF 相关偏好（开书缩放 / 批注 / 反链开关），每次用的时候现取 */
  pdfPrefs?: () => PdfViewPrefs;
  /** 面板里切了「一屏一页 / 连续滚动」：写回 **PDF 自己的**翻页偏好 */
  onFlowChange?: (mode: 'paged' | 'scroll') => void;
  /** 跳转历史条数变了：头栏那颗「回到上一处」据此亮 / 灰 */
  onHistoryChange?: (count: number) => void;
}

/** 视图要从排版偏好里拿的那几项（PDF 的字号行距来自原文件，与正文无关） */
export interface PdfViewPrefs {
  /** 开书缩放档 */
  zoom: PdfZoomMode;
  /** 画文件自带的标注 */
  annots: boolean;
  /** 画笔记反链高亮 */
  backlinks: boolean;
}

/** 「复制」菜单的四种产出（见 PdfViewCallbacks.onCopy） */
export type PdfCopyKind = 'page' | 'view' | 'embed' | 'marks';

/** 每本书各自记住的 PDF 视图状态（角度、双页）。与全局 prefs 分开存 */
export interface PdfViewState {
  rotation: number;
  spread: boolean;
}

/** 归一化矩形：相对页宽高的比例（0..1），滚动/缩放后仍能复现 */
interface NormRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface AnnotRecord {
  color: string;
  page: number;
  quote: string;
  rects?: NormRect[];
}

const PAGE_GAP = 20;
const SIDE_PAD = 12;
/** 可视页前后各预渲染几页 */
const PRELOAD = 1;
/** 最多同时保留几张已渲染的页 */
const KEEP_ALIVE = 6;
/** 同时进行几个渲染任务：主线程解析，2 个已经够快，再多只会互相拖慢 */
const MAX_PARALLEL = 2;
const RELOCATE_MS = 120;
const SELECTION_MS = 160;
/** 滚动停下多久之后重新确认一次当前页（scroll-snap 吸附要等它稳定） */
const SCROLL_SETTLE_MS = 140;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * 旋转后的页面盒尺寸（纯函数，便于单测）。
 *
 * 0/180 度不变，90/270 度交换宽高。负值与 360 的倍数都归一到 0/90：
 * `-90 ≡ 270`（交换）、`360 ≡ 0`（不变）。`rotation` 是叠加在文件
 * `/Rotate` 之上的额外角度（0/90/180/270）。
 */
export function boxSizeFor(raw: PdfPageSize, rotation: number): PdfPageSize {
  const turned = (((rotation % 180) + 180) % 180) === 90;
  // 旋转后画布尺寸与页框必须一致，否则页面被裁一块（#2 修复）
  return turned ? { width: raw.height, height: raw.width } : { ...raw };
}

export class PdfView {
  private readonly doc: PdfDocument;
  private readonly opts: PdfViewCallbacks;
  private readonly root: HTMLDivElement;
  private readonly scroller: HTMLDivElement;
  private readonly pagesBox: HTMLDivElement;

  private pageEls: HTMLDivElement[] = [];
  private sizes: PdfPageSize[] = [];
  private offsets: number[] = [];
  private scale = 1;
  /** none = 用户自己定的比例（默认 100%）：不跟着窗口宽度重算 */
  private fitMode: 'width' | 'page' | 'none' = 'none';
  /** 适配基准：整本里最宽最高的那页，见 fit.ts 的注释 */
  private fitSize: PdfBox = { width: 612, height: 792 };
  /** 额外旋转角度（0/90/180/270），叠加在 PDF 自带的 /Rotate 之上 */
  /** 当前旋转角（0 / 90 / 180 / 270）。头栏与面板要读它 */
  rotation = 0;
  /** false = 连续滚动单栏；true = 双页并排（跨页扫描件） */
  /** 双页并排开着没有（面板与快捷键要读它） */
  spread = false;
  /** true = 一屏一页（翻页像 EPUB）；false = 连续滚动 */
  private paged = false;
  private current = 1;
  private destroyed = false;

  private readonly rendered = new Set<number>();
  private readonly rendering = new Set<number>();
  private readonly failed = new Set<number>();
  private readonly queue: number[] = [];
  private active = 0;
  private readonly tasks = new Map<number, PdfRenderTask>();
  private readonly recency = new Map<number, number>();
  private recencySeq = 0;
  /** 每次缩放/重排 +1；旧渲染回来时用它判断这一轮是否已作废 */
  private scaleGen = 0;

  private readonly annots = new Map<string, AnnotRecord>();
  /** 笔记里引用了这本书的位置：页面上单独一层虚线，别和划线混在一起 */
  private backlinks: PdfBacklinkHit[] = [];
  /**
   * 划词当时的矩形缓存（含当时的旋转角）。
   * 文字层被 pdf.js 拆得很碎时，靠原文片段搜不回来，这份缓存是可靠兜底；
   * 但页面转过角度之后坐标系就变了，必须按 `rot` 判断能不能直接用。
   */
  private readonly selectionRects = new Map<string, { rot: number; rects: NormRect[] }>();
  private pulseTimer: number | null = null;
  private zoomLabelEl: HTMLButtonElement | null = null;
  private pageLabelEl: HTMLSpanElement | null = null;
  /** 可拖的页码滑块：278 页的书只靠滚轮找一页太慢 */
  private progressEl: HTMLInputElement | null = null;
  private thumbs: PdfThumbPanel | null = null;

  /** 书的页码标签（`/PageLabels`）：论文前置页是 i、ii…；null = 没有 */
  private pageLabels: string[] | null = null;
  /** PDF 文件里自带的标注，按页缓存；换角度时整份作废 */
  private readonly fileAnnots = new Map<string, PdfFileAnnot[]>();
  /** 跳转历史：从笔记 / 目录跳进某一页之后能一键回来 */
  private readonly history: Array<{ page: number; top: number }> = [];
  private copyMenuEl: HTMLDivElement | null = null;
  /** 工具栏本体：菜单要贴着它的上沿摆（窄栏/手机会换行成两排，高度不是常量） */
  private toolbarEl: HTMLDivElement | null = null;
  /** 页内链接的悬浮预览（目标页缩略图） */
  private linkPreviewEl: HTMLDivElement | null = null;
  private linkPreviewTimer: number | null = null;
  private linkPreviewUrl: string | null = null;
  /** 反链框的悬浮提示 */
  private blTipEl: HTMLDivElement | null = null;
  /** 悬停提示的「延后收起」计时器（跨 span 移动时不要闪） */
  private tipOutTimer: number | null = null;
  /** 当前搜索词：命中要落到页面上，否则跳过去还得自己找 */
  private searchQuery = '';
  /** 从搜索结果点进来的那一处（文字层字符区间）：同一页多处命中时先标它 */
  private searchFocus: { page: number; start: number; end: number } | null = null;

  private observer: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private relocateTimer: number | null = null;
  private selectionTimer: number | null = null;
  /** 滚动停下后确认当前页的定时器（见 onScroll） */
  private scrollSettle: number | null = null;
  private lastSelectionAt = 0;
  private suppressClickUntil = 0;
  private lastWidth = 0;
  /** 两指轻按（切沉浸）正在判的这一轮；判定完 / 手势作废时清空 */
  private twoFinger: TwoFingerTapState | null = null;

  /* ── 框选（矩形） ── */
  private frameStart: { pageEl: HTMLElement; page: number; x: number; y: number; forced: boolean } | null =
    null;
  private frameBoxEl: HTMLDivElement | null = null;
  private framing = false;
  /** 最近一次框选完成的时间：清选区会触发 selectionchange，别让空选区把它收掉 */
  private lastRegionAt = 0;
  /**
   * 正在拖的那一段选区自己画。
   *
   * 原生 `::selection` 画在 pdf.js 的文字层上，而文字层是按 span 切的：
   * 挨着的 span 有重叠、行内还有缝，叠上 0.28 的半透明蓝就成了一格一格的
   * 深色块 + 白缝（真机上看着像「背景色很乱」）。这里改成先把选区矩形
   * 按行合并，再画一层平的色块，原生选区自己不再上色（见 styles.css）。
   */
  private liveSel: { page: number; root: HTMLElement } | null = null;

  constructor(doc: PdfDocument, opts: PdfViewCallbacks) {
    this.doc = doc;
    this.opts = opts;

    this.root = createDiv();
    this.root.className = 'bzr-pdf';
    this.scroller = createDiv();
    this.scroller.className = 'bzr-pdf-scroll';
    this.pagesBox = createDiv();
    this.pagesBox.className = 'bzr-pdf-pages';
    this.scroller.appendChild(this.pagesBox);
    this.root.appendChild(this.scroller);
  }

  get numPages(): number {
    return this.doc.numPages;
  }

  get page(): number {
    return this.current;
  }

  get pageKey(): string {
    return `pdf:${this.current}`;
  }

  get container(): HTMLElement {
    return this.root;
  }

  get zoomLabel(): string {
    return `${Math.round(this.scale * 100)}%`;
  }

  /** 挂进舞台并建好所有页的骨架（不渲染内容） */
  async mount(host: HTMLElement): Promise<void> {
    /* 零页 PDF：循环根本不会执行，界面上什么都没有；抛一个带明确原因的错误，
       让 reader-view 现有的「打不开」错误页显示出来（不在这里自己做 UI）。 */
    if (this.numPages === 0) throw new Error(t('pdf.err.empty'));
    host.empty();
    host.appendChild(this.root);
    const first = await this.doc.getPageSize(1);
    this.sizes = Array.from({ length: this.numPages }, () => first);
    this.sizes[0] = first;
    /* 每页尺寸可能不同（封面、插页、最后一页都常见），骨架高度和适配基准
       都必须按真实尺寸来，否则滚动条长度和缩放比例一开始就是错的 */
    await this.sampleSizes();
    this.fitSize = pickFitSize(this.sizes);
    this.scale = 1;
    /* 开书缩放：设置页「PDF · 默认缩放」决定。`auto`（默认）是以前的行为——
       窄分栏 / 手机竖屏上 100% 摆不下（A4 正文 595pt 放进 390px 的屏幕，右边
       半页裁在屏幕外）就退到「适合宽度」，摆得下就按原大。 */
    const zoom = resolveInitialZoom(
      this.opts.pdfPrefs?.().zoom ?? 'auto',
      needsFitWidth(this.fitSize.width, this.root.clientWidth, SIDE_PAD),
    );
    if (zoom === 'width' || zoom === 'page') {
      this.fitMode = zoom;
      this.scale = this.fitScale(zoom);
    }
    this.buildShells();
    this.mountToolbar();
    this.bindEvents();
    /* 首屏必须立刻画：几秒空白会被当成「这本书打不开」 */
    this.ensureAround(1, true);
  }

  /** 抽几页问真实尺寸：只问第 1 页会把封面尺寸当成整本的尺寸 */
  private async sampleSizes(): Promise<void> {
    const total = this.numPages;
    const picks = new Set<number>();
    for (let page = 1; page <= Math.min(4, total); page += 1) picks.add(page);
    const step = Math.max(1, Math.floor(total / 6));
    for (let page = 1; page <= total; page += step) picks.add(page);
    picks.add(total);
    await Promise.all(
      [...picks].map(async (page) => {
        try {
          this.sizes[page - 1] = await this.doc.getPageSize(page);
        } catch {
          /* 单页取不到就沿用第 1 页尺寸，不影响能不能读 */
        }
      }),
    );
  }

  /** 回到某页：优先 locator，其次 PDF++/Obsidian 的 #page= 链接，最后百分比 */
  async start(locator: string | undefined, fraction: number): Promise<void> {
    const internal = locator ? parsePdfLocator(locator) : null;
    const external = !internal && locator ? parsePdfLinkHash(locator) : null;
    const page = internal
      ? clamp(internal.page, 1, this.numPages)
      : external
        ? clamp(external.page, 1, this.numPages)
        : clamp(1 + Math.round(clamp(fraction, 0, 1) * Math.max(0, this.numPages - 1)), 1, this.numPages);
    /* 链接里带 `offset=`（本插件「当前视图链接」、PDF++ 的 native 视图链接）：
       先按缩放排一遍，再落到页内那一行。没这两个字段就还是老行为 */
    const offset = external?.offset;
    if (offset) {
      const zoom = Number(offset.zoom);
      if (Number.isFinite(zoom) && zoom >= 0.2 && zoom <= 8 && Math.abs(zoom - this.scale) > 0.01) {
        this.fitMode = 'none';
        this.applyScale(zoom, false);
      }
    }
    const top = Number(offset?.top);
    this.goToPage(page, false, Number.isFinite(top) ? clamp(top, 0, 1) : 0);
    this.current = page;
    this.emitRelocate();
  }

  next(): void {
    /* 一屏一页 / 双页并排时不能 scrollBy 半屏：那样会停在两页中间，
       而且双页模式一屏两页，按页跳会漏掉右页。统一按「屏」跳。 */
    if (this.paged || this.spread) {
      this.goToPage(turnPage(this.current, this.numPages, 1, this.spread), true);
      return;
    }
    this.scroller.scrollBy({ top: Math.max(120, this.scroller.clientHeight * 0.92), behavior: 'smooth' });
  }

  prev(): void {
    if (this.paged || this.spread) {
      this.goToPage(turnPage(this.current, this.numPages, -1, this.spread), true);
      return;
    }
    this.scroller.scrollBy({ top: -Math.max(120, this.scroller.clientHeight * 0.92), behavior: 'smooth' });
  }

  /**
   * 一屏一页（像 EPUB 那样翻）。
   *
   * 连续滚动适合「看图表书、来回对照」，翻页适合「从头读到尾」。
   * 真正的翻页行为在 next/prev 里，这里只负责两件版面的事：
   *  1. 给根节点一个类，让 CSS 打开 scroll-snap（手动滚也停在页边界）；
   *  2. 立刻把当前页顶到屏幕最上——否则切过来的第一眼是半页正文。
   */
  setPaged(on: boolean): void {
    if (on === this.paged) return;
    this.paged = on;
    this.root.classList.toggle('is-paged', on);
    if (on) this.goToPage(this.current, false);
    /* 这里**不**发 onViewState：翻页/滚动是 PDF 自己的偏好（prefs.pdfFlow），
       不是「这本书的角度与排法」。早期版本在这里发，打开书时先按默认
       发一次 `{spread:false}`，把上次存的双页直接冲掉了。 */
  }

  get isPaged(): boolean {
    return this.paged;
  }

  /**
   * 跳到某页。`top` 是页内位置（0..1，0 = 页首）：
   * 「复制当前视图链接」存的就是它，回来时才能停在原来那一行。
   */
  goToPage(page: number, smooth = true, top = 0): void {
    const index = clamp(Math.floor(page), 1, this.numPages) - 1;
    const el = this.pageEls[index];
    if (!el) return;
    this.current = index + 1;
    const within = clamp(Number(top) || 0, 0, 1) * el.offsetHeight;
    this.scroller.scrollTo({
      top: Math.max(0, el.offsetTop - PAGE_GAP + within),
      behavior: smooth ? 'smooth' : 'auto',
    });
    this.ensureAround(this.current, true);
    this.scheduleRelocate();
  }

  goToPercent(fraction: number): void {
    this.goToPage(1 + Math.round(clamp(fraction, 0, 1) * Math.max(0, this.numPages - 1)));
  }

  goToLocator(locator: string): boolean {
    const target = parsePdfLocator(locator);
    if (target) {
      this.recordHistory();
      this.goToPage(target.page);
      return true;
    }
    /* PDF++ / Obsidian 原生 PDF 复制出来的 `#page=3&selection=…` 也要能跳 */
    const external = parsePdfLinkHash(locator);
    if (external) {
      this.recordHistory();
      this.goToPage(external.page);
      return true;
    }
    return false;
  }

  setFitMode(mode: 'width' | 'page' | 'actual'): void {
    /* 三档的落点由 panel.ts 的 zoomTargetPlan 决定：宽/页要现算，
       实际大小固定 100% 并把 fitMode 退回 none（窗口变化不再抢）。 */
    const plan = zoomTargetPlan(mode);
    this.fitMode = plan.fitMode;
    this.applyScale(plan.scale ?? this.fitScale(mode === 'page' ? 'page' : 'width'), true);
  }

  /** 页缩略图面板：278 页的书靠滚动条找页太慢 */
  toggleThumbsPanel(): void {
    if (this.thumbs?.isOpen) {
      this.thumbs.close();
      return;
    }
    this.thumbs = new PdfThumbPanel(this.doc, {
      label: t('pdf.tool.thumb'),
      closeLabel: '关闭',
      onPick: (page) => this.goToPage(page, false),
      /* 缩略图拖到笔记里 = 一条带页码的链接（PDF++ 的拖放） */
      onDragPage: (page, ev) => {
        const link = this.opts.linkForPage?.(page);
        if (!link || !ev.dataTransfer) return;
        ev.dataTransfer.setData('text/plain', link);
        ev.dataTransfer.effectAllowed = 'copy';
      },
      onClose: () => {
        this.thumbs?.close();
      },
    });
    this.thumbs.open(this.root);
    this.thumbs.setCurrent(this.current);
  }

  /** 双页并排：跨页扫描件（一张图两页）按单栏看会很别扭 */
  setSpread(on: boolean): void {
    if (on === this.spread) return;
    this.spread = on;
    this.pagesBox.classList.toggle('is-spread', on);
    /* 双页时一屏要放两页：直接切到「适合宽度」，100% 会横向溢出 */
    this.fitMode = 'width';
    /* 并排时行距交给 grid 的 row-gap，页自己的 marginBottom 必须清零，
       否则每页都被撑高一截，行与行之间出现一道越来越大的缝 */
    this.applyPageGap();
    this.applyScale(this.fitScale('width'), true);
    /* 换排之后滚动位置对应的页变了：回到当前页，别停在两页中间 */
    this.goToPage(this.current, false);
    this.updatePageLabel();
    this.opts.onViewState?.({ rotation: this.rotation, spread: this.spread });
  }

  /** 页与页之间的纵向间距：并排时归零，单栏时 20px */
  private applyPageGap(): void {
    const gap = this.spread ? 0 : PAGE_GAP;
    for (const el of this.pageEls) el.style.marginBottom = `${gap}px`;
  }

  get isSpread(): boolean {
    return this.spread;
  }

  /** 顺时针转 90 度；旋转后适配基准与所有页尺寸一起重算 */
  setRotation(deg: number): void {
    const next = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
    if (next === this.rotation) return;
    this.rotation = next;
    this.computeFitSize();
    /* 必须重建页元素：旋转后老页里还挂着上一轮画的划线 / 反链 DOM，
       它们的百分比是按旧坐标系算的，只改宽高的话会横成一条线。 */
    this.scaleGen += 1;
    for (const page of [...this.rendered]) this.release(page);
    this.rendering.clear();
    this.queue.length = 0;
    this.selectionRects.clear();
    /* 自己画的那层选区是按旧角度量的，页元素一换就跟着作废 */
    this.clearLiveSelection();
    this.buildShells();
    /* 旧页元素刚被删掉，观察器要重新挂到新元素上 */
    if (this.observer) {
      this.observer.disconnect();
      for (const el of this.pageEls) this.observer.observe(el);
    }
    this.applyScale(this.scale, true);
    /* 页宽高互换后原来的滚动位置未必还在页首，重新对齐一次 */
    this.goToPage(this.current, false);
    this.opts.onViewState?.({ rotation: this.rotation, spread: this.spread });
  }

  /** 打开书时还原上次的视角（旋转 / 双页）。角度非法按 0 处理 */
  restoreView(state: { rotation?: number; spread?: boolean } | null | undefined): void {
    const deg = Number(state?.rotation) || 0;
    if (deg) this.setRotation(deg);
    if (state?.spread) this.setSpread(true);
  }

  get rotationDeg(): number {
    return this.rotation;
  }

  zoomIn(): void {
    /* 手动缩放之后就不再跟着窗口宽度走，否则每次重排都会被拉回适配比例 */
    this.fitMode = 'none';
    this.applyScale(clamp(this.scale * 1.2, 0.2, 8), false);
  }

  zoomOut(): void {
    this.fitMode = 'none';
    this.applyScale(clamp(this.scale / 1.2, 0.2, 8), false);
  }

  applyPrefs(): void {
    /* PDF 没有字体/行距可调；排版 prefs 不影响它，保留这个方法是为了接口对齐 */
  }

  refreshTheme(): void {
    /* 颜色全走 CSS 变量，主题切换不需要重算 */
  }

  /**
   * 右下角浮条：PDF 必须有「放大看细节」的入口，否则小字页看不清。
   *
   * 2026-11-10 重做：原来这里还挂着「宽 / 页」两颗独立按钮，和头栏「排版」
   * 面板里的旋转 / 单双页分成两个角落，同一件版面的事要往两处找。现在
   * 浮条只留「放大看细节 + 跳页」，缩放档全在面板第一行；外观与壳层浮层
   * 同一套（发丝边 + 卡片圆角）。控件清单见 `panel.ts` 的 PDF_BAR_ITEMS。
   */
  private mountToolbar(): void {
    const bar = createDiv();
    bar.className = 'bzr-pdf-toolbar';
    /* 缩放三颗并成一组：宿主默认的方按钮之间没有分组，三个一簇才看得懂 */
    const zoomBox = createDiv();
    zoomBox.className = 'bzr-pdf-zoomgrp';
    bar.appendChild(zoomBox);
    const add = (label: string, title: string, run: () => void): HTMLButtonElement => {
      const btn = createEl('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        run();
      });
      zoomBox.appendChild(btn);
      return btn;
    };
    /* 右边那几样（缩略图 / 复制 / 回到上一处 / 导出页图）在头栏图标里：
       十三个控件挤在右下角时，手机上横向滚动永远划不到最后几颗。 */
    for (const item of PDF_BAR_ITEMS) {
      switch (item) {
        case 'out':
          add('−', t('pdf.zoom.out'), () => this.zoomOut());
          break;
        case 'zoom':
          this.zoomLabelEl = add('100%', t('pdf.zoom.reset'), () => this.setFitMode('width'));
          this.zoomLabelEl.classList.add('bzr-pdf-zoom');
          break;
        case 'in':
          add('＋', t('pdf.zoom.in'), () => this.zoomIn());
          break;
        case 'pageno': {
          /* 页码：滚动到哪一页比百分比准，278 页的书尤其需要 */
          const pageNo = createSpan();
          pageNo.className = 'bzr-pdf-pageno';
          bar.appendChild(pageNo);
          this.pageLabelEl = pageNo;
          break;
        }
        case 'range': {
          /* 可拖的页码滑块。278 页的书先拖到大概位置再微调，比滚轮快得多 */
          const range = createEl('input');
          range.type = 'range';
          range.className = 'bzr-pdf-range';
          range.min = '1';
          range.max = String(this.numPages);
          range.step = '1';
          range.value = '1';
          range.setAttribute('aria-label', t('pdf.zoom.jump'));
          range.addEventListener('input', () => {
            this.syncRangeFill();
            this.goToPage(Number(range.value), false);
          });
          /* 拖滑块不该顺带触发「点一下翻页」 */
          range.addEventListener('click', (ev) => ev.stopPropagation());
          bar.appendChild(range);
          this.progressEl = range;
          break;
        }
      }
    }
    this.toolbarEl = bar;
    this.root.appendChild(bar);
    this.updateZoomLabel();
    this.updatePageLabel();
    this.syncRangeFill();
  }

  /** 导出当前页：渲染和落盘都交给宿主（它才知道库里的路径规则） */
  async exportCurrentPage(): Promise<void> {
    const run = this.opts.onExportPage;
    if (!run) return;
    const page = this.current;
    this.root.classList.add('is-exporting');
    try {
      await run(page);
    } finally {
      this.root.classList.remove('is-exporting');
    }
  }

  private updatePageLabel(): void {
    if (!this.pageLabelEl) return;
    /* 双页并排时一行两页，页码要报「4–5」而不是 4：只报一个数字，
       用户会以为右页没跳过来 */
    this.pageLabelEl.textContent = pageLabelText(this.current, this.numPages, this.spread, this.pageLabels);
    this.progressEl?.setAttribute('max', String(Math.max(1, this.numPages)));
    if (this.progressEl) this.progressEl.value = String(this.current);
    this.syncRangeFill();
    this.thumbs?.setCurrent(this.current);
  }

  /**
   * 滑块上「已经走过的部分」涂成铜色。
   *
   * 轨道是 16px 高的透明框、线画在正中（见 styles.css），填充只能由 JS 写进
   * `--fill`——纯 CSS 算不出当前值的位置。两端的圆点半径也要让出来，否则
   * 1% 和 99% 看着都像没填满 / 已经填满。
   */
  private syncRangeFill(): void {
    const range = this.progressEl;
    if (!range) return;
    const min = Number(range.min) || 1;
    const max = Number(range.max) || 1;
    const value = Number(range.value) || min;
    const ratio = max > min ? (value - min) / (max - min) : 0;
    range.style.setProperty('--fill', `${Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 10}%`);
  }

  /** 书的页码标签（`/PageLabels`）。null = 没有，页脚保持物理页号 */
  setPageLabels(labels: readonly string[] | null | undefined): void {
    this.pageLabels = labels?.length ? [...labels] : null;
    this.updatePageLabel();
  }

  /* ── 搜索命中 ── */

  /**
   * 搜索词落到页面上。
   *
   * 搜索面板只告诉用户「在第几页」；跳过去之后整页字，还得自己找那一个词。
   * 这里按文字层里的字符区间反推矩形，和划线用同一套坐标（滚动缩放都不用重算）。
   * 传空串 = 清掉。
   *
   * `focus` 是「点中的那一处」（文字层字符区间）：同一页有好几处时，
   * 先把它标成第一处，用户一眼能看出自己点的是哪一条。
   */
  setSearchQuery(
    query: string | null | undefined,
    focus: { page: number; start: number; end: number } | null = null,
  ): void {
    const next = String(query ?? '').trim();
    const nextFocus =
      next && focus && focus.end > focus.start
        ? { page: focus.page, start: focus.start, end: focus.end }
        : null;
    const sameFocus =
      nextFocus?.page === this.searchFocus?.page &&
      nextFocus?.start === this.searchFocus?.start &&
      nextFocus?.end === this.searchFocus?.end;
    if (next === this.searchQuery && sameFocus) return;
    this.searchQuery = next;
    this.searchFocus = nextFocus;
    for (const page of this.rendered) this.paintSearch(page);
  }

  clearSearchHighlight(): void {
    this.setSearchQuery('');
  }

  private paintSearch(page: number): void {
    const el = this.pageEls[page - 1];
    if (!el) return;
    el.querySelectorAll('.bzr-pdf-searchhit').forEach((node) => node.remove());
    const query = this.searchQuery;
    if (!query) return;
    const layer = el.querySelector<HTMLElement>('.textLayer');
    if (!layer) return;
    const text = layer.textContent ?? '';
    if (!text) return;
    const ranges = rangesInText(text, query, 40);
    if (!ranges.length) return;
    const focus = this.searchFocus?.page === page ? this.searchFocus : null;
    const pieces: Array<{ rects: NormRect[]; first: boolean }> = [];
    if (focus) {
      const rects = this.rectsOfOffset(layer, focus.start, focus.end);
      if (rects?.length) pieces.push({ rects, first: true });
    }
    ranges.forEach((range, index) => {
      if (focus && range.start === focus.start && range.end === focus.end) return;
      const rects = this.rectsOfOffset(layer, range.start, range.end);
      if (rects?.length) pieces.push({ rects, first: !focus && index === 0 });
    });
    for (const piece of pieces) {
      /* 第一处给重一点的颜色：一眼能看出「跳过来落在哪」 */
      for (const rect of mergeRects(piece.rects)) {
        const mark = createDiv();
        mark.className = `bzr-pdf-searchhit${piece.first ? ' is-first' : ''}`;
        mark.style.left = `${rect.left * 100}%`;
        mark.style.top = `${rect.top * 100}%`;
        mark.style.width = `${rect.width * 100}%`;
        mark.style.height = `${rect.height * 100}%`;
        el.appendChild(mark);
      }
    }
  }

  /* ── 跳转历史 ── */

  /** 记下当前位置（只在「用链接 / 目录跳走」之前记，滚动与翻页不算） */
  private recordHistory(): void {
    const el = this.pageEls[this.current - 1];
    const top = el
      ? clamp((this.scroller.scrollTop - el.offsetTop + PAGE_GAP) / Math.max(1, el.offsetHeight), 0, 1)
      : 0;
    const last = this.history[this.history.length - 1];
    if (last && last.page === this.current && Math.abs(last.top - top) < 0.02) return;
    this.history.push({ page: this.current, top });
    if (this.history.length > 50) this.history.shift();
    this.opts.onHistoryChange?.(this.history.length);
  }

  /** 有没有可以退回的位置（头栏那颗图标据此决定亮不亮） */
  get canBack(): boolean {
    return this.history.length > 0;
  }

  /** 回到跳转之前的位置；没有历史返回 false */
  back(): boolean {
    const entry = this.history.pop();
    this.opts.onHistoryChange?.(this.history.length);
    if (!entry) return false;
    this.goToPage(entry.page, true, entry.top);
    return true;
  }


  /**
   * 当前视图：页内位置 + 缩放。「复制当前视图链接」用它，
   * 下次点回来能停在同一段字上，而不是只到那一页的页首。
   */
  currentViewOffset(): { left: number; top: number; zoom: number } {
    const el = this.pageEls[this.current - 1];
    const top = el
      ? clamp((this.scroller.scrollTop - el.offsetTop + PAGE_GAP) / Math.max(1, el.offsetHeight), 0, 1)
      : 0;
    return {
      left: 0,
      top: Math.round(top * 1000) / 1000,
      zoom: Math.round(this.scale * 100) / 100,
    };
  }

  /* ── 复制菜单 ── */

  /**
   * 复制菜单。
   *
   * `anchor` 是触发它的那颗按钮（头栏图标）的位置：给了就贴着按钮下沿摆，
   * 不给（老入口）仍然贴在工具条上沿。
   */
  toggleCopyMenu(anchor?: { right: number; bottom: number } | null): void {
    if (this.copyMenuEl) {
      this.closeCopyMenu();
      return;
    }
    const menu = createDiv();
    menu.className = 'bzr-pdf-menu';
    menu.setAttribute('role', 'menu');
    const items: Array<[PdfCopyKind, string]> = [
      ['page', t('pdf.copy.page')],
      ['view', t('pdf.copy.view')],
      ['embed', t('pdf.copy.embed')],
      ['marks', t('pdf.copy.marks')],
    ];
    for (const [kind, label] of items) {
      const item = createEl('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.dataset.kind = kind;
      item.textContent = label;
      item.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.closeCopyMenu();
        this.opts.onCopy?.(kind);
      });
      menu.appendChild(item);
    }
    this.root.appendChild(menu);
    this.copyMenuEl = menu;
    /* 菜单贴着工具栏的上沿：窄栏 / 手机上工具栏会换行成两排，写死的
       `bottom: 52px` 会把第二排按钮压住，菜单项和按钮叠在一起。 */
    const rootBox = this.root.getBoundingClientRect();
    if (anchor) {
      menu.style.top = `${Math.round(anchor.bottom - rootBox.top + 6)}px`;
      menu.style.right = `${Math.max(8, Math.round(rootBox.right - anchor.right))}px`;
      menu.setCssProps({ bottom: 'auto' });
    } else {
      const bar = this.toolbarEl?.getBoundingClientRect();
      if (bar && bar.height > 0) menu.setCssProps({ bottom: `${Math.round(rootBox.bottom - bar.top + 6)}px` });
    }
  }

  private closeCopyMenu(): void {
    this.copyMenuEl?.remove();
    this.copyMenuEl = null;
  }

  /* ── 排版面板（缩放 / 旋转 / 单双页 / 翻页） ──
   * PDF 的「排版」不是字号行距（那些来自原文件），而是这一套版面参数。
   * 外观与 EPUB 的排版浮层一致：贴着头栏按钮下沿的一张小卡，改一项立刻生效，
   * 点外面或再点一次头栏图标收起。 */
  private layoutEl: HTMLDivElement | null = null;
  /** 打开时按钮的视口矩形：窗口一变就按它重新摆位（老坐标会错位） */
  private layoutAnchor: { left: number; top: number; width: number; height: number } | null = null;

  /**
   * @param anchor 触发按钮的视口矩形。没有（命令面板 / 快捷键 / ⋮ 菜单）时
   *   退回 CSS 的右上角固定位——硬算一个旧坐标比不贴更糟。
   */
  toggleLayoutPanel(anchor?: { left: number; top: number; width: number; height: number } | null): void {
    if (this.layoutEl) {
      this.closeLayoutPanel();
      return;
    }
    const panel = createDiv();
    panel.className = 'bzr-pdf-layout bzs-float is-corner no-head';
    /* 卡片里的点击不能漏到正文（正文的 click 会关掉复制菜单、点批注等） */
    panel.addEventListener('click', (ev) => ev.stopPropagation());
    this.root.appendChild(panel);
    this.layoutEl = panel;
    this.layoutAnchor = anchor ?? null;
    this.renderLayoutPanel();
    this.placeLayoutPanel();
    const off = (ev: PointerEvent): void => {
      if (panel.contains(ev.target as Node)) return;
      this.closeLayoutPanel();
    };
    this.layoutOff = off;
    /* 捕获阶段：免得被正文的 pointerdown 先吃掉 */
    window.setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }

  private layoutOff: ((ev: PointerEvent) => void) | null = null;

  closeLayoutPanel(): void {
    if (this.layoutOff) document.removeEventListener('pointerdown', this.layoutOff, true);
    this.layoutOff = null;
    this.layoutEl?.remove();
    this.layoutEl = null;
    this.layoutAnchor = null;
  }

  get layoutOpen(): boolean {
    return this.layoutEl !== null;
  }

  /**
   * 面板贴着按钮：右缘对齐按钮右缘、顶边在按钮下方 8px。
   *
   * 坐标是视口坐标，面板挂在 `.bzr-pdf` 里，所以要减去阅读区左上角
   * （换算规则见 `anchoredBelowRightIn`）。为什么不用 `position: fixed`
   * 直接按视口算：Obsidian 的 `.workspace-leaf` 带 `contain: strict`，
   * fixed 的包含块被它劫持，卡片会整体偏移半个屏幕。
   *
   * 换算后顶部常常小于 0（按钮在头栏、阅读区从它下面开始），夹到 8px——
   * 卡片就贴在阅读区上沿，看起来正是「从按钮下面弹出来」。
   */
  private placeLayoutPanel(): void {
    const el = this.layoutEl;
    const anchor = this.layoutAnchor;
    if (!el || !anchor) return;
    const pos = anchoredBelowRightIn(anchor, { width: el.offsetWidth || 320, height: el.offsetHeight || 0 }, this.root.getBoundingClientRect());
    /* right / bottom 必须写掉：窄窗时容器查询会把 is-corner 改成贴底整条 */
    el.setCssProps({ left: `${pos.left}px`, top: `${pos.top}px`, right: 'auto', bottom: 'auto' });
  }

  private renderLayoutPanel(): void {
    const el = this.layoutEl;
    if (!el) return;
    el.textContent = '';
    const body = el.createDiv({ cls: 'bzs-mbody' });
    const grp = body.createDiv({ cls: 'bzs-setgrp flat bzs-typo' });
    const seg = (label: string, opts: Array<{ v: string; text: string; on: boolean }>, run: (v: string) => void): void => {
      const row = grp.createDiv({ cls: 'bzs-setrow' });
      row.createEl('label', { text: label });
      const box = row.createDiv({ cls: 'bzs-seg' });
      for (const opt of opts) {
        const btn = createEl('button');
        btn.type = 'button';
        btn.textContent = opt.text;
        btn.className = opt.on ? 'on' : '';
        btn.dataset.v = opt.v;
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          run(opt.v);
        });
        box.appendChild(btn);
      }
    };
    const deg = this.rotation;
    /* 行序见 panel.ts 的 PDF_LAYOUT_ROWS：缩放从右下角浮条搬来之后排第一行 */
    for (const row of PDF_LAYOUT_ROWS) {
      switch (row) {
        case 'zoom': {
          const fit = this.fitMode;
          seg(
            t('pdf.layout.zoom'),
            PDF_ZOOM_MODES.map((v) => ({
              v,
              text: v === 'width' ? t('pdf.layout.zoomWidth') : v === 'page' ? t('pdf.layout.zoomPage') : t('pdf.layout.zoomActual'),
              /* 「实际大小」和手动缩放都落在 none 上：两者都是「别再替我适配」 */
              on: v === 'actual' ? fit === 'none' : fit === v,
            })),
            (v) => {
              this.setFitMode(v as PdfZoomTarget);
              this.renderLayoutPanel();
            },
          );
          break;
        }
        case 'rotate':
          seg(
            t('pdf.layout.rotate'),
            [0, 90, 180, 270].map((v) => ({ v: String(v), text: `${v}°`, on: deg === v })),
            (v) => {
              this.setRotation(Number(v));
              this.renderLayoutPanel();
            },
          );
          break;
        case 'pages':
          seg(
            t('pdf.layout.pages'),
            [
              { v: 'single', text: t('pdf.layout.single'), on: !this.spread },
              { v: 'spread', text: t('pdf.layout.spread'), on: this.spread },
            ],
            (v) => {
              this.setSpread(v === 'spread');
              this.renderLayoutPanel();
            },
          );
          break;
        case 'flow':
          seg(
            t('pdf.layout.flow'),
            [
              { v: 'paged', text: t('pdf.layout.paged'), on: this.paged },
              { v: 'scroll', text: t('pdf.layout.scroll'), on: !this.paged },
            ],
            (v) => {
              const on = v === 'paged';
              this.setPaged(on);
              /* 翻页/滚动是 PDF 自己的偏好（prefs.pdfFlow），交给宿主落盘 */
              this.opts.onFlowChange?.(on ? 'paged' : 'scroll');
              this.renderLayoutPanel();
            },
          );
          break;
      }
    }
  }

  /* ── PDF 自带标注 ── */

  /**
   * 文件里本来就有的标注（在别的软件里画的）。
   *
   * 和自家的划线分两层画：这一层是淡色、带类型（下划线只画线），点开能看批注
   * 正文。缓存按「页 + 旋转角」——转 90 度之后矩形全变了，旧缓存不能再用。
   */
  private async paintFileAnnots(page: number): Promise<void> {
    const el = this.pageEls[page - 1];
    if (!el) return;
    /* 设置里关掉「显示文件自带批注」：连解析都省了，也别留旧的一层 */
    if (!this.pref().annots) {
      el.querySelectorAll('.bzr-pdf-fileannot').forEach((node) => node.remove());
      return;
    }
    const key = `${page}@${this.rotation}`;
    let list = this.fileAnnots.get(key);
    if (!list) {
      list = await this.doc.getFileAnnots(page, this.rotation).catch(() => []);
      if (this.destroyed) return;
      this.fileAnnots.set(key, list);
    }
    if (!el.isConnected || !list.length) return;
    el.querySelectorAll('.bzr-pdf-fileannot').forEach((node) => node.remove());
    list.forEach((annot, index) => {
      for (const rect of mergeRects(annot.rects)) {
        const mark = createDiv();
        mark.className = `bzr-pdf-fileannot is-${annot.kind}${annot.contents ? ' has-note' : ''}`;
        mark.dataset.annot = String(index);
        mark.style.left = `${rect.left * 100}%`;
        mark.style.top = `${rect.top * 100}%`;
        mark.style.width = `${rect.width * 100}%`;
        mark.style.height = `${rect.height * 100}%`;
        if (annot.color) mark.style.setProperty('--bzr-fa-color', annot.color);
        if (annot.contents) mark.title = annot.contents.slice(0, 300);
        el.appendChild(mark);
      }
    });
  }

  /* ── 悬停：页内链接预览 / 反链提示 ── */

  /** 鼠标落在链接热区或反链框上：一个出目标页缩略图，一个出引用来源 */
  private onHoverIn = (ev: MouseEvent): void => {
    if (this.destroyed) return;
    if (this.tipOutTimer !== null) {
      window.clearTimeout(this.tipOutTimer);
      this.tipOutTimer = null;
    }
    const target = ev.target as HTMLElement | null;
    const hot = target?.closest('.bzr-pdf-linkhot') as HTMLElement | null;
    if (hot) {
      const page = Number(hot.dataset.target) || 0;
      if (page) this.showLinkPreview(hot, page);
      return;
    }
    const pageEl = target?.closest('.bzr-pdf-page') as HTMLElement | null;
    if (!pageEl) return;
    /* 先看一眼这页有没有可悬停的东西。mouseover 在文字层上按 span 连发，
       每次都去量一遍矩形（强制重排）会拖慢划词——没有标注的页直接返回。 */
    if (!pageEl.querySelector('.bzr-pdf-fileannot, .bzr-pdf-backlink')) return;
    /* 文件批注优先：它比反链框更具体，而且只有它带正文可看 */
    const annot = this.fileAnnotAt(pageEl, ev.clientX, ev.clientY);
    if (annot) {
      this.showAnnotTip(pageEl, annot);
      return;
    }
    const hit = this.backlinkAt(pageEl, ev.clientX, ev.clientY);
    if (hit) this.showBacklinkTip(pageEl, hit);
  };

  private onHoverOut = (ev: MouseEvent): void => {
    const target = ev.target as HTMLElement | null;
    if (target?.closest('.bzr-pdf-linkhot')) this.hideLinkPreview();
    if (!target?.closest('.bzr-pdf-page')) {
      this.hideBacklinkTip();
      return;
    }
    /* 页内跨 span 也会发 mouseout：立刻收掉再重建，提示会一闪一闪。
       延后一点点，真离开这一页（或停下来没再进来）才收。 */
    if (this.tipOutTimer !== null) window.clearTimeout(this.tipOutTimer);
    this.tipOutTimer = window.setTimeout(() => {
      this.tipOutTimer = null;
      this.hideBacklinkTip();
    }, 120);
  };

  /** 点在哪一条反链框上（框本身不吃指针事件，靠坐标反查，才不挡划词） */
  private backlinkAt(pageEl: HTMLElement, x: number, y: number): HTMLElement | null {
    const marks = pageEl.querySelectorAll<HTMLElement>('.bzr-pdf-backlink');
    for (const mark of Array.from(marks)) {
      const box = mark.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return mark;
    }
    return null;
  }

  /**
   * 点在哪一条文件批注上。
   *
   * 和反链一样不吃指针事件，否则页面上每一块彩色都会变成一个「划不动的
   * 死区」。重叠时取面积最小的：整页方框套着三行高亮时，用户要的显然是
   * 那三行。
   */
  private fileAnnotAt(pageEl: HTMLElement, x: number, y: number): HTMLElement | null {
    const marks = pageEl.querySelectorAll<HTMLElement>('.bzr-pdf-fileannot');
    let best: HTMLElement | null = null;
    let bestArea = Infinity;
    for (const mark of Array.from(marks)) {
      const box = mark.getBoundingClientRect();
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
      const area = box.width * box.height;
      if (area < bestArea) {
        bestArea = area;
        best = mark;
      }
    }
    return best;
  }

  private showLinkPreview(hot: HTMLElement, page: number): void {
    this.hideLinkPreview();
    this.linkPreviewTimer = window.setTimeout(() => {
      this.linkPreviewTimer = null;
      if (this.destroyed || !hot.isConnected) return;
      const el = createDiv();
      el.className = 'bzr-pdf-linkprev is-empty';
      const cap = createSpan();
      cap.className = 'cap';
      cap.textContent = t('pdf.preview.page', { n: page });
      const body = createDiv();
      body.className = 'body';
      el.append(cap, body);
      this.root.appendChild(el);
      this.linkPreviewEl = el;
      this.placeNear(el, hot);
      void this.doc.renderThumb(page, 220).then((blob) => {
        if (!blob || this.linkPreviewEl !== el) return;
        const url = URL.createObjectURL(blob);
        this.linkPreviewUrl = url;
        const img = createEl('img');
        img.src = url;
        img.alt = '';
        body.replaceChildren(img);
        el.classList.remove('is-empty');
      });
    }, 220);
  }

  private hideLinkPreview(): void {
    if (this.linkPreviewTimer !== null) {
      window.clearTimeout(this.linkPreviewTimer);
      this.linkPreviewTimer = null;
    }
    this.linkPreviewEl?.remove();
    this.linkPreviewEl = null;
    if (this.linkPreviewUrl) {
      URL.revokeObjectURL(this.linkPreviewUrl);
      this.linkPreviewUrl = null;
    }
  }

  /** 摆到热区上方；上面放不下就翻到下方，再夹进窗口 */
  private placeNear(el: HTMLElement, anchor: HTMLElement): void {
    const box = anchor.getBoundingClientRect();
    const rootBox = this.root.getBoundingClientRect();
    el.style.left = `${clamp(box.left - rootBox.left, 4, Math.max(4, rootBox.width - 230))}px`;
    el.style.top = `${Math.max(4, box.top - rootBox.top - 170)}px`;
    const rect = el.getBoundingClientRect();
    if (rect.top < 4) {
      el.style.top = `${box.bottom - rootBox.top + 6}px`;
    }
  }

  private showBacklinkTip(pageEl: HTMLElement, mark: HTMLElement): void {
    const source = mark.dataset.source ?? '';
    if (this.blTipEl && this.blTipEl.dataset.source === source) return;
    this.hideBacklinkTip();
    const el = createDiv();
    el.className = 'bzr-pdf-btip';
    el.dataset.source = source;
    const name = createSpan();
    name.className = 'nm';
    const base = source.split('/').pop()?.replace(/\.md$/i, '') ?? source;
    name.textContent = t('pdf.backlink.citedBy', { name: base });
    el.appendChild(name);
    const label = mark.dataset.label ?? '';
    if (label) {
      const quote = createSpan();
      quote.className = 'qt';
      quote.textContent = label;
      el.appendChild(quote);
    }
    this.placeTip(pageEl, el, mark);
  }

  /**
   * 悬停 PDF 自带批注：把批注正文浮在框上方。
   *
   * 框不吃指针事件，所以 DOM 的 `title` 永远不会弹——正文只能自己画。
   */
  private showAnnotTip(pageEl: HTMLElement, mark: HTMLElement): void {
    const page = Number(pageEl.dataset.page) || 0;
    const list = page ? this.fileAnnots.get(`${page}@${this.rotation}`) : null;
    const annot = list?.[Number(mark.dataset.annot)];
    if (!annot?.contents) return;
    const key = `annot:${page}:${mark.dataset.annot}`;
    if (this.blTipEl?.dataset.source === key) return;
    this.hideBacklinkTip();
    const el = createDiv();
    el.className = 'bzr-pdf-btip is-note';
    el.dataset.source = key;
    const name = createSpan();
    name.className = 'nm';
    name.textContent = annot.author
      ? t('pdf.fileannot.by', { name: annot.author })
      : t('pdf.fileannot.note');
    const quote = createSpan();
    quote.className = 'qt';
    quote.textContent = annot.contents;
    el.append(name, quote);
    this.placeTip(pageEl, el, mark);
  }

  /** 把提示框摆到框上方；上面放不下就贴下方，左右夹进页面内 */
  private placeTip(pageEl: HTMLElement, el: HTMLDivElement, mark: HTMLElement): void {
    pageEl.appendChild(el);
    this.blTipEl = el;
    const pageBox = pageEl.getBoundingClientRect();
    const box = mark.getBoundingClientRect();
    el.style.left = `${clamp(box.left - pageBox.left, 2, Math.max(2, pageBox.width - 180))}px`;
    el.style.top = `${Math.max(2, box.top - pageBox.top - el.offsetHeight - 6)}px`;
  }

  private hideBacklinkTip(): void {
    this.blTipEl?.remove();
    this.blTipEl = null;
  }

  private updateZoomLabel(): void {
    if (!this.zoomLabelEl) return;
    this.zoomLabelEl.textContent = `${Math.round(this.scale * 100)}%`;
  }

  setViewportWidth(width: number): void {
    if (width <= 0 || Math.abs(width - this.lastWidth) < 2) return;
    this.lastWidth = width;
    if (this.fitMode !== 'none') this.applyScale(this.fitScale(this.fitMode), true);
  }

  currentText(): string {
    const text = this.doc.cachedText(this.current);
    if (!text) void this.doc.getText(this.current).catch(() => undefined);
    return text;
  }

  async pageText(page: number): Promise<string> {
    return this.doc.getText(page);
  }

  setAnnotations(list: ReadonlyArray<{ cfiRange: string; color?: string; text?: string }>): void {
    this.annots.clear();
    for (const item of list) {
      const locator = String(item?.cfiRange ?? '');
      const target = parsePdfLocator(locator);
      if (!target) continue;
      this.annots.set(locator, {
        color: item.color || 'var(--bzr-hl-amber, #f2c14e)',
        page: target.page,
        quote: item.text ?? '',
        /* 框选标注自带矩形，不用再从文字层里搜原文（扫描页也没有原文可搜） */
        rects: target.rect ? [target.rect] : undefined,
      });
    }
    for (const page of this.rendered) this.paintAnnotations(page);
  }

  async pulseAt(locator: string): Promise<void> {
    const target = parsePdfLocator(locator);
    if (!target) return;
    this.recordHistory();
    this.goToPage(target.page);
    const el = this.pageEls[target.page - 1];
    if (!el) return;
    const old = el.querySelector('.bzr-pdf-pulse');
    old?.remove();
    const mark = createDiv();
    mark.className = 'bzr-pdf-pulse';
    el.appendChild(mark);
    if (this.pulseTimer !== null) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => {
      mark.remove();
      this.pulseTimer = null;
    }, 1000);
  }

  clearSelection(): void {
    const sel = document.getSelection();
    if (sel && this.layerOf(sel.anchorNode)) sel.removeAllRanges();
    this.clearFrame();
    this.clearLiveSelection();
    this.opts.onSelect?.(null);
  }

  destroy(): void {
    this.closeLayoutPanel();
    if (this.destroyed) return;
    this.destroyed = true;
    this.thumbs?.close();
    this.thumbs = null;
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    document.removeEventListener('selectionchange', this.onSelectionChange);
    this.scroller.removeEventListener('pointerdown', this.onFrameDown);
    document.removeEventListener('pointermove', this.onFrameMove);
    document.removeEventListener('pointerup', this.onFrameUp);
    this.scroller.removeEventListener('touchstart', this.onTouchStart);
    this.scroller.removeEventListener('touchmove', this.onTouchMove);
    this.scroller.removeEventListener('touchend', this.onTouchEnd);
    this.scroller.removeEventListener('touchcancel', this.onTouchCancel);
    this.twoFinger = null;
    this.clearFrame();
    this.clearLiveSelection();
    this.hideLinkPreview();
    this.hideBacklinkTip();
    this.closeCopyMenu();
    this.root.removeEventListener('mouseover', this.onHoverIn);
    this.root.removeEventListener('mouseout', this.onHoverOut);
    this.fileAnnots.clear();
    if (this.relocateTimer !== null) window.clearTimeout(this.relocateTimer);
    if (this.selectionTimer !== null) window.clearTimeout(this.selectionTimer);
    if (this.scrollSettle !== null) window.clearTimeout(this.scrollSettle);
    if (this.pulseTimer !== null) window.clearTimeout(this.pulseTimer);
    if (this.tipOutTimer !== null) {
      window.clearTimeout(this.tipOutTimer);
      this.tipOutTimer = null;
    }
    for (const task of this.tasks.values()) {
      try {
        task.cancel();
      } catch {
        /* 已完成的任务取消会抛，忽略 */
      }
    }
    this.tasks.clear();
    this.queue.length = 0;
    this.root.remove();
    this.pageEls = [];
  }

  /* ── 建骨架 ── */

  private fitScale(mode: 'width' | 'page'): number {
    /* 必须用 root 的宽度：绝对定位后它就是阅读区的宽度。用 scroller 的话，
       放大后又会被页面内容反向影响（scroller 是页面容器）。 */
    const rootWidth = this.root.clientWidth;
    const width = rootWidth > 0 ? rootWidth : this.scroller.clientWidth || 600;
    /* 双页：一屏放两页，可用宽度要减半（间距由 column-gap 让出来） */
    const availWidth = this.spread ? (width - PAGE_GAP) / 2 : width;
    const height = this.scroller.clientHeight || this.root.clientHeight || 800;
    /* 基准是整本最宽最高的页，不是第 1 页：封面比正文窄时，按封面算出来的
       比例会把正文页放大到撑破阅读区（真机上就是「页面溢出」） */
    return fitScaleFor(mode, this.fitSize, { width: availWidth, height }, SIDE_PAD);
  }

  private pageSize(page: number): PdfPageSize {
    const raw = this.sizes[page - 1] ?? this.sizes[0] ?? { width: 600, height: 800 };
    /* 90/270 度旋转后宽高互换；页面 shell 与适配基准都要用旋转后的尺寸 */
    return boxSizeFor(raw, this.rotation);
  }

  /** 适配基准要跟着旋转走，否则转 90 度后「适合宽度」会按旧宽度算 */
  private computeFitSize(): void {
    const turned = this.rotation % 180 === 90;
    this.fitSize = pickFitSize(
      this.sizes.map((size) => (turned ? { width: size.height, height: size.width } : size)),
    );
  }

  private buildShells(): void {
    this.pagesBox.empty();
    this.pageEls = [];
    const frag = createFragment();
    for (let page = 1; page <= this.numPages; page += 1) {
      const size = this.pageSize(page);
      const el = createDiv();
      el.className = 'bzr-pdf-page';
      el.dataset.page = String(page);
      el.style.width = `${Math.round(size.width * this.scale)}px`;
      el.style.height = `${Math.round(size.height * this.scale)}px`;
      frag.appendChild(el);
      this.pageEls.push(el);
    }
    this.pagesBox.appendChild(frag);
    this.applyPageGap();
    this.recomputeOffsets();
  }

  private recomputeOffsets(): void {
    this.offsets = this.pageEls.map((el) => el.offsetTop);
  }

  private applyScale(next: number, refit: boolean): void {
    const keep = this.current;
    const anchor = this.pageEls[keep - 1];
    const before = anchor ? this.scroller.scrollTop - anchor.offsetTop : 0;
    this.scale = clamp(next, 0.2, 8);
    this.scaleGen += 1;
    this.clearFrame();
    void refit;
    for (const page of [...this.rendered]) this.release(page);
    this.rendering.clear();
    this.queue.length = 0;
    for (let page = 1; page <= this.numPages; page += 1) {
      const el = this.pageEls[page - 1];
      const size = this.pageSize(page);
      el.style.width = `${Math.round(size.width * this.scale)}px`;
      el.style.height = `${Math.round(size.height * this.scale)}px`;
    }
    this.recomputeOffsets();
    const again = this.pageEls[keep - 1];
    if (again) {
      /* 一屏一页模式下缩放完必须还停在页顶：按「页内偏移」恢复的话，
         放大之后同一比例对应的是另一行字，页首会被顶出屏幕 */
      this.scroller.scrollTop = this.paged
        ? Math.max(0, again.offsetTop - PAGE_GAP)
        : Math.max(0, again.offsetTop + before);
    }
    this.ensureAround(keep, true);
    this.scheduleRelocate(true);
    this.updateZoomLabel();
  }

  /* ── 事件 ── */

  private bindEvents(): void {
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    /* 悬停：页内链接出目标页缩略图，反链框出「引用自哪篇」。 */
    this.root.addEventListener('mouseover', this.onHoverIn);
    this.root.addEventListener('mouseout', this.onHoverOut);

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (page) this.enqueue(page);
        }
      },
      { root: this.scroller, rootMargin: '90% 0px' },
    );
    for (const el of this.pageEls) this.observer.observe(el);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        /* 只记录宽度：用户手动定过比例（none）就别再抢他的缩放 */
        const width = this.root.clientWidth;
        if (width > 0 && Math.abs(width - this.lastWidth) >= 2) {
          this.lastWidth = width;
          if (this.fitMode !== 'none') this.applyScale(this.fitScale(this.fitMode), true);
        }
        /* 排版面板贴着按钮：阅读区尺寸一变（分栏拖动 / 窗口缩放），
           按当初那个按钮重新摆位——绝对坐标不会自己跟着走 */
        if (this.layoutEl) this.placeLayoutPanel();
      });
      this.resizeObserver.observe(this.root);
    }

    /* 选区：selectionchange 在宿主 document 上，和 EPUB 的 iframe 不同 */
    document.addEventListener('selectionchange', this.onSelectionChange);
    this.scroller.addEventListener('pointerup', this.onPointerUp, { passive: true });
    /* 框选：按下在页面上，拖动与松开挂在 document 上——拖出页面边缘也不会断 */
    this.scroller.addEventListener('pointerdown', this.onFrameDown);
    document.addEventListener('pointermove', this.onFrameMove);
    document.addEventListener('pointerup', this.onFrameUp);
    this.scroller.addEventListener('click', this.onClick);
    this.scroller.addEventListener('touchstart', this.onTouchStart, { passive: true });
    /* 移动端两指轻按 = 切沉浸：move 攒位移（防把滚动 / 捏合当轻按），
       end 定案，cancel 收尾。 */
    this.scroller.addEventListener('touchmove', this.onTouchMove, { passive: true });
    this.scroller.addEventListener('touchend', this.onTouchEnd, { passive: true });
    this.scroller.addEventListener('touchcancel', this.onTouchCancel, { passive: true });
  }

  private onScroll(): void {
    if (this.destroyed) return;
    /* 滚动时浮层会僵在原地：预览跟着旧位置跑，看起来像贴错了地方 */
    this.hideLinkPreview();
    this.hideBacklinkTip();
    this.closeCopyMenu();
    this.syncCurrentFromScroll();
    /* scroll-snap 的吸附发生在滚动停下之后：最后一帧的 scrollTop 还停在
       吸附中间，页码会落后一屏（真机上「滚到 4–5，角标还写着 2–3」）。
       收尾再确认一次——这时位置已经稳定。 */
    if (this.scrollSettle !== null) window.clearTimeout(this.scrollSettle);
    this.scrollSettle = window.setTimeout(() => {
      this.scrollSettle = null;
      this.syncCurrentFromScroll();
    }, SCROLL_SETTLE_MS);
  }

  private syncCurrentFromScroll(): void {
    if (this.destroyed) return;
    /* 双页并排时同一行两页 offsetTop 相同，二分只会落到行尾那页：
       pageAtRow 会回溯到行首，页码和翻页才不会错开一页 */
    const page = pageAtRow(this.offsets, this.scroller.scrollTop + this.scroller.clientHeight * 0.4);
    if (page === this.current) return;
    this.current = page;
    this.ensureAround(page, false);
    this.scheduleRelocate();
    this.trim();
    this.updatePageLabel();
  }

  private scheduleRelocate(immediate = false): void {
    if (this.relocateTimer !== null) window.clearTimeout(this.relocateTimer);
    if (immediate) {
      this.emitRelocate();
      return;
    }
    this.relocateTimer = window.setTimeout(() => {
      this.relocateTimer = null;
      this.emitRelocate();
    }, RELOCATE_MS);
  }

  private emitRelocate(): void {
    const total = this.numPages;
    const percent = total <= 1 ? 1 : clamp((this.current - 1) / (total - 1), 0, 1);
    this.updatePageLabel();
    this.opts.onRelocate?.({
      percent,
      cfi: pdfPageLocator(this.current),
      chapterIndex: this.current - 1,
      chapterTitle: `第 ${this.current} 页`,
      chapterHref: pdfPageLocator(this.current),
      sectionCurrent: this.current - 1,
      sectionTotal: total,
      /* PDF 的页就是真页：本章口径与全书口径同一个数字（页码只给 EPUB/TXT 画） */
      pageInChapter: this.current,
      pagesInChapter: total,
      bookPage: this.current,
      bookPages: total,
      remainingSeconds: 0,
    });
  }

  private onSelectionChange = (): void => {
    if (this.destroyed) return;
    /* 先立刻把「自己画的那层」更新掉：原生选区已经不上色，等 160ms 节流
       再画就是「拖着拖着什么都没有」。矩形合并是一行几十个数量级，很快。 */
    this.paintLiveSelection();
    if (this.selectionTimer !== null) window.clearTimeout(this.selectionTimer);
    this.selectionTimer = window.setTimeout(() => {
      this.selectionTimer = null;
      this.emitSelection();
    }, SELECTION_MS);
  };

  /** 选区矩形 → 页面上的平色块。没有可用选区就收掉 */
  private paintLiveSelection(): void {
    if (this.destroyed) {
      this.clearLiveSelection();
      return;
    }
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      this.clearLiveSelection();
      return;
    }
    const range = sel.getRangeAt(0);
    const layer = this.layerOf(range.startContainer);
    /* 跨页选区没有意义（PDF 一页一个文字层），不画 */
    if (!layer || layer !== this.layerOf(range.endContainer)) {
      this.clearLiveSelection();
      return;
    }
    const page = Number(layer.dataset.page);
    if (!page) {
      this.clearLiveSelection();
      return;
    }
    this.paintSelectionLayer(page, this.normRects(range, layer));
  }

  private paintSelectionLayer(page: number, rects: NormRect[]): void {
    const el = this.pageEls[page - 1];
    if (!el || !rects.length) {
      this.clearLiveSelection();
      return;
    }
    let root = this.liveSel?.page === page && this.liveSel.root.isConnected ? this.liveSel.root : null;
    if (!root) {
      this.clearLiveSelection();
      root = createDiv();
      root.className = 'bzr-pdf-selpaint';
      el.appendChild(root);
      this.liveSel = { page, root };
    }
    const merged = mergeRects(rects);
    root.replaceChildren(
      ...merged.map((rect) => {
        const band = createDiv();
        band.className = 'bzr-pdf-selband';
        band.style.left = `${rect.left * 100}%`;
        band.style.top = `${rect.top * 100}%`;
        band.style.width = `${rect.width * 100}%`;
        band.style.height = `${rect.height * 100}%`;
        return band;
      }),
    );
  }

  private clearLiveSelection(): void {
    if (!this.liveSel) return;
    this.liveSel.root.remove();
    this.liveSel = null;
  }

  private onPointerUp = (): void => {
    /* 移动端 selectionchange 有时晚于 pointerup；这里再补一次 */
    window.setTimeout(() => this.emitSelection(), 30);
  };

  private emitSelection(): void {
    if (this.destroyed) return;
    /* 重渲 / 转角度会把页元素整个换掉，自己画的那层要跟着重建 */
    this.paintLiveSelection();
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      /* 框选刚结束时会清一次文字选区，那次 collapsed 不能把框选弹掉的条子收掉 */
      if (this.framing || Date.now() - this.lastRegionAt < 500) return;
      this.opts.onSelect?.(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const startLayer = this.layerOf(range.startContainer);
    const endLayer = this.layerOf(range.endContainer);
    if (!startLayer || startLayer !== endLayer) {
      this.opts.onSelect?.(null);
      return;
    }
    const page = Number(startLayer.dataset.page);
    const text = range.toString();
    if (!page || !text.trim()) {
      this.opts.onSelect?.(null);
      return;
    }
    this.lastSelectionAt = Date.now();
    this.suppressClickUntil = Date.now() + 350;
    const rects = this.normRects(range, startLayer);
    const start = this.offsetInLayer(startLayer, range.startContainer, range.startOffset);
    const end = this.offsetInLayer(startLayer, range.endContainer, range.endOffset);
    const locator = encodePdfLocator(page, start, end);
    if (rects.length) this.selectionRects.set(locator, { rot: this.rotation, rects });
    const bounds = rectOf(range);
    /* PDF++ 的 selection= 用的是「第几个文字块 + 块内第几个字」，
       和我们整层的字符偏移不是一回事；复制链接时两种都要有 */
    const beginRef = this.textDivRef(startLayer, range.startContainer, range.startOffset);
    const endRef = this.textDivRef(startLayer, range.endContainer, range.endOffset);
    const pdfSelection =
      beginRef.index >= 0 && endRef.index >= 0
        ? {
            beginIndex: beginRef.index,
            beginOffset: beginRef.offset,
            endIndex: endRef.index,
            endOffset: endRef.offset,
          }
        : undefined;
    this.opts.onSelect?.({
      text,
      cfiRange: locator,
      chapterIndex: page - 1,
      anchor: bounds,
      bounds,
      pdfSelection,
    });
  }

  /**
   * 节点在文字层里的「文字块下标 + 块内偏移」。
   *
   * pdf.js 的文字层是一串并列的 `<span>`，PDF++（和 Obsidian 原生 PDF 视图）
   * 的 `selection=` 就是按这个顺序数的。拿不到就返回 -1，调用方降级成只有页码。
   */
  private textDivRef(
    layer: HTMLElement,
    container: Node | null,
    offset: number,
  ): { index: number; offset: number } {
    const spans = Array.from(layer.children).filter((node) => node.tagName === 'SPAN');
    const host =
      container?.nodeType === Node.ELEMENT_NODE
        ? (container as Element)
        : (container?.parentElement ?? null);
    const span = (host?.closest('span') as HTMLElement | null) ?? null;
    const index = span ? spans.indexOf(span) : -1;
    if (!span || index < 0) return { index: -1, offset: 0 };
    let before = 0;
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node === container) return { index, offset: before + offset };
      before += node.textContent?.length ?? 0;
    }
    return { index, offset: before };
  }

  /* ── 框选（矩形） ──
   * **文字优先**：有文字层的页，拖动就是浏览器原生划词（和 EPUB 一模一样），
   * 框选退到「按住 Shift 再拖」——真机上默认把拖动判成框选，用户选字时
   * 只会看到一条空矩形，划线工具条永远出不来。
   * 扫描页没有文字可选，拖动直接框选。 */

  private onFrameDown = (ev: PointerEvent): void => {
    if (this.destroyed) return;
    /* 触摸先不做：手指拖动既要滚页又要框选，等长按那套手势接上再放开 */
    if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
    const pageEl = (ev.target as HTMLElement | null)?.closest('.bzr-pdf-page') as HTMLElement | null;
    if (!pageEl) return;
    if (!ev.shiftKey && this.pageHasText(pageEl)) return;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    this.frameStart = {
      pageEl,
      page: Number(pageEl.dataset.page) || 1,
      x: ev.clientX,
      y: ev.clientY,
      /* Shift 拖动 / 无文字页：这两个场景下即使拖出了文字选区也要框选 */
      forced: ev.shiftKey,
    };
  };

  /** 这一页有没有可选文字：有就走划词，没有才让框选接管 */
  private pageHasText(el: HTMLElement): boolean {
    const layer = el.querySelector('.textLayer');
    return !!layer && layer.childElementCount > 0;
  }

  private onFrameMove = (ev: PointerEvent): void => {
    const start = this.frameStart;
    if (!start || this.destroyed) return;
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (!this.framing) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (!start.forced) {
        const sel = document.getSelection();
        if (sel && !sel.isCollapsed) {
          /* 拖出文字选区了：这是划词，不是框选 */
          this.frameStart = null;
          return;
        }
      }
      this.framing = true;
      this.scroller.classList.add('is-framing');
      const box = createDiv();
      box.className = 'bzr-pdf-frame';
      start.pageEl.appendChild(box);
      this.frameBoxEl = box;
      document.getSelection()?.removeAllRanges();
    }
    ev.preventDefault();
    const pageBox = start.pageEl.getBoundingClientRect();
    const left = clamp(Math.min(start.x, ev.clientX) - pageBox.left, 0, pageBox.width);
    const top = clamp(Math.min(start.y, ev.clientY) - pageBox.top, 0, pageBox.height);
    const width = clamp(Math.abs(dx), 0, pageBox.width - left);
    const height = clamp(Math.abs(dy), 0, pageBox.height - top);
    const box = this.frameBoxEl;
    if (box) {
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
    }
  };

  private onFrameUp = (): void => {
    const start = this.frameStart;
    const box = this.frameBoxEl;
    const wasFraming = this.framing;
    this.frameStart = null;
    this.framing = false;
    this.scroller.classList.remove('is-framing');
    if (!start || !wasFraming) {
      box?.remove();
      this.frameBoxEl = null;
      return;
    }
    this.frameBoxEl = null;
    const rect = box?.getBoundingClientRect() ?? null;
    box?.remove();
    if (!rect || rect.width < 8 || rect.height < 8) return;
    const pageBox = start.pageEl.getBoundingClientRect();
    if (pageBox.width <= 0 || pageBox.height <= 0) return;
    const norm = normalizePdfRect({
      left: (rect.left - pageBox.left) / pageBox.width,
      top: (rect.top - pageBox.top) / pageBox.height,
      width: rect.width / pageBox.width,
      height: rect.height / pageBox.height,
    });
    if (norm.width <= 0.001 || norm.height <= 0.001) return;
    this.lastRegionAt = Date.now();
    this.suppressClickUntil = Date.now() + 350;
    /* locator 存「未旋转的页面坐标」：页面转过角度之后，同一个框还应该落在
       原来那行字上，所以这里把屏幕坐标反旋回去 */
    const pageNorm = rotateNormRect(norm, -this.rotation);
    const locator = encodePdfRectLocator(start.page, pageNorm);
    this.selectionRects.set(locator, { rot: this.rotation, rects: [norm] });
    /* PDF++ 的 rect= 用页面坐标（pt），不是比例；这里顺手换算一份 */
    const size = this.pageSize(start.page);
    this.opts.onSelect?.({
      text: '',
      cfiRange: locator,
      chapterIndex: start.page - 1,
      anchor: rectOfBox(rect),
      bounds: rectOfBox(rect),
      region: { page: start.page, ...norm },
      pdfRect: {
        left: norm.left * size.width,
        top: norm.top * size.height,
        width: norm.width * size.width,
        height: norm.height * size.height,
      },
    });
  };

  /** 收掉正在画或已画好的框（缩放、换页、关书都要） */
  private clearFrame(): void {
    this.frameStart = null;
    this.framing = false;
    this.scroller.classList.remove('is-framing');
    this.frameBoxEl?.remove();
    this.frameBoxEl = null;
    this.root.querySelectorAll('.bzr-pdf-frame').forEach((node) => node.remove());
  }

  private layerOf(node: Node | null): HTMLElement | null {
    if (!node) return null;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return (el?.closest('.bzr-pdf-page .textLayer') as HTMLElement | null) ?? null;
  }

  private normRects(range: Range, layer: HTMLElement): NormRect[] {
    /* 归一化的基准必须是**页面元素**，不是文字层：
       旋转 90° 后 pdf.js 给文字层挂的是 CSS transform，它自己的包围盒还是
       未旋转的 595×842，而页面已经变成 842×595——拿文字层的尺寸当分母，
       高亮就会整体错位（真机上就是「转一下，划线横成一条线」）。 */
    const pageEl = layer.closest<HTMLElement>('.bzr-pdf-page');
    const box = (pageEl ?? layer).getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return [];
    /* 竖向要用**文字块自己的盒子**，不能用 Range 的行盒。
       `range.getClientRects()` 返回的是行盒：行盒高度由块级 line-height 撑开，
       而 pdf.js 的 span 是一个词一个绝对定位盒子。实测 9.96px 的字，行盒
       14.4px——高亮条直接按行盒画，就比字高出四成、上下各溢出一截，
       看起来「条子把上下两行都压住了」。横向仍然取 Range 的分段（那是每行的
       真实起止），只把 top/height 换成承载这段字的 span 自己的。 */
    const rows = Array.from(layer.querySelectorAll('span'))
      .map((node) => node.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    return Array.from(range.getClientRects())
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => {
        const mid = (r.top + r.bottom) / 2;
        const host = rows.find((s) => s.top <= mid && s.bottom >= mid && s.right > r.left && s.left < r.right) ?? null;
        const top = host ? host.top : r.top;
        const height = host ? host.height : r.height;
        return {
          left: clamp((r.left - box.left) / box.width, 0, 1),
          top: clamp((top - box.top) / box.height, 0, 1),
          width: clamp(r.width / box.width, 0, 1),
          height: clamp(height / box.height, 0, 1),
        };
      });
  }

  /** 选区边界在整页文字层里的字符偏移（用来区分同页重复文本） */
  private offsetInLayer(layer: HTMLElement, node: Node, offset: number): number {
    let acc = 0;
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let cur = walker.nextNode(); cur; cur = walker.nextNode()) {
      if (cur === node) return acc + offset;
      acc += (cur.textContent ?? '').length;
    }
    return acc + offset;
  }

  private onClick = (ev: MouseEvent): void => {
    const target = ev.target as HTMLElement | null;
    /* 点菜单以外的地方收起「复制」下拉。菜单项自己的 click 已经 stopPropagation */
    if (this.copyMenuEl && !target?.closest('.bzr-pdf-menu, .bzr-pdf-copy')) {
      this.closeCopyMenu();
    }
    /* 划词 / 框选刚结束、或上一处跳转刚处理过：这段窗口里来的点击多半是同一次
       手势的尾巴（长按结尾松手、手指滑了一下），有副作用的动作一律不做——
       否则「选完一个字手一抖」就顺带跳页、弹批注。上面收起下拉照做，那一步
       没有副作用，留着更顺手。 */
    if (Date.now() < this.suppressClickUntil) return;
    /* PDF 文件里自带的批注：点开看正文。
       框本身不吃指针事件（会挡住划词），坐标反查；多个框叠在一起时取
       面积最小的那一处——最具体的那一条才是用户想看的。 */
    const pageEl = target?.closest('.bzr-pdf-page') as HTMLElement | null;
    if (pageEl) {
      const fa = this.fileAnnotAt(pageEl, ev.clientX, ev.clientY);
      if (fa) {
        const page = Number(pageEl.dataset.page) || 0;
        const list = page ? this.fileAnnots.get(`${page}@${this.rotation}`) : null;
        const annot = list?.[Number(fa.dataset.annot)];
        if (annot) {
          this.suppressClickUntil = Date.now() + 350;
          this.opts.onFileAnnotTap?.({
            contents: annot.contents,
            author: annot.author,
            anchor: rectOfBox(fa.getBoundingClientRect()),
          });
          return;
        }
      }
      /* 反链框同样不吃指针事件，点击位置靠坐标反查 */
      const hit = this.backlinkAt(pageEl, ev.clientX, ev.clientY);
      if (hit?.dataset.source) {
        this.suppressClickUntil = Date.now() + 350;
        this.opts.onBacklinkTap?.({ sourcePath: hit.dataset.source, event: ev });
        return;
      }
    }
    const mark = target?.closest('.bzr-pdf-annot-mark') as HTMLElement | null;
    if (mark) {
      const locator = mark.dataset.locator ?? '';
      if (locator) this.opts.onAnnotTap?.({ locator, anchor: rectOfBox(mark.getBoundingClientRect()) });
      return;
    }
    /* 页内超链接（目录页那种）：点了就跳，不参与「上下半区翻页」 */
    const hot = (ev.target as HTMLElement | null)?.closest('.bzr-pdf-linkhot') as HTMLElement | null;
    if (hot) {
      const target = Number(hot.dataset.target);
      if (target > 0) {
        this.suppressClickUntil = Date.now() + 350;
        /* goToPage 自己会触发 relocate，外部的位置记录跟着更新，不用另发回调 */
        this.goToPage(target, true);
      }
      return;
    }
    /* 点正文不翻页。
       EPUB 是「一屏正好一页」，点上下半屏翻页是顺手；PDF 是一叠纸，正文
       中间随时可能落在一页的任意位置，点一下就把整页卷走——用户只想选中
       一个字，结果跑了两页。真正的翻页键是 ← / →（和 ↑ / ↓）与工具条。 */
  };

  /* ── 两指轻按 = 切沉浸 ──
   * 移动端一进沉浸，头栏就被藏掉，双指是唯一出口，所以这里必须「第一根手指
   * 抬起就定案」。早先要求所有手指都抬离才认，可每次抬手都会把计时清掉：
   * 真人两指不可能同时离屏，于是永远不触发（2026-11-10 真机，进了出不来）。
   * 判据本身在 ./two-finger-tap.ts，纯函数，可单测。 */

  private onTouchStart = (ev: TouchEvent): void => {
    /* 单指点按不走这条路（PDF 点正文不翻页）。手指数量一变就重来一轮：
       只有两指落下才起手，其余情况顺手把上一轮的残留清掉。 */
    this.twoFinger = beginTwoFinger(pointsOf(ev.touches), Date.now());
    debugEvent('touch', { phase: 'pdf-start', n: ev.touches.length, armed: !!this.twoFinger });
  };

  private onTouchMove = (ev: TouchEvent): void => {
    if (!this.twoFinger) return;
    this.twoFinger = moveTwoFinger(this.twoFinger, pointsOf(ev.touches));
  };

  private onTouchEnd = (ev: TouchEvent): void => {
    if (!this.twoFinger) return;
    const { fire, state } = endTwoFinger(this.twoFinger, Date.now(), ev.touches.length);
    this.twoFinger = state;
    /* 真机上「按了没反应」只能靠这条日志分清三种情况：事件根本没到（连
       pdf-start 都没有）、到了但判否（fire: false，多半超时或被系统打断）、
       判了却没切沉浸（fire: true）。 */
    debugEvent('touch', { phase: 'pdf-end', n: ev.touches.length, fire });
    if (!fire) return;
    /* 吞掉同一手势末尾可能合成的那次 click：不然两指轻按会顺带点到页内
       链接 / 文件批注（PDF 的 onClick 会跳页、会弹卡）。 */
    this.suppressClickUntil = Date.now() + 500;
    this.opts.onTwoFingerTap?.();
  };

  /** 系统手势 / 来电把触摸序列掐断：这一轮作废，别拖到下一次 */
  private onTouchCancel = (): void => {
    this.twoFinger = null;
  };

  /* ── 渲染队列 ── */

  private ensureAround(page: number, immediate: boolean): void {
    for (let i = page - PRELOAD; i <= page + PRELOAD; i += 1) this.enqueue(i);
    if (immediate) this.pump();
  }

  private enqueue(page: number): void {
    if (page < 1 || page > this.numPages) return;
    if (this.rendered.has(page) || this.rendering.has(page) || this.failed.has(page)) return;
    if (this.queue.includes(page)) return;
    this.queue.push(page);
    this.pump();
  }

  private pump(): void {
    if (this.destroyed || this.active >= MAX_PARALLEL) return;
    while (this.active < MAX_PARALLEL && this.queue.length) {
      const page = this.queue.shift();
      if (page === undefined) break;
      if (this.rendered.has(page)) continue;
      this.rendering.add(page);
      this.active += 1;
      void this.renderPage(page).finally(() => {
        this.active -= 1;
        this.rendering.delete(page);
        this.pump();
      });
    }
  }

  private async renderPage(page: number): Promise<void> {
    const el = this.pageEls[page - 1];
    if (!el || this.destroyed) return;
    /* 缩放/重排会让这一轮作废：旧任务回来时不能再往页里写画布，
       否则用户会看到旧尺寸的图和新的文字层叠在一起。 */
    const gen = this.scaleGen;
    try {
      const size = await this.doc.getPageSize(page);
      if (gen !== this.scaleGen) return;
      /* 页面盒子的宽高必须**每次都写**：只有在「固有尺寸变了」时才写的话，
         换缩放（同一页、固有尺寸不变）这一步会被整段跳过——画布和文字层按
         新比例重绘了，页面元素还是旧尺寸，于是文字层比页面大一圈，所有按
         「页面比例」定位的东西（划线、反链框、搜索命中、页内链接热点）整体
         放大 1.4 倍还往上飘。offset 只在真的变了时才重算，省一次重排。 */
      const sizeChanged = size.width !== this.sizes[page - 1]?.width || size.height !== this.sizes[page - 1]?.height;
      this.sizes[page - 1] = size;
      /* 页框用旋转后的尺寸：画布是按 combined rotation 画的，这里若仍用
         原始宽高（buildShells 已交换过，renderPage 漏了），页面会被裁一块（#2 修复）。
         this.sizes[] 继续存原始值（未经额外旋转交换），交换交给 boxSizeFor。 */
      const box = boxSizeFor(size, this.rotation);
      el.style.width = `${Math.round(box.width * this.scale)}px`;
      el.style.height = `${Math.round(box.height * this.scale)}px`;
      if (sizeChanged) this.recomputeOffsets();
      const canvas = createEl('canvas');
      canvas.className = 'bzr-pdf-canvas';
      const layer = createDiv();
      layer.className = 'textLayer';
      layer.dataset.page = String(page);
      el.replaceChildren(canvas, layer);
      const task = await this.doc.renderPage(
        page,
        canvas,
        this.scale,
        Math.min(2, window.devicePixelRatio || 1),
        this.rotation,
      );
      this.tasks.set(page, task);
      await task.promise;
      this.tasks.delete(page);
      if (this.destroyed || gen !== this.scaleGen || !el.isConnected) {
        try {
          task.cancel();
        } catch {
          /* 已完成 */
        }
        el.replaceChildren();
        return;
      }
      try {
        await this.doc.renderTextLayer(page, layer, this.scale, this.rotation);
      } catch {
        /* 文字层失败仍然能看图，不要把整页判成失败 */
      }
      if (gen !== this.scaleGen) return;
      this.rendered.add(page);
      this.recency.set(page, ++this.recencySeq);
      this.paintAnnotations(page);
      this.paintBacklinks(page);
      this.paintSearch(page);
      void this.paintFileAnnots(page);
      void this.paintLinks(page);
      void this.doc.getText(page).catch(() => undefined);
      this.trim();
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'RenderingCancelledException') return;
      /* 真机白屏时，界面上只有一句「没有完成」；具体原因必须在控制台留一份，
         否则只能靠猜（字体 / 图片解码 / 画布超限各是一类错）。 */
      console.error(`[bz-reader] PDF 第 ${page} 页渲染失败：`, err);
      this.failed.add(page);
      el.classList.add('is-failed');
      el.textContent = '';
      const tip = createDiv();
      tip.className = 'bzr-pdf-page-error';
      /* 把引擎给的原因直接写到页上：真机排查时没人愿意为了看一行报错
         去开控制台，截图就能说明问题。 */
      const reason = (err as Error)?.message || String(err);
      tip.textContent = `第 ${page} 页渲染失败：${reason.slice(0, 160)}`;
      el.appendChild(tip);
      /* 通知也带上原因摘要：错误提示在页面中部时，视口只露上半页会看不到 */
      this.opts.onStall?.(`第 ${page} 页（${reason.slice(0, 80)}）`);
    }
  }

  private release(page: number): void {
    const task = this.tasks.get(page);
    if (task) {
      try {
        task.cancel();
      } catch {
        /* 已完成 */
      }
      this.tasks.delete(page);
    }
    const el = this.pageEls[page - 1];
    if (el) el.replaceChildren();
    this.rendered.delete(page);
    this.recency.delete(page);
  }

  /** 只保留最近用过的几页：滚到 PDF 末尾时前面的 canvas 必须还回去 */
  private trim(): void {
    if (this.rendered.size <= KEEP_ALIVE) return;
    const keep = new Set<number>();
    for (let i = this.current - PRELOAD; i <= this.current + PRELOAD; i += 1) keep.add(i);
    const candidates = [...this.rendered]
      .filter((page) => !keep.has(page))
      .sort((a, b) => (this.recency.get(a) ?? 0) - (this.recency.get(b) ?? 0));
    for (const page of candidates) {
      if (this.rendered.size <= KEEP_ALIVE) break;
      this.release(page);
    }
  }

  /* ── 页内超链接 ── */

  /**
   * PDF 自带的内部链接（目录、交叉引用）→ 透明热区。
   *
   * 扫描件的目录页全是图，没有文字可选，也没有书签大纲；这些链接是唯一
   * 「点目录跳过去」的入口。热区盖在链接原位置上，光标变成手型。
   */
  private async paintLinks(page: number): Promise<void> {
    const el = this.pageEls[page - 1];
    if (!el) return;
    el.querySelectorAll('.bzr-pdf-linkhot').forEach((node) => node.remove());
    const links = await this.doc.getLinks(page, this.rotation).catch(() => []);
    if (this.destroyed || !el.isConnected) return;
    for (const link of links) {
      if (!link.page || link.page === page) continue;
      const hot = createDiv();
      hot.className = 'bzr-pdf-linkhot';
      hot.dataset.target = String(link.page);
      hot.title = `跳到第 ${link.page} 页`;
      hot.style.left = `${link.rect.left * 100}%`;
      hot.style.top = `${link.rect.top * 100}%`;
      hot.style.width = `${link.rect.width * 100}%`;
      hot.style.height = `${link.rect.height * 100}%`;
      el.appendChild(hot);
    }
  }

  /* ── 标注 ── */

  private paintAnnotations(page: number): void {
    const el = this.pageEls[page - 1];
    if (!el) return;
    el.querySelectorAll('.bzr-pdf-annot-mark').forEach((node) => node.remove());
    /* 旋转后为什么要重新算而不是套缓存：
       pdf.js 的文字层是靠 CSS transform 转的，它自己的包围盒还是未旋转尺寸；
       但 `normRects` 的基准取的是**页面元素**（见那里的注释），而
       `getClientRects()` 给的是变换后的屏幕矩形——两者都在同一个旋转坐标系里，
       除出来就是对的。旋转时 `setRotation` 顺手清掉 `selectionRects`，
       逼所有标注重走这条「从 DOM 现算」的路。 */
    const layer = el.querySelector<HTMLElement>('.textLayer');
    for (const [locator, annot] of this.annots) {
      if (annot.page !== page) continue;
      /* 三种来源，优先级按「坐标系是否还成立」排：
         1. 划词缓存 —— 按「当前角度 - 缓存角度」旋转过去，纯数学、最可靠；
         2. 框选 locator（存的是页面坐标比例）—— 按当前角度换算；
         3. 原文片段在文字层里重新搜 —— 文字层已经按当前角度排好。 */
      const cached = this.selectionRects.get(locator);
      let rects: NormRect[] | null = null;
      if (cached?.rects?.length) {
        const delta = (((this.rotation - cached.rot) % 360) + 360) % 360;
        rects = delta === 0 ? cached.rects : cached.rects.map((r) => rotateNormRect(r, delta));
      } else {
        const target = parsePdfLocator(locator);
        if (target?.rect) rects = [rotateNormRect(target.rect, this.rotation)];
      }
      if (!rects?.length && layer) {
        /* 有字符区间就直接按偏移还原：比「按原文片段搜」稳，旋转后也不会错位 */
        const target = parsePdfLocator(locator);
        if (target && target.end > target.start) {
          rects = this.rectsOfOffset(layer, target.start, target.end);
        }
        if (!rects?.length && annot.quote) rects = this.quoteRects(layer, annot.quote);
      }
      if (!rects?.length) continue;
      /* pdf.js 把每个词拆成一个 span，一段话能返回上千个矩形：不合并的话
         一页要塞上千个绝对定位 div，滚动直接掉帧，块与块之间的亚像素缝还
         会在深色底上连成白线（见 rects.ts） */
      for (const rect of mergeRects(rects)) {
        const mark = createDiv();
        mark.className = 'bzr-pdf-annot-mark';
        mark.dataset.locator = locator;
        mark.style.left = `${rect.left * 100}%`;
        mark.style.top = `${rect.top * 100}%`;
        mark.style.width = `${rect.width * 100}%`;
        mark.style.height = `${rect.height * 100}%`;
        mark.style.background = annot.color;
        el.appendChild(mark);
      }
    }
  }

  /* ── 反链高亮 ── */

  /** 笔记里引用了这本书的位置；数据由宿主从 Obsidian 的链接索引里捞出来 */
  setBacklinks(hits: ReadonlyArray<PdfBacklinkHit>): void {
    this.backlinks = [...(hits ?? [])];
    for (const page of this.rendered) this.paintBacklinks(page);
  }

  /** PDF 相关偏好改了就重画那两层（开关关了要立刻消失，不能等翻页） */
  refreshPdfPrefs(): void {
    const want = this.pref();
    for (const page of this.rendered) {
      this.paintBacklinks(page);
      if (want.annots) void this.paintFileAnnots(page);
      else this.pageEls[page - 1]?.querySelectorAll('.bzr-pdf-fileannot').forEach((n) => n.remove());
    }
  }

  /** 现取 PDF 偏好：设置页改完不必重开书 */
  private pref(): PdfViewPrefs {
    return this.opts.pdfPrefs?.() ?? { zoom: 'auto', annots: true, backlinks: false };
  }

  private paintBacklinks(page: number): void {
    const el = this.pageEls[page - 1];
    if (!el) return;
    el.querySelectorAll('.bzr-pdf-backlink, .bzr-pdf-backlink-edge').forEach((node) => node.remove());
    if (!this.backlinks.length || !this.pref().backlinks) return;
    const layer = el.querySelector<HTMLElement>('.textLayer');
    for (const hit of this.backlinks) {
      if (hit.page !== page) continue;
      let rects: NormRect[] | null = null;
      if (hit.rect) {
        /* `rect=` 是 PDF 页面坐标（pt），先归一化再按当前旋转角换算 */
        const size = this.pageSize(page);
        if (size.width > 0 && size.height > 0) {
          rects = [
            rotateNormRect(
              {
                left: clamp(hit.rect.left / size.width, 0, 1),
                top: clamp(hit.rect.top / size.height, 0, 1),
                width: clamp(hit.rect.width / size.width, 0, 1),
                height: clamp(hit.rect.height / size.height, 0, 1),
              },
              this.rotation,
            ),
          ];
        }
      } else if (hit.locator && layer) {
        /* 本插件自己复制的高亮链接只有 `bzr=` 定位串：文字区间按偏移还原，
           框选的矩形直接换算角度——比 PDF++ 的 span 下标稳，也不依赖原文 */
        const target = parsePdfLocator(hit.locator);
        if (target?.rect) rects = [rotateNormRect(target.rect, this.rotation)];
        else if (target && target.end > target.start) {
          rects = this.rectsOfOffset(layer, target.start, target.end);
        }
      } else if (hit.selection && layer) {
        rects = this.rectsOfSelection(layer, hit.selection);
      }
      if (!rects?.length) {
        /* 只有页码：页边画一条竖线，表示「这一页被引用过」 */
        const edge = createDiv();
        edge.className = 'bzr-pdf-backlink-edge';
        edge.dataset.source = hit.sourcePath;
        if (hit.label) edge.dataset.label = hit.label;
        const edgeColor = pdfColorFromName(hit.color);
        if (edgeColor) edge.style.background = colorCss(edgeColor);
        el.appendChild(edge);
        continue;
      }
      for (const rect of mergeRects(rects)) {
        const mark = createDiv();
        mark.className = 'bzr-pdf-backlink';
        mark.dataset.source = hit.sourcePath;
        if (hit.label) mark.dataset.label = hit.label;
        /* 链接里带 &color= 就按那个色画：一眼能分出「这是标红那一条」 */
        const named = pdfColorFromName(hit.color);
        if (named) {
          const css = colorCss(named);
          mark.style.borderColor = css;
          mark.style.background = `color-mix(in srgb, ${css} 12%, transparent)`;
        }
        mark.style.left = `${rect.left * 100}%`;
        mark.style.top = `${rect.top * 100}%`;
        mark.style.width = `${rect.width * 100}%`;
        mark.style.height = `${rect.height * 100}%`;
        el.appendChild(mark);
      }
    }
  }

  /**
   * PDF++ 的 `selection=`（文字块下标 + 块内偏移）→ 页内矩形。
   *
   * 从别的阅读器（Obsidian 原生、PDF++）复制来的链接只有这四个数字，
   * 没有原文片段；要把它画出来只能按文字层的 span 顺序反查。
   */
  private rectsOfSelection(layer: HTMLElement, sel: PdfLinkSelection): NormRect[] | null {
    const spans = Array.from(layer.children).filter((node) => node.tagName === 'SPAN');
    const startSpan = spans[sel.beginIndex];
    const endSpan = spans[sel.endIndex];
    if (!startSpan || !endSpan) return null;
    const start = this.pointInSpan(startSpan, sel.beginOffset);
    const end = this.pointInSpan(endSpan, sel.endOffset);
    if (!start || !end) return null;
    try {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return this.normRects(range, layer);
    } catch {
      return null;
    }
  }

  private pointInSpan(span: Element, offset: number): { node: Text; offset: number } | null {
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const len = node.textContent?.length ?? 0;
      if (offset <= consumed + len) {
        return { node: node as Text, offset: clamp(offset - consumed, 0, len) };
      }
      consumed += len;
    }
    return null;
  }

  /**
   * 按「整层字符偏移」还原选区矩形。
   *
   * 和 quoteRects 相比不依赖原文能否匹配上：同页有重复句子、文字层被拆碎、
   * 页面转过角度，只要 DOM 的文本顺序没变就能算对。偏移来自 locator
   * 的 `pdf/<页>/<起>-<止>`，是我们自己写进去的，比外部文本稳。
   */
  private rectsOfOffset(layer: HTMLElement, start: number, end: number): NormRect[] | null {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
    if (!nodes.length) return null;
    const pick = (offset: number): { node: Text; offset: number } | null => {
      let pos = 0;
      for (const node of nodes) {
        const len = node.textContent?.length ?? 0;
        if (offset >= pos && offset <= pos + len) return { node, offset: offset - pos };
        pos += len;
      }
      return null;
    };
    const a = pick(Math.max(0, Math.floor(start)));
    const b = pick(Math.max(0, Math.floor(end)));
    if (!a || !b) return null;
    try {
      const range = document.createRange();
      range.setStart(a.node, Math.min(a.offset, a.node.textContent?.length ?? 0));
      range.setEnd(b.node, Math.min(b.offset, b.node.textContent?.length ?? 0));
      return this.normRects(range, layer);
    } catch {
      return null;
    }
  }

  /** 用引用文本在文字层里重新找选区；找不到就放弃（页码还在） */
  private quoteRects(layer: HTMLElement, quote: string): NormRect[] | null {
    const nodes: Text[] = [];
    let all = '';
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push(node as Text);
      all += node.textContent ?? '';
    }
    if (!all) return null;
    let at = all.indexOf(quote);
    if (at < 0) at = all.indexOf(quote.slice(0, Math.min(40, quote.length)));
    if (at < 0) return null;
    const endAt = at + quote.length;
    let pos = 0;
    let startNode: Text | null = null;
    let endNode: Text | null = null;
    let startOffset = 0;
    let endOffset = 0;
    for (const node of nodes) {
      const len = node.textContent?.length ?? 0;
      if (!startNode && at >= pos && at < pos + len) {
        startNode = node;
        startOffset = at - pos;
      }
      if (!endNode && endAt > pos && endAt <= pos + len) {
        endNode = node;
        endOffset = endAt - pos;
      }
      pos += len;
    }
    if (!startNode || !endNode) return null;
    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return this.normRects(range, layer);
    } catch {
      return null;
    }
  }

}

function rectOfBox(box: DOMRect): Rect {
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}

function rectOf(range: Range): Rect {
  try {
    return rectOfBox(range.getBoundingClientRect());
  } catch {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
}

/** TouchList → 判定器认的纯数据：node 里没有 TouchList，只留 x/y 两个数 */
function pointsOf(touches: TouchList): FingerPoint[] {
  return Array.from(touches).map((touch) => ({ x: touch.clientX, y: touch.clientY }));
}

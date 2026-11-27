/* ============================================================
 * bz-reader · 漫画视图（engine/manga/view.ts）
 *
 * 不用 iframe、不给 blob: 开帧：图片以 objectURL 挂在**宿主 DOM** 的
 * <img> 上（移动端 CSP 只挡 blob 帧，不挡这种图；见 pdf/canvas-budget）。
 * 一屏 = 一张或两张原图，翻页按屏走；进度/书签锚在原图序号上，
 * 拆页、合页、裁边、分格都不改存档。
 *
 * 尺寸模型（2026-11-22 重做，旧版把整块 film 按 fit 缩放，图片却仍按
 * 容器宽铺满，结果整页只剩四成大小）：
 *  · `base` 由 fitScale 算出「整页刚好装进视口」的比例；
 *  · **cell 的布局尺寸就是图片乘 base 后的像素尺寸**，img 填满 cell；
 *  · film 的 transform 只承担用户缩放（zoom）和平移（pan），不再承担 fit。
 * 这样 fit=smart 时整页正好贴边，zoom=1 是「适配后的 100%」。
 *
 * 三条内存纪律：
 *  1. 只解压眼前这一屏 ±1 屏，滚走就 revokeObjectURL；
 *  2. 分格检测把图画到 100×100 的小画布上取像素，绝不用原尺寸画布
 *     （手机上大画布静默白屏，pdf/document.ts 踩过）；
 *  3. 图片尺寸先按猜测占位，加载完再回填宽高并重新组屏，不预扫整本。
 * ============================================================ */
import {
  buildScreens,
  continuousCellSize,
  cropInsets,
  detectPanels,
  effectiveFit,
  filterCss,
  fitScale,
  mangaLocator,
  panelOrder,
  screenOfPage,
  turnScreen,
  type MangaDirection,
  type MangaFit,
  type MangaPage,
  type MangaScreen,
  type PanelRect,
  type SpreadOptions,
} from './layout';
import {
  MANGA_ASSIST_ITEMS,
  MANGA_FIT_OPTIONS,
  MANGA_FLOW_OPTIONS,
  mangaPanelRows,
  mangaZoomLabel,
} from './panel';
import { imageMime, type MangaSource } from './archive';
import { autoTone, type MangaFlow, type MangaPrefs, type MangaViewState } from './settings';
import { anchoredBelowRightIn } from '../../shell/anchored-style';
import { t, type MsgKey } from '../../i18n';
import { clickTurns, turnReady, wheelPixels, wheelTurn } from './gesture';

export interface MangaViewHooks {
  /** 位置变了：cfi 是 `manga/<原图序号>/<分格序号>` */
  onRelocate(info: {
    percent: number;
    cfi: string;
    page: number;
    total: number;
    screen: number;
    screens: number;
    chapterTitle: string;
    chapterIndex: number;
  }): void;
  /** 视角变了（方向 / 双页 / 模式 / 缩放），按书记住 */
  onViewState(state: MangaViewState): void;
  /** 点按分区翻页（交给宿主统一处理，方向与点击区只在一份规则里） */
  onTurn(dir: 'prev' | 'next'): void;
  onReady(): void;
}

/**
 * 宿主传进来的输入开关。用同一个对象引用：设置面板里切了「点击翻页」，
 * 宿主改一下字段视图立刻生效，不用重建整本书。
 */
export interface MangaInput {
  mobile: boolean;
  desktopTurn: boolean;
}

interface Cell {
  page: number;
  half: 'full' | 'left' | 'right';
  img: HTMLImageElement;
  wrap: HTMLElement;
  url: string;
}

const SAMPLE = 100;
/** 尺寸未知时的占位：常见单页漫画 2:3，够算出一个像样的初值 */
const GUESS_W = 1000;
const GUESS_H = 1500;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;
/** 滚轮翻页与普通书同手感：攒够一格才翻，翻完短暂冷却不连翻 */
const WHEEL_TURN_THRESHOLD = 42;
const WHEEL_COOLDOWN = 300;
/** Ctrl+滚轮攒够这么多像素才缩放一档：触控板捏合是碎步连发 */
const ZOOM_WHEEL_THRESHOLD = 60;
/** 长按多久算「偷看整页」 */
const HOLD_MS = 450;

/**
 * 面板里的档位文案：直接指向语言包的 key。
 *
 * 写成 `Record<MangaFit, MsgKey>` 而不是模板串 + 断言：少一个档位 tsc 就会
 * 报缺 key，不会等到真机上某颗按钮显示成空白。
 */
const FIT_LABEL: Record<MangaFit, MsgKey> = {
  smart: 'settings.manga.fit.smart',
  screen: 'settings.manga.fit.screen',
  width: 'settings.manga.fit.width',
  height: 'settings.manga.fit.height',
  fill: 'settings.manga.fit.fill',
  original: 'settings.manga.fit.original',
};

const FLOW_LABEL: Record<MangaFlow, MsgKey> = {
  paged: 'settings.manga.flow.paged',
  vertical: 'settings.manga.flow.vertical',
  horizontal: 'settings.manga.flow.horizontal',
  webtoon: 'settings.manga.flow.webtoon',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] {
  const node = createEl(tag);
  if (cls) node.className = cls;
  return node;
}

/** 从缩略采样图里算出行/列白度投影；任一步失败都返回 null，退回整页 */
function projections(img: HTMLImageElement): {
  row: number[]; col: number[]; mean: number;
} | null {
  try {
    const cv = el('canvas');
    cv.width = SAMPLE;
    cv.height = SAMPLE;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);
    const row = new Array<number>(SAMPLE).fill(0);
    const col = new Array<number>(SAMPLE).fill(0);
    let sum = 0;
    for (let y = 0; y < SAMPLE; y += 1) {
      for (let x = 0; x < SAMPLE; x += 1) {
        const i = (y * SAMPLE + x) * 4;
        const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
        sum += luma;
        const white = luma > 0.88 ? 1 : 0;
        row[y] += white;
        col[x] += white;
      }
    }
    return {
      row: row.map((n) => n / SAMPLE),
      col: col.map((n) => n / SAMPLE),
      mean: sum / (SAMPLE * SAMPLE),
    };
  } catch {
    return null;
  }
}

export class MangaView {
  readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly film: HTMLElement;
  private readonly thumbs: HTMLElement;
  private readonly panelLayer: HTMLElement;
  private readonly archive: MangaSource;
  private readonly hooks: MangaViewHooks;
  private readonly input: MangaInput;

  private wheelAcc = 0;
  private lastWheelTurnAt = 0;
  private prefs: MangaPrefs;
  private direction: MangaDirection;
  private pages: MangaPage[];
  private screens: MangaScreen[] = [];
  private screen = 0;
  private panel = -1;
  private panelRects: PanelRect[] = [];
  private panelSeq: number[] = [];
  private cells = new Map<number, Cell>();
  /** 本屏全部 cell，按视觉顺序；拆半时同一页会占两格，布局必须按它遍历 */
  private screenCells: Cell[] = [];
  private urls = new Map<number, string>();
  private pan = { x: 0, y: 0 };
  private dragStart: { x: number; y: number; px: number; py: number } | null = null;
  /** 本次手势已经消费（翻页 / 拖动）：随后的合成 click 不再翻页 */
  private suppressClick = false;
  /** 连续排版要等这一轮渲染完再滚：render 刚 replaceChildren，此刻 DOM 还是空的 */
  private pendingScroll = false;
  /** Ctrl+滚轮缩放累计位移：够阈值才走一档，触控板一次捏合不会顶到最大 */
  private zoomAcc = 0;
  /** 长按「看整页」的定时器，destroy 时要清掉 */
  private hold: number | null = null;
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;
  private gammaSvg: SVGSVGElement | null = null;
  /** 当前屏按 fit 算出的基准缩放（zoom=1 即此值） */
  private base = 1;
  /** render 是否在途：图片 load 回来时靠它判断能不能立刻重排 */
  private rendering = false;
  /** 渲染期间收到重排请求：这一轮走完再排，别开出两轮并发 render */
  private rebuildQueued = false;

  constructor(container: HTMLElement, archive: MangaSource, prefs: MangaPrefs, input: MangaInput, hooks: MangaViewHooks) {
    this.archive = archive;
    this.prefs = prefs;
    this.input = input;
    this.hooks = hooks;
    this.direction = prefs.direction === 'ltr' ? 'ltr' : 'rtl';
    this.pages = archive.pages.map((name) => ({ name, width: 0, height: 0 }));

    this.root = el('div', 'bzr-manga');
    this.stage = el('div', 'bzr-manga-stage');
    this.film = el('div', 'bzr-manga-film');
    this.panelLayer = el('div', 'bzr-manga-panels');
    this.thumbs = el('div', 'bzr-manga-thumbs');
    this.stage.append(this.film, this.panelLayer);
    this.root.append(this.stage, this.thumbs);
    container.append(this.root);
    this.installGammaFilter();
    this.bind();
    this.rebuild();
    this.hooks.onReady();
  }

  /* ─────────────── 版面 ─────────────── */

  private spreadOptions(): SpreadOptions {
    return {
      direction: this.direction,
      spread: this.prefs.spread && this.prefs.flow === 'paged',
      splitWide: this.prefs.splitWide && this.prefs.flow === 'paged',
      coverAlone: this.prefs.coverAlone,
      offset: this.prefs.offset,
      wideRatio: 1.4,
      webtoon: this.prefs.flow === 'webtoon',
    };
  }

  private rebuild(keepPage = true): void {
    const anchor = keepPage ? this.currentPage() : 0;
    /* 话边界：双页配对不许跨话，上一话末页与下一话首页不凑一屏 */
    const starts = new Set(this.archive.groups.map((g) => g.page));
    this.screens = buildScreens(this.pages, this.spreadOptions(), starts);
    this.screen = keepPage ? screenOfPage(this.screens, anchor) : 0;
    this.root.dataset.flow = this.prefs.flow;
    this.root.dataset.dir = this.direction;
    this.root.dataset.fit = this.prefs.fit;
    this.root.dataset.zoom = String(this.prefs.zoom);
    this.stage.style.background = this.prefs.background || '';
    this.film.style.filter = filterCss(this.prefs.brightness, this.prefs.contrast, this.prefs.gamma);
    this.thumbs.classList.toggle('is-on', this.prefs.thumbs);
    void this.renderThumbs();
    void this.render();
  }

  private currentPage(): number {
    const s = this.screens[this.screen];
    return s?.pages[0] ?? 0;
  }

  /** 图片尺寸是加载完才知道的：回填后重算布局，锚在原图序号上不错位 */
  private setPageSize(page: number, width: number, height: number): void {
    const p = this.pages[page];
    if (!p || (p.width === width && p.height === height)) return;
    p.width = width;
    p.height = height;
    if (this.prefs.flow === 'paged' && this.prefs.splitWide) {
      /* 宽图要不要拆半会改变屏数，必须重新组屏。
         但图片的 load 事件可能正好落在 render 的 await 中间（双页时两张图
         先后到）——那时直接 rebuild 会开出第二轮 render，把第一轮刚 append
         的 cell 从 DOM 里换掉、`cells` 表也重置，落单的那个 cell 永远拿不到
         `style.width`，真机上的表现就是「左边一页按原图 1200px 撑爆视口」
         （2026-11-22 手机双页截图）。所以渲染中只记一笔，等这一轮走完再排。 */
      if (this.rendering) this.rebuildQueued = true;
      else this.rebuild();
    } else {
      this.layout();
    }
  }

  /* ─────────────── 渲染 ─────────────── */

  private async render(): Promise<void> {
    if (this.destroyed) return;
    /* 渲染中再进来只排队：见 setPageSize 的注释 */
    if (this.rendering) {
      this.rebuildQueued = true;
      return;
    }
    this.rendering = true;
    try {
      const flow = this.prefs.flow;
      this.film.replaceChildren();
      this.panelLayer.replaceChildren();
      this.cells.clear();
      this.screenCells = [];

      if (flow === 'paged') {
        await this.renderPaged();
      } else {
        await this.renderContinuous(flow);
      }
      this.emitRelocate();
    } finally {
      this.rendering = false;
      if (this.rebuildQueued && !this.destroyed) {
        this.rebuildQueued = false;
        this.rebuild();
      } else if (this.pendingScroll && !this.destroyed) {
        /* 渲染完才滚：跳页 / 恢复位置在连续排版下都走这里 */
        this.pendingScroll = false;
        this.scrollToCurrent();
      }
    }
  }

  private async renderPaged(): Promise<void> {
    const s = this.screens[this.screen];
    if (!s) return;
    this.film.classList.add('is-paged');
    this.film.classList.remove('is-row', 'is-column');
    for (const unit of s.units) {
      const cell = await this.makeCell(unit.page, unit.half, s.units.length > 1);
      if (cell) this.film.append(cell.wrap);
    }
    this.layout();
    if (this.prefs.panels) await this.detectCurrentPanels(s);
    this.prefetch();
  }

  private async renderContinuous(flow: 'vertical' | 'horizontal' | 'webtoon'): Promise<void> {
    this.film.classList.remove('is-paged');
    this.film.classList.toggle('is-row', flow === 'horizontal');
    this.film.classList.toggle('is-column', flow !== 'horizontal');
    /* 连续模式靠 cell 的真实布局尺寸缩放，film 不挂 transform：
       挂了会把整条滚动内容一起缩放，滚动位置和内容尺寸全乱 */
    this.film.setCssProps({ transform: '' });
    /* 连续模式也一屏一个 box（条漫同样）：进度 / 跳页 / 滚动定位都按屏算，
       全卷拼成一屏的话 currentPage 永远是第 1 页。视觉上的连续靠
       .bzr-manga-screen 之间没有间距保证，不靠合成一个 box。 */
    for (const s of this.screens) {
      const box = el('div', 'bzr-manga-screen');
      for (const unit of s.units) {
        /* 只搭骨架、不解压：连续排版整本驻留会在手机上 OOM，
           图由 loadVisible 按视口补、滚走再回收 */
        const cell = await this.makeCell(unit.page, unit.half, s.units.length > 1, true);
        if (cell) box.append(cell.wrap);
      }
      this.film.append(box);
    }
    this.layout();
    /* 连续模式只加载视口附近的图：滚到哪补到哪 */
    this.loadVisible();
  }

  private async makeCell(
    page: number, half: Cell['half'], paired: boolean, lazy = false,
  ): Promise<Cell | null> {
    const wrap = el('div', 'bzr-manga-cell');
    wrap.dataset.half = half;
    wrap.classList.toggle('is-paired', paired);
    const img = el('img', 'bzr-manga-img');
    img.alt = '';
    img.draggable = false;
    wrap.append(img);
    const cell: Cell = { page, half, img, wrap, url: '' };
    /* cells 按 page 索引，服务「分格 / 裁边 / 一键调色」这类单页动作；
       screenCells 按视觉顺序存，布局遍历它——拆半时同一页有两个 cell，
       只按 page 索引会让其中一个永远拿不到尺寸。 */
    this.cells.set(page, cell);
    this.screenCells.push(cell);
    img.addEventListener('load', () => {
      if (!img.naturalWidth) return;
      this.setPageSize(page, img.naturalWidth, img.naturalHeight);
      if (this.prefs.crop) this.applyCrop(cell);
    });
    /* 解码失败要留可见的「这一页坏了」，否则只剩一张按猜测尺寸占位的空白格 */
    img.addEventListener('error', () => {
      if (this.destroyed || !img.getAttribute('src')) return;
      wrap.classList.add('is-broken');
      wrap.textContent = String(page + 1);
    });
    if (!lazy) {
      const url = await this.urlFor(page);
      if (this.destroyed) return null;
      this.paintCell(cell, url);
    }
    return cell;
  }

  /** 把一张图挂到格子上；拿不到就标坏页并显示页码 */
  private paintCell(cell: Cell, url: string | null): void {
    if (url) {
      cell.url = url;
      cell.img.src = url;
      cell.wrap.classList.remove('is-broken');
      return;
    }
    cell.wrap.classList.add('is-broken');
    cell.wrap.textContent = String(cell.page + 1);
  }

  /** 只解压眼前 ±1 屏，其余滚走就释放；同一张图只解一次 */
  private async urlFor(page: number): Promise<string | null> {
    const cached = this.urls.get(page);
    if (cached) return cached;
    const name = this.pages[page]?.name;
    if (!name) return null;
    const blob = await this.archive.blob(name);
    if (this.destroyed || !blob) return null;
    const url = URL.createObjectURL(new Blob([blob], { type: imageMime(name) }));
    this.urls.set(page, url);
    return url;
  }

  /** 缩略图带开着时，当前页前后各留几张给它用（其余照常回收） */
  private thumbKeep(page: number): boolean {
    return this.prefs.thumbs && Math.abs(page - this.currentPage()) <= 3;
  }

  private prefetch(): void {
    const near = new Set<number>();
    for (let d = -1; d <= 1; d += 1) {
      const s = this.screens[this.screen + d];
      if (s) for (const p of s.pages) near.add(p);
    }
    for (const p of near) void this.urlFor(p);
    for (const [p, url] of this.urls) {
      if (near.has(p) || this.thumbKeep(p)) continue;
      const cell = this.cells.get(p);
      if (cell) cell.img.removeAttribute('src');
      URL.revokeObjectURL(url);
      this.urls.delete(p);
    }
  }

  private loadVisible(): void {
    if (this.destroyed) return;
    const boxes = Array.from(this.film.querySelectorAll<HTMLElement>('.bzr-manga-screen'));
    const r = this.stage.getBoundingClientRect();
    const near = new Set<number>();
    boxes.forEach((box, i) => {
      const b = box.getBoundingClientRect();
      if (b.bottom < r.top - r.height || b.top > r.bottom + r.height) return;
      for (let d = -1; d <= 1; d += 1) {
        const s = this.screens[i + d];
        if (s) for (const p of s.pages) near.add(p);
      }
    });
    if (!near.size) for (const p of this.screens[0]?.pages ?? []) near.add(p);
    for (const p of near) {
      const cell = this.cells.get(p);
      if (!cell || cell.img.src) continue;
      void this.urlFor(p).then((url) => {
        if (this.destroyed || !url) return;
        this.paintCell(cell, url);
      });
    }
    /* 滚出视口的图必须回收：objectURL 只解不还，几十页就能把手机撑爆 */
    for (const [p, url] of [...this.urls]) {
      if (near.has(p) || this.thumbKeep(p)) continue;
      const cell = this.cells.get(p);
      if (cell) {
        cell.img.removeAttribute('src');
        cell.url = '';
      }
      URL.revokeObjectURL(url);
      this.urls.delete(p);
    }
  }

  /* ─────────────── 尺寸 ─────────────── */

  /**
   * 核心：把「适配后的像素尺寸」写到 cell 上。
   *
   * 旧版把 fit 乘进 film 的 transform，而 img 仍按容器宽铺满——fit 与
   * 实际渲染尺寸各算各的，整页永远只有该有的大小的四成。现在 cell 的
   * 宽高就是最终尺寸，film 只负责 zoom / pan。
   */
  private layout(): void {
    if (this.destroyed) return;
    const flow = this.prefs.flow;
    const vw = Math.max(1, this.stage.clientWidth);
    const vh = Math.max(1, this.stage.clientHeight);
    if (flow === 'paged') {
      this.layoutPaged(vw, vh);
    } else {
      this.layoutContinuous(flow, vw, vh);
    }
  }

  private dimsOf(page: number): { w: number; h: number } {
    const p = this.pages[page];
    if (!p || !p.width || !p.height) return { w: GUESS_W, h: GUESS_H };
    return { w: p.width, h: p.height };
  }

  private layoutPaged(vw: number, vh: number): void {
    const s = this.screens[this.screen];
    if (!s) return;
    const count = Math.max(1, s.units.length);
    const slotW = vw / count;
    /* 每张图各算各的：双页时两页比例可能不同 */
    let maxH = 0;
    /* 按 screenCells 走而不是 s.visual：拆半时同一页有两个 cell，只按 page
       索引会让前面那格拿不到尺寸、按原图宽撑爆视口（2026-11-22 真机） */
    for (const cell of this.screenCells) {
      const half = cell.half;
      const d = this.dimsOf(cell.page);
      const imgW = half === 'full' ? d.w : d.w / 2;
      /* 长条图（高度是宽度 6 倍以上）在 smart 下按宽度铺，否则会被压成一条线 */
      const fit = effectiveFit(this.prefs.fit, d.w, d.h);
      const base = fitScale(fit, imgW, d.h, slotW, vh);
      const cellW = half === 'full' ? d.w * base : (d.w * base) / 2;
      const cellH = d.h * base;
      cell.wrap.style.width = `${cellW}px`;
      cell.wrap.style.height = `${cellH}px`;
      /* 拆半：图片按整页宽画、cell 裁掉另一半，尺寸全由 .bzr-manga-img 的 CSS 定 */
      this.base = base;
      maxH = Math.max(maxH, cellH);
    }
    /* 长条图比视口高：从顶部开始显示、靠拖动往下看；普通单页居中 */
    this.film.style.alignItems = maxH > vh ? 'flex-start' : 'center';
    this.applyTransform(vw, vh, vw, maxH);
  }

  private layoutContinuous(
    flow: 'vertical' | 'horizontal' | 'webtoon', vw: number, vh: number,
  ): void {
    for (const cell of this.screenCells) {
      const d = this.dimsOf(cell.page);
      /* 适配档位和缩放倍数都要落到真实布局尺寸上，stage 的滚动条才会跟着变；
         smart 默认按滚动主轴铺，zoom=1 的手感和修复前一致 */
      const size = continuousCellSize(
        this.prefs.fit, d.w, d.h, vw, vh, flow, this.prefs.zoom,
      );
      cell.wrap.style.width = `${size.w}px`;
      cell.wrap.style.height = `${size.h}px`;
    }
    this.film.setCssProps({ transform: '' });
    this.pan = { x: 0, y: 0 };
  }

  /** film 只管 zoom / pan：内容是 fit 后的尺寸，zoom=1 即「适配」 */
  private applyTransform(vw: number, vh: number, contentW: number, contentH: number): void {
    const zoom = this.prefs.zoom;
    const w = contentW * zoom;
    const h = contentH * zoom;
    const mx = Math.max(0, (w - vw) / 2);
    const my = Math.max(0, (h - vh) / 2);
    this.pan = {
      x: Math.min(mx, Math.max(-mx, this.pan.x)),
      y: Math.min(my, Math.max(-my, this.pan.y)),
    };
    this.film.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${zoom})`;
  }

  /* ─────────────── 自动裁白边 ─────────────── */

  private applyCrop(cell: Cell): void {
    const p = projections(cell.img);
    if (!p) return;
    const inset = cropInsets(p.row, p.col);
    if (!inset.top && !inset.bottom && !inset.left && !inset.right) return;
    const top = (inset.top / SAMPLE) * 100;
    const bottom = (inset.bottom / SAMPLE) * 100;
    const left = (inset.left / SAMPLE) * 100;
    const right = (inset.right / SAMPLE) * 100;
    cell.img.style.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
  }

  /* ─────────────── 分格导览 ─────────────── */

  private async detectCurrentPanels(s: MangaScreen): Promise<void> {
    const page = s.pages[0];
    const cell = this.cells.get(page);
    if (!cell) return;
    const p = projections(cell.img);
    if (!p) { this.panelRects = []; return; }
    const rects = detectPanels(p.row, p.col, SAMPLE, SAMPLE);
    if (!rects.length) { this.panelRects = []; return; }
    this.panelRects = rects;
    this.panelSeq = panelOrder(rects, this.direction);
    if (this.panel < 0) this.panel = 0;
    this.paintPanel();
  }

  /** 只亮当前格，其余盖住：防剧透比「整页都看得见但顺序对」更要紧 */
  private paintPanel(): void {
    this.panelLayer.replaceChildren();
    if (!this.prefs.panels || !this.panelRects.length || this.panel < 0) return;
    const idx = this.panelSeq[this.panel];
    const r = this.panelRects[idx];
    if (!r) return;
    const x = r.x * 100;
    const y = r.y * 100;
    const w = r.w * 100;
    const h = r.h * 100;
    const areas: Array<[number, number, number, number]> = [
      [0, 0, 100, y],
      [0, y + h, 100, 100 - y - h],
      [0, y, x, h],
      [x + w, y, 100 - x - w, h],
    ];
    for (const [l, tp, ww, hh] of areas) {
      if (ww <= 0 || hh <= 0) continue;
      const shade = el('div', 'bzr-manga-shade');
      shade.style.cssText = `left:${l}%;top:${tp}%;width:${ww}%;height:${hh}%`;
      this.panelLayer.append(shade);
    }
    const frame = el('div', 'bzr-manga-frame');
    frame.style.cssText = `left:${x}%;top:${y}%;width:${w}%;height:${h}%`;
    this.panelLayer.append(frame);
    /* 当前格放大到眼前：用整屏 transform，不搬坐标 */
    const vw = Math.max(1, this.stage.clientWidth);
    const vh = Math.max(1, this.stage.clientHeight);
    const cell = this.cells.get(this.currentPage());
    const boxW = cell ? cell.wrap.offsetWidth : vw;
    const boxH = cell ? cell.wrap.offsetHeight : vh;
    const zoom = Math.min(6, Math.max(1, Math.min(vw / (boxW * r.w), vh / (boxH * r.h))));
    const cx = (r.x + r.w / 2 - 0.5) * boxW;
    const cy = (r.y + r.h / 2 - 0.5) * boxH;
    this.film.style.transform = `scale(${zoom}) translate(${-cx}px, ${-cy}px)`;
  }

  /* ─────────────── 缩放与平移 ─────────────── */

  private applyZoom(): void {
    if (this.prefs.flow !== 'paged') {
      /* 连续模式不用 film transform：重排 cell 尺寸，让滚动范围一起变 */
      this.layout();
      return;
    }
    const vw = Math.max(1, this.stage.clientWidth);
    const vh = Math.max(1, this.stage.clientHeight);
    let contentW = 0;
    let contentH = 0;
    for (const cell of this.screenCells) {
      contentW += cell.wrap.offsetWidth;
      contentH = Math.max(contentH, cell.wrap.offsetHeight);
    }
    this.applyTransform(vw, vh, contentW || vw, contentH || vh);
  }

  /** 相对当前缩放再放大 / 缩小；点百分比复位到「适配」 */
  zoomBy(factor: number): void {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.prefs.zoom * factor));
    if (Math.abs(next - this.prefs.zoom) < 0.001) return;
    this.prefs.zoom = next;
    this.pan = { x: 0, y: 0 };
    this.applyZoom();
    this.renderLayoutPanel();
    this.emitViewState();
  }

  private resetZoom(): void {
    this.prefs.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.applyZoom();
    this.renderLayoutPanel();
    this.emitViewState();
  }

  /* ─────────────── 导航 ─────────────── */

  /** 翻一屏；返回 false = 已经到第一屏 / 最后一屏（读完确认制用这个信号） */
  turn(dir: 1 | -1): boolean {
    /* 右到左时「下一屏」在左边，但内部的屏序永远按阅读顺序递增 */
    if (this.prefs.panels && this.panelRects.length && dir === 1 && this.panel < this.panelSeq.length - 1) {
      this.panel += 1;
      this.paintPanel();
      this.emitRelocate();
      return true;
    }
    if (this.prefs.panels && this.panelRects.length && dir === -1 && this.panel > 0) {
      this.panel -= 1;
      this.paintPanel();
      this.emitRelocate();
      return true;
    }
    const next = turnScreen(this.screen, this.screens.length, dir);
    if (next === this.screen) {
      this.emitRelocate();
      return false;
    }
    this.screen = next;
    this.panel = -1;
    this.panelRects = [];
    this.pan = { x: 0, y: 0 };
    /* 连续排版不重建 DOM：整本重搭一次太贵，滚到目标屏就够了 */
    if (this.prefs.flow !== 'paged') {
      this.scrollToCurrent();
      this.loadVisible();
      this.emitRelocate();
      return true;
    }
    void this.render();
    return true;
  }

  goToPage(page: number, panel = -1): void {
    const p = Math.min(this.pages.length - 1, Math.max(0, Math.floor(page)));
    this.screen = screenOfPage(this.screens, p);
    this.panel = panel;
    this.pan = { x: 0, y: 0 };
    /* 连续排版里 render 会把 DOM 清空重搭，滚动必须等它走完（见 render 的 finally） */
    this.pendingScroll = this.prefs.flow !== 'paged';
    void this.render().then(() => {
      if (this.destroyed) return;
      if (this.prefs.flow === 'paged') this.scrollToCurrent();
    });
  }

  goToPercent(fraction: number): void {
    const f = Math.min(1, Math.max(0, Number(fraction) || 0));
    this.goToPage(Math.round(f * Math.max(0, this.pages.length - 1)));
  }

  private scrollToCurrent(): void {
    const boxes = this.film.querySelectorAll<HTMLElement>('.bzr-manga-screen');
    const box = boxes[this.screen];
    if (!box) return;
    /* 直接写滚动容器的偏移：scrollIntoView 在嵌套布局里会连带滚外层，
       连续排版下表现为整页被顶上去、顶栏跑到看不见 */
    if (this.prefs.flow === 'horizontal') this.stage.scrollLeft = box.offsetLeft;
    else this.stage.scrollTop = box.offsetTop;
  }

  /* ─────────────── 排版面板 / 缩略图 ─────────────── */

  private layoutEl: HTMLDivElement | null = null;
  private layoutAnchor: { left: number; top: number; width: number; height: number } | null = null;
  private layoutOff: ((ev: PointerEvent) => void) | null = null;

  /**
   * 头栏「排版」：缩放 / 适配 / 逐格 / 裁边 / 调色 / 方向 / 单双页 / 翻页。
   *
   * 2026-11-22 二轮真机反馈：第一版把这些做成画面里的悬浮工具条，作者
   * 要求「像 PDF 和 EPUB 一样单独做一个排版的界面，其他功能放右上角图标」。
   * 现在是一张贴着头栏按钮下沿的小卡（和 PDF 排版面板同一套 `.bzs-float`
   * 外观），点外面或再点一次头栏图标收起。
   *
   * @param anchor 触发按钮的视口矩形。命令面板 / 快捷键 / ⋮ 菜单没有坐标，
   *   传 null 就落在右上角兜底位——硬算一个旧坐标比不贴更糟。
   */
  toggleLayoutPanel(anchor?: { left: number; top: number; width: number; height: number } | null): void {
    if (this.destroyed) return;
    if (this.layoutEl) {
      this.closeLayoutPanel();
      return;
    }
    const panel = createDiv();
    panel.className = 'bzr-manga-layout bzs-float is-corner no-head';
    /* 卡片里的点击不能漏到 stage：stage 的 click 是「点左/右翻页」 */
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
    /* 捕获阶段：免得被 stage 的 pointerdown（拖动开始）先吃掉 */
    window.setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }

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
   * 贴着按钮弹：右缘对齐按钮右缘、顶边在按钮下方 8px。
   *
   * 按钮矩形是视口坐标，卡片挂在 `.bzr-manga`（absolute + inset:0）里，
   * 所以要减掉阅读区左上角，换算规则与 PDF 面板同一份（anchoredBelowRightIn）。
   */
  private placeLayoutPanel(): void {
    const el = this.layoutEl;
    if (!el) return;
    const anchor = this.layoutAnchor;
    /* 窄屏交给 CSS 的容器查询：`@container bzs (max-width:640px)` 会把
       `.bzs-float.is-corner` 改成贴着底部的一整条（让开安全区与宿主底栏、
       max-height 62vh 可滚动）。这里再写内联 left/top 会把它顶回右上角，
       高度还被 62vh 卡住——真机上正是「面板只露出一半，剩下要靠滚」。
       桌面才贴按钮：右缘对齐、下沿 8px。 */
    if (!anchor || this.root.clientWidth < 640) {
      el.setCssProps({ left: '', top: '', right: '', bottom: '' });
      return;
    }
    const pos = anchoredBelowRightIn(
      anchor,
      { width: el.offsetWidth || 320, height: el.offsetHeight || 0 },
      this.root.getBoundingClientRect(),
    );
    el.setCssProps({ left: `${pos.left}px`, top: `${pos.top}px`, right: 'auto', bottom: 'auto' });
  }

  /** 画卡片。行序与选项顺序见 manga/panel.ts（测试按那份清单断言） */
  private renderLayoutPanel(): void {
    const el = this.layoutEl;
    if (!el) return;
    el.textContent = '';
    const body = el.createDiv({ cls: 'bzs-mbody' });
    const grp = body.createDiv({ cls: 'bzs-setgrp flat' });

    /* 一行分段控件：label 在左、按钮组在右，和设置页 / PDF 面板同一套类名。
       `cls` 用来固化列数（见 styles.css 的 .bzr-manga-seg3）：手机上
       `.bzs-seg` 允许折行，六档适配按自然宽度会排成三行，太高。 */
    const seg = (
      label: string,
      opts: Array<{ v: string; text: string; on: boolean }>,
      run: (v: string) => void,
      cls = '',
    ): void => {
      const row = grp.createDiv({ cls: 'bzs-setrow' });
      row.createEl('label', { text: label });
      const box = row.createDiv({ cls: cls ? `bzs-seg ${cls}` : 'bzs-seg' });
      for (const opt of opts) {
        const btn = createEl('button');
        btn.type = 'button';
        btn.textContent = opt.text;
        btn.className = opt.on ? 'on' : '';
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          run(opt.v);
        });
        box.appendChild(btn);
      }
    };

    for (const key of mangaPanelRows(this.prefs.flow)) {
      switch (key) {
        case 'zoom': {
          /* 和 PDF 那条浮条同一个口径：− / 百分比（点一下复位）/ + */
          const row = grp.createDiv({ cls: 'bzs-setrow' });
          row.createEl('label', { text: t('pdf.layout.zoom') });
          const box = row.createDiv({ cls: 'bzs-seg bzr-manga-seg3' });
          const zb = (text: string, sr: string, fn: () => void, on = false): void => {
            const btn = createEl('button');
            btn.type = 'button';
            btn.textContent = text;
            btn.className = on ? 'on' : '';
            btn.appendChild(Object.assign(createSpan(), { className: 'bzs-sr-only', textContent: sr }));
            btn.addEventListener('click', (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              fn();
            });
            box.appendChild(btn);
          };
          zb('−', t('manga.zoomOut'), () => this.zoomBy(1 / ZOOM_STEP));
          zb(mangaZoomLabel(this.prefs.zoom), t('manga.zoomReset'), () => this.resetZoom(), this.prefs.zoom !== 1);
          zb('＋', t('manga.zoomIn'), () => this.zoomBy(ZOOM_STEP));
          break;
        }
        case 'fit':
          seg(
            t('manga.fit'),
            MANGA_FIT_OPTIONS.map((v) => ({ v, text: t(FIT_LABEL[v]), on: this.prefs.fit === v })),
            (v) => this.setPref('fit', v as MangaFit),
            'bzr-manga-seg3',
          );
          break;
        case 'assist': {
          /* 三颗并一行：逐格 / 裁边是开关（亮 = 开），调色是一次性动作。
             各占一行时整张卡在手机上要滚动才能看完最后两行。 */
          const row = grp.createDiv({ cls: 'bzs-setrow' });
          row.createEl('label', { text: t('manga.panel.assist') });
          const box = row.createDiv({ cls: 'bzs-seg bzr-manga-seg3' });
          for (const item of MANGA_ASSIST_ITEMS) {
            const btn = createEl('button');
            btn.type = 'button';
            btn.textContent =
              item === 'panels' ? t('manga.panels') : item === 'crop' ? t('manga.crop') : t('manga.tone');
            /* 逐格 / 裁边是开关：亮着表示开着。调色是一次性动作，没有开合态 */
            const on = item === 'panels' ? this.prefs.panels : item === 'crop' ? this.prefs.crop : false;
            btn.className = on ? 'on' : '';
            btn.addEventListener('click', (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (item === 'tone') this.fixTone();
              else if (item === 'panels') this.setPref('panels', !this.prefs.panels);
              else this.setPref('crop', !this.prefs.crop);
            });
            box.appendChild(btn);
          }
          break;
        }
        case 'direction':
          seg(
            t('settings.manga.direction'),
            [
              { v: 'rtl', text: t('settings.manga.direction.rtl'), on: this.direction === 'rtl' },
              { v: 'ltr', text: t('settings.manga.direction.ltr'), on: this.direction === 'ltr' },
            ],
            (v) => this.setDirectionFromUser(v as MangaDirection),
          );
          break;
        case 'pages':
          seg(
            t('pdf.layout.pages'),
            [
              { v: 'single', text: t('pdf.layout.single'), on: !this.prefs.spread },
              { v: 'spread', text: t('pdf.layout.spread'), on: this.prefs.spread },
            ],
            (v) => this.setPref('spread', v === 'spread'),
          );
          break;
        case 'flow':
          seg(
            t('settings.manga.flow'),
            MANGA_FLOW_OPTIONS.map((v) => ({ v, text: t(FLOW_LABEL[v]), on: this.prefs.flow === v })),
            (v) => this.setPref('flow', v as MangaFlow),
            /* 四档的字都不短（连续横向 / 条漫长图）：两列两行，别挤成一条 */
            'bzr-manga-seg2',
          );
          break;
      }
    }
  }

  /** 头栏那颗缩略图图标：默认关，开了才在底部占一条 */
  toggleThumbs(): void {
    this.setPref('thumbs', !this.prefs.thumbs);
  }

  private async renderThumbs(): Promise<void> {
    if (!this.prefs.thumbs) {
      this.thumbs.replaceChildren();
      return;
    }
    this.thumbs.replaceChildren();
    for (let i = 0; i < this.pages.length; i += 1) {
      const box = el('button', `bzr-manga-thumb${i === this.currentPage() ? ' is-cur' : ''}`);
      box.type = 'button';
      const img = el('img');
      img.alt = '';
      box.append(img);
      box.addEventListener('click', (ev) => { ev.stopPropagation(); this.goToPage(i); });
      this.thumbs.append(box);
      /* 缩略图用同一张已解压的图；没解压到的等视野靠近再补，不预扫整本 */
      const url = this.urls.get(i);
      if (url) img.src = url;
      else if (Math.abs(i - this.currentPage()) <= 3) {
        void this.urlFor(i).then((u) => { if (u && !this.destroyed) img.src = u; });
      }
    }
  }

  /* ─────────────── 设置动作 ─────────────── */

  private setPref<K extends keyof MangaPrefs>(key: K, value: MangaPrefs[K]): void {
    (this.prefs as Mutable<MangaPrefs>)[key] = value;
    if (key === 'flow') {
      this.pan = { x: 0, y: 0 };
      /* 逐格状态属于「一屏一页」：切到连续排版还留着，下一次 turn 会先命中
         逐格分支，把整条滚动的画面 scale 掉而且不翻页 */
      this.panel = -1;
      this.panelRects = [];
      this.panelSeq = [];
      this.panelLayer.replaceChildren();
    }
    this.rebuild();
    /* 面板开着时同步选中态；关着时这里是空操作 */
    this.renderLayoutPanel();
    this.emitViewState();
  }

  /**
   * 用户在面板里改方向。
   *
   * 和 `setDirection` 分开：那个是宿主「按文件 / 按书记忆」灌进来的，
   * 不该把 `prefs.direction` 从 auto 改成写死的 rtl 再存进 mangaView；
   * 这个才是「用户自己选的」，必须落盘。
   */
  private setDirectionFromUser(direction: MangaDirection): void {
    this.direction = direction;
    this.prefs.direction = direction;
    this.rebuild();
    this.renderLayoutPanel();
    this.emitViewState();
  }

  private fixTone(): void {
    const cell = this.cells.get(this.currentPage());
    if (!cell) return;
    const p = projections(cell.img);
    if (!p) return;
    const tone = autoTone(p.mean);
    this.prefs.brightness = tone.brightness;
    this.prefs.contrast = tone.contrast;
    this.prefs.gamma = tone.gamma;
    this.syncGamma();
    this.rebuild();
    this.emitViewState();
  }

  private showWholePage(): void {
    this.panel = -1;
    this.panelRects = [];
    this.panelLayer.replaceChildren();
    this.pan = { x: 0, y: 0 };
    this.layout();
  }

  /** 设置页改了全局偏好：只覆盖用户没在本里单独调过的项 */
  applyPrefs(next: MangaPrefs): void {
    this.prefs = next;
    this.direction = next.direction === 'ltr' ? 'ltr' : 'rtl';
    this.rebuild();
    this.renderLayoutPanel();
  }

  setDirection(direction: MangaDirection): void {
    this.direction = direction;
    this.rebuild();
  }

  /* ─────────────── 回调 ─────────────── */

  private emitRelocate(): void {
    const total = Math.max(1, this.pages.length);
    const page = this.currentPage();
    const g = [...this.archive.groups].reverse().find((x: { label: string; page: number }) => x.page <= page);
    this.hooks.onRelocate({
      percent: page / total,
      cfi: mangaLocator(page, this.panel >= 0 ? this.panel : undefined),
      page,
      total: this.pages.length,
      screen: this.screen,
      screens: this.screens.length,
      chapterTitle: g ? g.label : '',
      chapterIndex: g ? this.archive.groups.indexOf(g) : 0,
    });
  }

  private emitViewState(): void {
    this.hooks.onViewState({
      direction: this.prefs.direction,
      spread: this.prefs.spread,
      flow: this.prefs.flow,
      fit: this.prefs.fit,
      zoom: this.prefs.zoom,
      offset: this.prefs.offset,
      page: this.currentPage(),
      panel: this.panel,
    });
  }

  /* ─────────────── gamma 滤镜 ─────────────── */

  private installGammaFilter(): void {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('class', 'bzr-manga-defs');
    const filter = document.createElementNS(ns, 'filter');
    filter.setAttribute('id', 'bzr-manga-gamma');
    for (const channel of ['R', 'G', 'B']) {
      const fn = document.createElementNS(ns, 'feComponentTransfer');
      const transfer = document.createElementNS(ns, `feFunc${channel}`);
      transfer.setAttribute('type', 'gamma');
      transfer.setAttribute('exponent', String(1 / Math.max(0.1, this.prefs.gamma)));
      fn.append(transfer);
      filter.append(fn);
    }
    svg.append(filter);
    this.root.append(svg);
    this.gammaSvg = svg;
  }

  private syncGamma(): void {
    const fns = this.gammaSvg?.querySelectorAll('feFuncR, feFuncG, feFuncB');
    fns?.forEach((fn) => fn.setAttribute('exponent', String(1 / Math.max(0.1, this.prefs.gamma))));
  }

  /* ─────────────── 输入 ─────────────── */

  private bind(): void {
    this.stage.addEventListener('click', (ev) => {
      /* 刚翻过页 / 刚拖过：浏览器随后补发的 click 不能再翻一页 */
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      /* 桌面默认不靠点击翻页（跟普通书一致），只有设置里开了才翻；
         手机上点按仍是最自然的翻页手势，一直可用。 */
      if (!clickTurns(this.input.mobile, this.input.desktopTurn)) return;
      const r = this.stage.getBoundingClientRect();
      const x = (ev.clientX - r.left) / Math.max(1, r.width);
      const left = x < 0.33;
      const right = x > 0.67;
      if (!left && !right) return;
      /* 右到左书：点左边是下一屏；再让用户手动反转一次 */
      const rtl = this.direction === 'rtl';
      let dir: 'prev' | 'next' = left ? 'prev' : 'next';
      if (rtl) dir = dir === 'prev' ? 'next' : 'prev';
      if (this.prefs.tapReverse) dir = dir === 'prev' ? 'next' : 'prev';
      this.hooks.onTurn(dir);
    });
    this.stage.addEventListener('dblclick', () => this.zoomBy(ZOOM_STEP));
    this.stage.addEventListener('wheel', (ev) => {
      /* Ctrl/⌘ + 滚轮统一放大看图（含连续排版）：拦掉默认行为，别把整个界面缩放。
         触控板捏合会以很小的 delta 连发几十个事件，一事件一档会直接顶到
         最大倍数并连带几十次重排——按累计位移凑够一档再走。 */
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        const step = wheelPixels(ev.deltaY, ev.deltaX, ev.deltaMode);
        if (!step) return;
        this.zoomAcc += step;
        if (Math.abs(this.zoomAcc) < ZOOM_WHEEL_THRESHOLD) return;
        const factor = this.zoomAcc < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        this.zoomAcc = 0;
        this.zoomBy(factor);
        return;
      }
      /* 横向排版的内容沿 x 轴铺，鼠标滚轮却只给 y 方向；而它的
         overflow-y 是 hidden，浏览器自然滚动根本帮不上——必须转成 scrollLeft。
         触控板横滑的 deltaX 也一并接住。 */
      if (this.prefs.flow === 'horizontal') {
        const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
        if (d) {
          ev.preventDefault();
          this.stage.scrollLeft += d;
        }
        return;
      }
      /* 连续向下 / 条漫长图交给浏览器自然滚动（overflow-y: auto）。
         一屏一页档才走滚轮翻页：和普通书同手感，攒够阈值翻一屏。 */
      if (this.prefs.flow !== 'paged' || this.input.mobile) return;
      const main = wheelPixels(ev.deltaY, ev.deltaX, ev.deltaMode);
      if (!main) return;
      ev.preventDefault();
      const now = Date.now();
      if (!turnReady(now, this.lastWheelTurnAt, WHEEL_COOLDOWN)) return;
      const res = wheelTurn(this.wheelAcc, main, WHEEL_TURN_THRESHOLD);
      this.wheelAcc = res.acc;
      if (!res.dir) return;
      this.lastWheelTurnAt = now;
      this.hooks.onTurn(res.dir);
    }, { passive: false });
    this.stage.addEventListener('pointerdown', (ev) => {
      this.dragStart = { x: ev.clientX, y: ev.clientY, px: this.pan.x, py: this.pan.y };
      this.suppressClick = false;
      /* 手指移出舞台时也要收得到 up：不捕获就会丢这一段拖动 */
      try { this.stage.setPointerCapture(ev.pointerId); } catch { /* 合成事件没有指针 id */ }
      this.clearHold();
      this.hold = window.setTimeout(() => {
        this.hold = null;
        this.showWholePage();
      }, HOLD_MS);
    });
    this.stage.addEventListener('pointermove', (ev) => {
      const d = this.dragStart;
      if (!d) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) this.clearHold();
      /* 只有放大后才拖得动：连续排版是原生滚动，改 pan 会把内容顶飞 */
      if (this.prefs.flow !== 'paged' || this.prefs.zoom <= 1.001) return;
      this.pan = { x: d.px + dx, y: d.py + dy };
      this.applyZoom();
    });
    this.stage.addEventListener('pointerup', (ev) => {
      const d = this.dragStart;
      this.dragStart = null;
      this.clearHold();
      try { this.stage.releasePointerCapture(ev.pointerId); } catch { /* 同上 */ }
      if (!d) return;
      const dx = ev.clientX - d.x;
      const dy = ev.clientY - d.y;
      /* 未放大时横向滑动 = 翻页；放大后 = 拖动看图 */
      if (Math.abs(dx) > 48 && this.prefs.flow === 'paged' && this.prefs.zoom <= 1.001) {
        this.suppressClick = true;
        const rtl = this.direction === 'rtl';
        const dir = (dx < 0 ? 'next' : 'prev') === 'next' ? (rtl ? 'prev' : 'next') : (rtl ? 'next' : 'prev');
        this.hooks.onTurn(dir);
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        this.suppressClick = true;
        if (this.prefs.flow === 'paged' && this.prefs.zoom > 1.001) {
          this.pan = { x: d.px + dx, y: d.py + dy };
          this.applyZoom();
        }
      }
    });
    this.stage.addEventListener('pointercancel', () => {
      this.dragStart = null;
      this.clearHold();
    });
    this.stage.addEventListener('scroll', () => {
      if (this.prefs.flow !== 'paged') {
        this.loadVisible();
        const boxes = this.film.querySelectorAll('.bzr-manga-screen');
        if (boxes.length) {
          const r = this.stage.getBoundingClientRect();
          const horizontal = this.prefs.flow === 'horizontal';
          let best = 0;
          let min = Infinity;
          boxes.forEach((box, i) => {
            const b = box.getBoundingClientRect();
            /* 横向排版所有屏的 top 都一样，只比 top 会让进度永远停在第一屏 */
            const d = horizontal ? Math.abs(b.left - r.left) : Math.abs(b.top - r.top);
            if (d < min) { min = d; best = i; }
          });
          if (best !== this.screen) { this.screen = best; this.emitRelocate(); }
        }
      }
    }, { passive: true });
    /* 长按「偷看整页」的定时器在 pointerdown 里起、在 up / cancel /
       滑出 / 开始拖动时清（见上面的指针事件），不另挂监听 */

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => {
        this.layout();
        /* 窗口一变，按钮的位置也变了：面板跟着重新贴一次 */
        if (this.layoutEl) this.placeLayoutPanel();
      });
      this.resizeObserver.observe(this.stage);
    }
  }

  /* ─────────────── 生命周期 ─────────────── */

  private clearHold(): void {
    if (this.hold !== null) {
      window.clearTimeout(this.hold);
      this.hold = null;
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.clearHold();
    this.closeLayoutPanel();
    this.resizeObserver?.disconnect();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.root.remove();
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

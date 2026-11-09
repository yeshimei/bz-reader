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
import type { PdfDocument, PdfPageSize, PdfRenderTask } from './document';
import { encodePdfLocator, parsePdfLocator, pdfPageLocator } from './locator';

export interface PdfViewCallbacks {
  onRelocate?: (info: RelocateInfo) => void;
  onSelect?: (info: SelectionInfo | null) => void;
  onAnnotTap?: (info: { locator: string; anchor: Rect }) => void;
  onTwoFingerTap?: () => void;
  onStall?: (what: string) => void;
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

const PAGE_GAP = 12;
const SIDE_PAD = 12;
/** 可视页前后各预渲染几页 */
const PRELOAD = 1;
/** 最多同时保留几张已渲染的页 */
const KEEP_ALIVE = 6;
/** 同时进行几个渲染任务：主线程解析，2 个已经够快，再多只会互相拖慢 */
const MAX_PARALLEL = 2;
const RELOCATE_MS = 120;
const SELECTION_MS = 160;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
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
  private fitMode: 'width' | 'page' = 'width';
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

  private readonly annots = new Map<string, AnnotRecord>();
  private readonly selectionRects = new Map<string, NormRect[]>();
  private pulseTimer: number | null = null;
  private zoomLabelEl: HTMLButtonElement | null = null;

  private observer: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private relocateTimer: number | null = null;
  private selectionTimer: number | null = null;
  private lastSelectionAt = 0;
  private suppressClickUntil = 0;
  private lastWidth = 0;

  constructor(doc: PdfDocument, opts: PdfViewCallbacks) {
    this.doc = doc;
    this.opts = opts;

    this.root = document.createElement('div');
    this.root.className = 'bzr-pdf';
    this.scroller = document.createElement('div');
    this.scroller.className = 'bzr-pdf-scroll';
    this.pagesBox = document.createElement('div');
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
    return this.fitMode === 'page' ? 'page' : `${Math.round(this.scale * 100)}%`;
  }

  /** 挂进舞台并建好所有页的骨架（不渲染内容） */
  async mount(host: HTMLElement): Promise<void> {
    host.empty();
    host.appendChild(this.root);
    const first = await this.doc.getPageSize(1);
    this.sizes = Array.from({ length: this.numPages }, () => first);
    this.sizes[0] = first;
    this.scale = this.fitScale('width');
    this.buildShells();
    this.mountToolbar();
    this.bindEvents();
    /* 首屏必须立刻画：几秒空白会被当成「这本书打不开」 */
    this.ensureAround(1, true);
  }

  /** 回到某页：优先 locator，其次百分比 */
  async start(locator: string | undefined, fraction: number): Promise<void> {
    const target = locator ? parsePdfLocator(locator) : null;
    const page = target
      ? clamp(target.page, 1, this.numPages)
      : clamp(1 + Math.round(clamp(fraction, 0, 1) * Math.max(0, this.numPages - 1)), 1, this.numPages);
    this.goToPage(page, false);
    this.current = page;
    this.emitRelocate();
  }

  next(): void {
    this.scroller.scrollBy({ top: Math.max(120, this.scroller.clientHeight * 0.92), behavior: 'smooth' });
  }

  prev(): void {
    this.scroller.scrollBy({ top: -Math.max(120, this.scroller.clientHeight * 0.92), behavior: 'smooth' });
  }

  goToPage(page: number, smooth = true): void {
    const index = clamp(Math.floor(page), 1, this.numPages) - 1;
    const el = this.pageEls[index];
    if (!el) return;
    this.current = index + 1;
    this.scroller.scrollTo({ top: Math.max(0, el.offsetTop - PAGE_GAP), behavior: smooth ? 'smooth' : 'auto' });
    this.ensureAround(this.current, true);
    this.scheduleRelocate();
  }

  goToPercent(fraction: number): void {
    this.goToPage(1 + Math.round(clamp(fraction, 0, 1) * Math.max(0, this.numPages - 1)));
  }

  goToLocator(locator: string): boolean {
    const target = parsePdfLocator(locator);
    if (!target) return false;
    this.goToPage(target.page);
    return true;
  }

  setFitMode(mode: 'width' | 'page'): void {
    this.fitMode = mode;
    this.applyScale(this.fitScale(mode), true);
  }

  zoomIn(): void {
    this.applyScale(clamp(this.scale * 1.2, 0.2, 8), false);
  }

  zoomOut(): void {
    this.applyScale(clamp(this.scale / 1.2, 0.2, 8), false);
  }

  applyPrefs(): void {
    /* PDF 没有字体/行距可调；排版 prefs 不影响它，保留这个方法是为了接口对齐 */
  }

  refreshTheme(): void {
    /* 颜色全走 CSS 变量，主题切换不需要重算 */
  }

  /** 右下角缩放条：PDF 必须有「放大看细节」的入口，否则小字页看不清 */
  private mountToolbar(): void {
    const bar = document.createElement('div');
    bar.className = 'bzr-pdf-toolbar';
    const add = (label: string, title: string, run: () => void): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        run();
      });
      bar.appendChild(btn);
      return btn;
    };
    add('−', '缩小', () => this.zoomOut());
    this.zoomLabelEl = add('100%', '当前缩放', () => this.setFitMode('width'));
    add('＋', '放大', () => this.zoomIn());
    add('宽', '适合宽度', () => this.setFitMode('width'));
    add('页', '适合页面', () => this.setFitMode('page'));
    this.root.appendChild(bar);
    this.updateZoomLabel();
  }

  private updateZoomLabel(): void {
    if (!this.zoomLabelEl) return;
    this.zoomLabelEl.textContent = `${Math.round(this.scale * 100)}%`;
  }

  setViewportWidth(width: number): void {
    if (width <= 0 || Math.abs(width - this.lastWidth) < 2) return;
    this.lastWidth = width;
    if (this.fitMode === 'width') this.applyScale(this.fitScale('width'), true);
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
      });
    }
    for (const page of this.rendered) this.paintAnnotations(page);
  }

  async pulseAt(locator: string): Promise<void> {
    const target = parsePdfLocator(locator);
    if (!target) return;
    this.goToPage(target.page);
    const el = this.pageEls[target.page - 1];
    if (!el) return;
    const old = el.querySelector('.bzr-pdf-pulse');
    old?.remove();
    const mark = document.createElement('div');
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
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    document.removeEventListener('selectionchange', this.onSelectionChange);
    if (this.relocateTimer !== null) window.clearTimeout(this.relocateTimer);
    if (this.selectionTimer !== null) window.clearTimeout(this.selectionTimer);
    if (this.pulseTimer !== null) window.clearTimeout(this.pulseTimer);
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
    const width = this.scroller.clientWidth || this.root.clientWidth || 600;
    const height = this.scroller.clientHeight || this.root.clientHeight || 800;
    const size = this.sizes[0] ?? { width: 600, height: 800 };
    const byWidth = (width - SIDE_PAD * 2) / Math.max(1, size.width);
    const byHeight = (height - SIDE_PAD * 2) / Math.max(1, size.height);
    const picked = mode === 'page' ? Math.min(byWidth, byHeight) : byWidth;
    return clamp(picked, 0.2, 8);
  }

  private pageSize(page: number): PdfPageSize {
    return this.sizes[page - 1] ?? this.sizes[0] ?? { width: 600, height: 800 };
  }

  private buildShells(): void {
    this.pagesBox.empty();
    this.pageEls = [];
    const frag = document.createDocumentFragment();
    for (let page = 1; page <= this.numPages; page += 1) {
      const size = this.pageSize(page);
      const el = document.createElement('div');
      el.className = 'bzr-pdf-page';
      el.dataset.page = String(page);
      el.style.width = `${Math.round(size.width * this.scale)}px`;
      el.style.height = `${Math.round(size.height * this.scale)}px`;
      el.style.marginBottom = `${PAGE_GAP}px`;
      frag.appendChild(el);
      this.pageEls.push(el);
    }
    this.pagesBox.appendChild(frag);
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
    if (again) this.scroller.scrollTop = Math.max(0, again.offsetTop + before);
    this.ensureAround(keep, true);
    this.scheduleRelocate(true);
    this.updateZoomLabel();
  }

  /* ── 事件 ── */

  private bindEvents(): void {
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });

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
        if (this.fitMode === 'width') {
          const width = this.scroller.clientWidth;
          if (width > 0 && Math.abs(width - this.lastWidth) >= 2) {
            this.lastWidth = width;
            this.applyScale(this.fitScale('width'), true);
          }
        }
      });
      this.resizeObserver.observe(this.scroller);
    }

    /* 选区：selectionchange 在宿主 document 上，和 EPUB 的 iframe 不同 */
    document.addEventListener('selectionchange', this.onSelectionChange);
    this.scroller.addEventListener('pointerup', this.onPointerUp, { passive: true });
    this.scroller.addEventListener('click', this.onClick);
    this.scroller.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.scroller.addEventListener('touchend', this.onTouchEnd, { passive: true });
  }

  private onScroll(): void {
    if (this.destroyed) return;
    const page = this.pageAt(this.scroller.scrollTop + this.scroller.clientHeight * 0.4);
    if (page !== this.current) {
      this.current = page;
      this.ensureAround(page, false);
      this.scheduleRelocate();
      this.trim();
    }
  }

  private pageAt(y: number): number {
    if (!this.offsets.length) return 1;
    let lo = 0;
    let hi = this.offsets.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.offsets[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
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
    this.opts.onRelocate?.({
      percent,
      cfi: pdfPageLocator(this.current),
      chapterIndex: this.current - 1,
      chapterTitle: `第 ${this.current} 页`,
      chapterHref: pdfPageLocator(this.current),
      sectionCurrent: this.current - 1,
      sectionTotal: total,
      remainingSeconds: 0,
    });
  }

  private onSelectionChange = (): void => {
    if (this.destroyed) return;
    if (this.selectionTimer !== null) window.clearTimeout(this.selectionTimer);
    this.selectionTimer = window.setTimeout(() => {
      this.selectionTimer = null;
      this.emitSelection();
    }, SELECTION_MS);
  };

  private onPointerUp = (): void => {
    /* 移动端 selectionchange 有时晚于 pointerup；这里再补一次 */
    window.setTimeout(() => this.emitSelection(), 30);
  };

  private emitSelection(): void {
    if (this.destroyed) return;
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
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
    if (rects.length) this.selectionRects.set(locator, rects);
    const bounds = rectOf(range);
    this.opts.onSelect?.({
      text,
      cfiRange: locator,
      chapterIndex: page - 1,
      anchor: bounds,
      bounds,
    });
  }

  private layerOf(node: Node | null): HTMLElement | null {
    if (!node) return null;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return (el?.closest('.bzr-pdf-page .textLayer') as HTMLElement | null) ?? null;
  }

  private normRects(range: Range, layer: HTMLElement): NormRect[] {
    const box = layer.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return [];
    return Array.from(range.getClientRects())
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({
        left: clamp((r.left - box.left) / box.width, 0, 1),
        top: clamp((r.top - box.top) / box.height, 0, 1),
        width: clamp(r.width / box.width, 0, 1),
        height: clamp(r.height / box.height, 0, 1),
      }));
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
    const mark = (ev.target as HTMLElement | null)?.closest('.bzr-pdf-annot-mark') as HTMLElement | null;
    if (mark) {
      const locator = mark.dataset.locator ?? '';
      if (locator) this.opts.onAnnotTap?.({ locator, anchor: rectOfBox(mark.getBoundingClientRect()) });
      return;
    }
    if (Date.now() < this.suppressClickUntil) return;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    const box = this.scroller.getBoundingClientRect();
    const y = ev.clientY - box.top;
    const ratio = box.height > 0 ? y / box.height : 0.5;
    if (ratio < 0.3) this.prev();
    else if (ratio > 0.7) this.next();
  };

  private touchStartAt = 0;

  private onTouchStart = (ev: TouchEvent): void => {
    this.touchStartAt = ev.touches.length === 2 ? Date.now() : 0;
  };

  private onTouchEnd = (ev: TouchEvent): void => {
    if (!this.touchStartAt) return;
    const quick = Date.now() - this.touchStartAt <= 300;
    if (quick && ev.touches.length === 0) this.opts.onTwoFingerTap?.();
    this.touchStartAt = 0;
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
    try {
      const size = await this.doc.getPageSize(page);
      if (size.width !== this.sizes[page - 1]?.width || size.height !== this.sizes[page - 1]?.height) {
        this.sizes[page - 1] = size;
        el.style.width = `${Math.round(size.width * this.scale)}px`;
        el.style.height = `${Math.round(size.height * this.scale)}px`;
        this.recomputeOffsets();
      }
      const canvas = document.createElement('canvas');
      canvas.className = 'bzr-pdf-canvas';
      const layer = document.createElement('div');
      layer.className = 'textLayer';
      layer.dataset.page = String(page);
      el.replaceChildren(canvas, layer);
      const task = await this.doc.renderPage(page, canvas, this.scale, Math.min(2, window.devicePixelRatio || 1));
      this.tasks.set(page, task);
      await task.promise;
      this.tasks.delete(page);
      if (this.destroyed || !el.isConnected) return;
      try {
        await this.doc.renderTextLayer(page, layer, this.scale);
      } catch {
        /* 文字层失败仍然能看图，不要把整页判成失败 */
      }
      this.rendered.add(page);
      this.recency.set(page, ++this.recencySeq);
      this.paintAnnotations(page);
      void this.doc.getText(page).catch(() => undefined);
      this.trim();
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'RenderingCancelledException') return;
      this.failed.add(page);
      el.classList.add('is-failed');
      el.textContent = '';
      const tip = document.createElement('div');
      tip.className = 'bzr-pdf-page-error';
      tip.textContent = `第 ${page} 页渲染失败`;
      el.appendChild(tip);
      this.opts.onStall?.(`第 ${page} 页`);
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

  /* ── 标注 ── */

  private paintAnnotations(page: number): void {
    const el = this.pageEls[page - 1];
    if (!el) return;
    el.querySelectorAll('.bzr-pdf-annot-mark').forEach((node) => node.remove());
    const layer = el.querySelector('.textLayer') as HTMLElement | null;
    for (const [locator, annot] of this.annots) {
      if (annot.page !== page) continue;
      let rects = annot.rects ?? this.selectionRects.get(locator) ?? null;
      if (!rects && annot.quote && layer) {
        rects = this.quoteRects(layer, annot.quote);
        if (rects) annot.rects = rects;
      }
      if (!rects?.length) continue;
      for (const rect of rects) {
        const mark = document.createElement('div');
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

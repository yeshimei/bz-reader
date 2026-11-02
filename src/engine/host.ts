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
import { makeBook, View } from './foliate';
import type { FoliateBook, FoliateTOCItem, FoliateView } from '../types/foliate';
import { buildChapterCSS } from './theme';
import { makeTxtBook, countWords } from './txt';
import { DEFAULT_PREFS, FONT_SIZE_RANGE, type ReaderPrefs } from '../data/prefs';

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

export interface MountOptions {
  prefs: ReaderPrefs;
  onRelocate?: (info: RelocateInfo) => void;
  onReady?: (book: FoliateBook, meta: { title: string; author: string; wordCount: number }) => void;
  /** 单指轻触正文：左 / 中 / 右 */
  onTap?: (zone: 'left' | 'middle' | 'right') => void;
  /** 任何手势要求翻页（滚轮 / 双指横滑 / 按钮） */
  onTurn?: (dir: 'prev' | 'next') => void;
  /** 两指捏合或 Ctrl+滚轮要求改字号 */
  onFontSize?: (size: number) => void;
}

/** 滚轮累计到多少才翻一页（像素）。触控板一次轻扫约 30–60，鼠标滚轮一格约 100。 */
const WHEEL_TURN_THRESHOLD = 42;
/** 两次翻页之间的最小间隔，挡住「惯性滚一串」。 */
const WHEEL_COOLDOWN = 300;
/** 拖拽/滑动超过这个距离才算要翻页，短线抖动不算。 */
const SWIPE_MIN = 48;

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

  constructor(app: App) {
    this.app = app;
  }

  get isOpen(): boolean {
    return !!this.view;
  }

  get currentChapterIndex(): number {
    return this.chapterIndex;
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
    const wordCount = book.sections.reduce((sum, s) => sum + (s.size ?? 0), 0);
    return { book, meta: { title, author, wordCount } };
  }

  async mount(container: HTMLElement, vaultPath: string, opts: MountOptions): Promise<void> {
    await this.destroy();

    this.opts = opts;
    this.prefs = opts.prefs;
    this.container = container;

    const { book, meta } = await this.buildBook(vaultPath);
    this.book = book;

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
      this.chapterIndex = d.section?.current ?? this.chapterIndex;
      this.chapterTitle = d.tocItem?.label ?? this.chapterTitle;
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
      const { doc } = (e as CustomEvent).detail as { doc: Document };
      this.unbindDocGestures();
      this.bindGestures(doc);
    });

    container.appendChild(view);

    // iframe 之外的空白（页码栏、边距）也要吃滚轮
    this.bindOuterWheel(container);

    try {
      await view.open(book);
    } catch (err) {
      view.remove();
      this.view = null;
      this.book = null;
      throw new Error(`这本书打不开：${(err as Error)?.message || '格式不受支持'}`);
    }

    this.view = view;
    this.applyPrefs(this.prefs);
    opts.onReady?.(book, meta);
  }

  /**
   * 打开后定位。优先 CFI；CFI 解析不出来（换过文件、TXT 的 CFI 形状不同）
   * 就退回百分比——宁可差几页，也别每次打开都回到第一页。
   */
  async start(cfi?: string, fraction = 0): Promise<void> {
    const view = this.view;
    if (!view) return;

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

  /** 绑到 iframe 当前文档：点击三区 / 滚轮 / 鼠标拖拽 / 双指捏合 */
  private bindGestures(doc: Document): void {
    // ① 点击三区
    const onClick = (ev: MouseEvent): void => {
      if (Date.now() < this.suppressClickUntil) return;
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed) return;
      const target = ev.target as HTMLElement | null;
      if (target?.closest('a[href], [data-bzr-skip-tap]')) return;
      const width = doc.documentElement.clientWidth || 1;
      const x = ev.clientX;
      const zone = x < width * 0.3 ? 'left' : x > width * 0.7 ? 'right' : 'middle';
      this.opts.onTap?.(zone);
    };

    // ② 滚轮：iframe 内也要拦（外层的 wheel 传不进来）
    const onWheel = (ev: WheelEvent): void => this.handleWheel(ev);

    // ③ 鼠标拖拽横移 → 翻页。起手若落在选区上就不接管，避免和「划词」抢
    let dragX = 0;
    let dragY = 0;
    let dragging = false;
    const onPointerDown = (ev: PointerEvent): void => {
      if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed) return;
      dragX = ev.clientX;
      dragY = ev.clientY;
      dragging = true;
    };
    const onPointerUp = (ev: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      if (ev.pointerType !== 'mouse') return;
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed) return; // 拖出选区 = 想划词，不是想翻页
      const dx = ev.clientX - dragX;
      const dy = ev.clientY - dragY;
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      this.suppressClickUntil = Date.now() + 320;
      this.opts.onTurn?.(dx < 0 ? 'next' : 'prev');
    };

    // ④ 两指捏合改字号。foliate 自己的 touchmove 在两指时直接 return，
    //    所以这里不必担心和它的滑动逻辑打架
    const distance = (t: TouchList): number => {
      const a = t[0];
      const b = t[1];
      if (!a || !b) return 0;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    const onTouchStart = (ev: TouchEvent): void => {
      if (ev.touches.length !== 2) return;
      this.pinchStart = distance(ev.touches);
      this.pinchBase = this.prefs.fontSize;
    };
    const onTouchMove = (ev: TouchEvent): void => {
      if (ev.touches.length !== 2 || !this.pinchStart) return;
      ev.preventDefault();
      const ratio = distance(ev.touches) / this.pinchStart;
      const next = Math.min(
        FONT_SIZE_RANGE.max,
        Math.max(FONT_SIZE_RANGE.min, Math.round(this.pinchBase * ratio)),
      );
      if (next !== this.prefs.fontSize) this.opts.onFontSize?.(next);
    };
    const onTouchEnd = (ev: TouchEvent): void => {
      if (ev.touches.length < 2) this.pinchStart = 0;
    };

    doc.addEventListener('click', onClick);
    doc.addEventListener('wheel', onWheel, { passive: false });
    doc.addEventListener('pointerdown', onPointerDown);
    doc.addEventListener('pointerup', onPointerUp);
    doc.addEventListener('touchstart', onTouchStart, { passive: true });
    doc.addEventListener('touchmove', onTouchMove, { passive: false });
    doc.addEventListener('touchend', onTouchEnd);
    doc.addEventListener('touchcancel', onTouchEnd);

    this.docDetachers.push(() => {
      doc.removeEventListener('click', onClick);
      doc.removeEventListener('wheel', onWheel);
      doc.removeEventListener('pointerdown', onPointerDown);
      doc.removeEventListener('pointerup', onPointerUp);
      doc.removeEventListener('touchstart', onTouchStart);
      doc.removeEventListener('touchmove', onTouchMove);
      doc.removeEventListener('touchend', onTouchEnd);
      doc.removeEventListener('touchcancel', onTouchEnd);
    });
  }

  private unbindDocGestures(): void {
    for (const off of this.docDetachers.splice(0)) off();
  }

  /** 主题/字号/行距变化时调，只换样式不重开书 */
  applyPrefs(prefs: ReaderPrefs): void {
    this.prefs = prefs;
    const renderer = this.view?.renderer as unknown as { setStyles?: (css: string) => void } | undefined;
    renderer?.setStyles?.(buildChapterCSS(prefs));
  }

  async next(): Promise<void> {
    await this.view?.next();
  }

  async prev(): Promise<void> {
    await this.view?.prev();
  }

  /** 跳到 TOC 项（href 由 foliate 解析成章节 + 锚点） */
  async goToHref(href: string): Promise<void> {
    await this.view?.goTo(href);
  }

  async goToCfi(cfi: string): Promise<void> {
    if (!cfi) return;
    await this.view?.goTo(cfi);
  }

  /** 整书百分比跳转（移动端进度滑杆松手时用） */
  async goToPercent(fraction: number): Promise<void> {
    const view = this.view;
    if (!view) return;
    const f = Math.min(1, Math.max(0, fraction));
    await view.goToFraction(f).catch(() => undefined);
  }

  /**
   * 搜索。`chapterOnly` 只搜当前章节（基础版能力），关掉是全书（高级版）。
   * 底层是同一个 foliate 接口，区别只在传不传 index。
   */
  async search(
    query: string,
    opts: { chapterOnly?: boolean } = {},
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
          out.push({ cfi: sub.cfi, excerpt: sub.excerpt, chapterIndex: item.index ?? 0, chapterLabel: item.label ?? '' });
        }
      } else if (item.cfi) {
        out.push({ cfi: item.cfi, excerpt: item.excerpt ?? '', chapterIndex: this.chapterIndex, chapterLabel: '' });
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

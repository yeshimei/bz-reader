/* ============================================================
 * bz-reader · 引擎宿主（engine/host.ts）
 *
 * 把 foliate-js 包成一件事：给一个 vault 路径，出来一个能翻页的书。
 * 上层（阅读弹窗）不认识 foliate，只认识这里的方法与回调。
 *
 * 四条纪律：
 *  1. **引擎不碰数据层**：这里只回调进度，存不存、存哪由上层决定。
 *  2. **一次只开一本**：换书先 destroy，否则 iframe 与 ResizeObserver 会叠。
 *  3. **错误就地降级**：解析失败抛出去由上层弹提示，不静默吞成白屏。
 *  4. **点击翻页归宿主**：分页器只管手势滑动，点哪儿翻页是阅读器的事，
 *     写在这儿是因为只有它知道 iframe 的 document 什么时候换过。
 * ============================================================ */
import type { App } from 'obsidian';
import { makeBook, View } from './foliate';
import type { FoliateBook, FoliateTOCItem, FoliateView } from '../types/foliate';
import { buildChapterCSS } from './theme';
import { makeTxtBook, countWords } from './txt';
import { DEFAULT_PREFS, type ReaderPrefs } from '../data/prefs';

export interface RelocateInfo {
  /** 整书进度 0..1 */
  percent: number;
  cfi: string;
  chapterIndex: number;
  chapterTitle: string;
  sectionCurrent: number;
  sectionTotal: number;
  /** 剩余阅读时间（秒，foliate 按 1500 字节/秒估） */
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
  /** 单指点击正文：左 / 中 / 右 */
  onTap?: (zone: 'left' | 'middle' | 'right') => void;
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
  private detachTap: (() => void) | null = null;

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

    // 每次换章都会来一个 load：点击翻页的监听挂在当前文档上，旧文档随 iframe 一起丢弃
    view.addEventListener('load', (e) => {
      const { doc } = (e as CustomEvent).detail as { doc: Document };
      this.bindTap(doc);
    });

    container.appendChild(view);

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

  /** 左右三区点击：左 30% 上一页、右 30% 下一页、中间唤出/收起工具栏 */
  private bindTap(doc: Document): void {
    this.detachTap?.();
    const onClick = (ev: MouseEvent): void => {
      // 正在选字 / 点的是链接、脚注，一律让给书籍本身处理
      const sel = doc.getSelection();
      if (sel && !sel.isCollapsed) return;
      const target = ev.target as HTMLElement | null;
      if (target?.closest('a[href], [data-bzr-skip-tap]')) return;
      const width = doc.documentElement.clientWidth || 1;
      const x = ev.clientX;
      const zone = x < width * 0.3 ? 'left' : x > width * 0.7 ? 'right' : 'middle';
      this.opts.onTap?.(zone);
    };
    doc.addEventListener('click', onClick);
    this.detachTap = () => doc.removeEventListener('click', onClick);
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
    this.detachTap?.();
    this.detachTap = null;
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
  }
}

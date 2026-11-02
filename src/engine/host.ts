/* ============================================================
 * bz-reader · 引擎宿主（engine/host.ts）
 *
 * 把 foliate-js 包成一件事：给一个 vault 路径，出来一个能翻页的书。
 * 上层（阅读弹窗）不认识 foliate，只认识这里的方法与回调。
 *
 * 三条纪律：
 *  1. **引擎不碰数据层**：这里只回调进度，存不存、存哪由上层决定。
 *  2. **一次只开一本**：换书先 destroy，否则 iframe 与 ResizeObserver 会叠。
 *  3. **错误就地降级**：解析失败抛出去由上层弹提示，不静默吞成白屏。
 * ============================================================ */
import type { App } from 'obsidian';
import { makeBook, View } from './foliate';
import type { FoliateBook, FoliateTOCItem, FoliateView } from '../types/foliate';
import { buildChapterCSS, themeFromHost, type ReaderTheme } from './theme';

let viewDefined = false;

/** foliate 的 View 是自定义元素，全局只能 define 一次（重复 define 会抛） */
function ensureViewDefined(): void {
  if (viewDefined) return;
  if (!customElements.get('foliate-view')) {
    customElements.define('foliate-view', View as unknown as CustomElementConstructor);
  }
  viewDefined = true;
}

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

export interface MountOptions {
  onRelocate?: (info: RelocateInfo) => void;
  onReady?: (book: FoliateBook) => void;
  /** 书内链接被点（章节跳转由引擎自己处理过了，这里只收外链） */
  onExternalLink?: (href: string) => void;
}

export class EngineHost {
  private app: App;
  private view: FoliateView | null = null;
  private book: FoliateBook | null = null;
  private container: HTMLElement | null = null;
  private theme: ReaderTheme;
  private opts: MountOptions = {};
  private chapterIndex = 0;
  private chapterTitle = '';

  constructor(app: App, theme?: Partial<ReaderTheme>) {
    this.app = app;
    this.theme = { ...themeFromHost(), fontSize: 18, lineHeight: 1.8, margin: 32, fontFamily: '', ...theme };
  }

  get isOpen(): boolean {
    return !!this.view;
  }

  /** 当前书的 TOC（打开前返回空） */
  toc(): FoliateTOCItem[] {
    return this.book?.toc ?? [];
  }

  /** 读 vault 文件 → File。必须整份读进内存：foliate 的 zip loader 需要 seek。 */
  private async readAsFile(vaultPath: string): Promise<File> {
    const buf = await this.app.vault.adapter.readBinary(vaultPath);
    const name = vaultPath.split('/').pop() || 'book.epub';
    return new File([buf], name);
  }

  async mount(container: HTMLElement, vaultPath: string, opts: MountOptions = {}): Promise<FoliateBook> {
    ensureViewDefined();
    await this.destroy();

    this.opts = opts;
    this.container = container;

    const file = await this.readAsFile(vaultPath);
    const book = await makeBook(file);
    this.book = book;

    const view = document.createElement('foliate-view') as unknown as FoliateView;
    view.className = 'bzr-view';
    view.addEventListener('relocate', (e) => {
      const d = (e as CustomEvent).detail as {
        fraction?: number;
        section?: { current: number; total: number };
        time?: { total: number };
        tocItem?: FoliateTOCItem | null;
      };
      const percent = typeof d.fraction === 'number' ? Math.min(1, Math.max(0, d.fraction)) : 0;
      this.chapterIndex = d.section?.current ?? 0;
      this.chapterTitle = d.tocItem?.label ?? this.chapterTitle;
      this.opts.onRelocate?.({
        percent,
        cfi: view.lastLocation?.cfi ?? '',
        chapterIndex: this.chapterIndex,
        chapterTitle: this.chapterTitle,
        sectionCurrent: d.section?.current ?? 0,
        sectionTotal: d.section?.total ?? 0,
        remainingSeconds: Math.round(d.time?.total ?? 0),
      });
    });

    container.appendChild(view);

    try {
      await view.open(book);
    } catch (e) {
      view.remove();
      this.view = null;
      this.book = null;
      throw new Error(`这本书打不开：${(e as Error)?.message || '格式不受支持'}`);
    }

    this.view = view;
    this.applyTheme();
    this.opts.onReady?.(book);
    return book;
  }

  /** 打开后定位（首次打开用上次的 CFI；没有就从头开始） */
  async start(cfi?: string): Promise<void> {
    const view = this.view;
    if (!view) return;
    await view.init({ lastLocation: cfi || undefined, showTextStart: !cfi });
  }

  /** 主题/字号/行距变化时调，只换样式不重开书 */
  applyTheme(patch?: Partial<ReaderTheme>): void {
    if (patch) this.theme = { ...this.theme, ...patch };
    const view = this.view;
    if (!view?.renderer) return;
    view.renderer.setStyles(buildChapterCSS(this.theme));
  }

  getTheme(): ReaderTheme {
    return this.theme;
  }

  async next(): Promise<void> {
    await this.view?.next();
  }

  async prev(): Promise<void> {
    await this.view?.prev();
  }

  /** 跳转到整书百分比 */
  async goToFraction(frac: number): Promise<void> {
    await this.view?.goToFraction(Math.min(1, Math.max(0, frac)));
  }

  /** 跳到 TOC 项 */
  async goToHref(href: string): Promise<void> {
    await this.view?.goTo(href);
  }

  async destroy(): Promise<void> {
    const view = this.view;
    this.view = null;
    this.book = null;
    if (!view) return;
    try {
      view.close();
    } catch {
      /* 已卸载的书再 close 会抛，忽略 */
    }
    view.remove();
  }
}

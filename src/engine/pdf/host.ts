/* ============================================================
 * bz-reader · PDF 引擎宿主（engine/pdf/host.ts）
 *
 * 把「一本 PDF」包成 ReaderEngine。视图层不认识 pdf.js，也不认识 canvas：
 * 它只发翻页/跳转/搜索/标注这些动作，拿回文本与位置。
 *
 * 与 EPUB 宿主的差别都在语义上：
 *   · chapterIndex / chapterTitle 实际是「页」——目录、进度、状态栏都用页号；
 *   · CFI 换成 `pdf/<页>` 定位串（见 locator.ts），深链与划线的存储不变；
 *   · 没有脚注、没有竖排、没有章内锚点。
 * ============================================================ */

import type { App } from 'obsidian';
import type { EngineMeta } from '../../data/book-meta';
import { collectPdfBacklinks, pdfBacklinkHits } from '../../data/pdf-backlink';
import type { ReaderPrefs } from '../../data/prefs';
import type { FoliateBook, FoliateTOCItem } from '../../types/foliate';
import { OpenCancelledError, type HostAnnotation, type MountOptions, type SearchHit } from '../host';
import type { ReaderEngine } from '../reader-engine';
import { PdfDocument } from './document';
import { pdfPageLocator } from './locator';
import { searchPageTexts } from './search';
import { PdfView } from './view';

export class PdfEngineHost implements ReaderEngine {
  readonly isPdf = true;
  /** 首页没有文字 = 纯扫描件；划词、搜索都没有素材 */
  isScanned = false;
  readonly contentVertical = false;
  readonly contentRtl = false;
  readonly probe = { binds: 0, taps: 0, blocked: 0 };

  private readonly app: App;
  private doc: PdfDocument | null = null;
  private view: PdfView | null = null;
  private opts: MountOptions | null = null;
  private prefs: ReaderPrefs | null = null;
  private tocItems: FoliateTOCItem[] = [];
  private meta: EngineMeta = {};
  private phase = 'idle';
  private destroyed = false;

  constructor(app: App) {
    this.app = app;
  }

  get loadPhase(): string {
    return this.phase;
  }

  get pageKey(): string {
    return this.view?.pageKey ?? 'pdf:1';
  }

  async mount(container: HTMLElement, vaultPath: string, opts: MountOptions): Promise<void> {
    await this.destroy();
    this.destroyed = false;
    this.opts = opts;
    this.prefs = opts.prefs;
    this.phase = 'read';

    /* PDF 必须整份进内存：pdf.js 的 range 读取在 Obsidian 的 adapter 上
       没有稳定的 seek 抽象，分段读反而会把 IPC 打满。 */
    const buf = await this.app.vault.adapter.readBinary(vaultPath);
    if (this.destroyed) throw new OpenCancelledError();
    this.phase = 'parse';
    this.doc = await PdfDocument.load(new Uint8Array(buf.slice(0)));
    this.tocItems = (await this.doc.getToc()) as FoliateTOCItem[];
    this.meta = await this.buildMeta(vaultPath);
    if (this.destroyed) {
      await this.doc.destroy();
      this.doc = null;
      throw new OpenCancelledError();
    }

    this.phase = 'render';
    const doc = this.doc;
    this.view = new PdfView(doc, {
      onRelocate: (info) => {
        if (this.phase !== 'ready') this.phase = 'ready';
        opts.onRelocate?.(info);
      },
      onSelect: (info) => opts.onSelect?.(info),
      onAnnotTap: (info) => opts.onAnnotTap?.({ cfiRange: info.locator, anchor: info.anchor }),
      onTwoFingerTap: () => opts.onTwoFingerTap?.(),
      onStall: (what) => opts.onStall?.(what),
    });
    await this.view.mount(container);
    if (this.destroyed) return;

    /* 反链：笔记里引用了这本书的位置，打开时直接标在页面上。
       索引坏了 / 大库里第一次扫得慢都不该挡住看书，所以整段包在 try 里。 */
    try {
      this.view.setBacklinks(pdfBacklinkHits(collectPdfBacklinks(this.app, vaultPath)));
    } catch (err) {
      console.warn('[bz-reader] PDF 反链读取失败：', err);
    }

    /* 扫描件判定：首页一个字都没有，划词、搜索、朗读全都无从下手。
       宿主据此先说明一句，别让用户以为是插件坏了。 */
    try {
      const first = await this.doc.getText(1);
      this.isScanned = !String(first ?? '').trim();
    } catch {
      this.isScanned = false;
    }

    /* 视图层拿到一个「书」的形状做封面/元数据回填；PDF 的 sections 为空，
       getCover 走 pdf.js 渲染首页。 */
    const bookLike: FoliateBook = {
      metadata: { title: this.meta.title, author: this.meta.author },
      sections: [],
      getCover: () => doc.renderCover(600),
    };
    this.phase = 'ready';
    opts.onReady?.(bookLike, this.meta);
  }

  async start(cfi?: string, fraction = 0): Promise<void> {
    await this.view?.start(cfi, fraction);
    this.phase = 'ready';
  }

  async next(): Promise<void> {
    this.view?.next();
  }

  async prev(): Promise<void> {
    this.view?.prev();
  }

  async goToPercent(fraction: number): Promise<void> {
    this.view?.goToPercent(fraction);
  }

  async goToCfi(cfi: string): Promise<boolean> {
    return this.view?.goToLocator(cfi) ?? false;
  }

  async goToHref(href: string): Promise<void> {
    this.view?.goToLocator(href);
  }

  async goToChapter(title: string): Promise<boolean> {
    const href = findTocHref(this.tocItems, title);
    if (!href) return false;
    return this.view?.goToLocator(href) ?? false;
  }

  toc(): FoliateTOCItem[] {
    return this.tocItems;
  }

  currentChapterHref(): string {
    return pdfPageLocator(this.view?.page ?? 1);
  }

  currentText(): string {
    return this.view?.currentText() ?? '';
  }

  async exportChapters(
    opts: {
      onProgress?: (done: number, total: number, title: string) => void;
      shouldStop?: () => boolean;
    } = {},
  ): Promise<Array<{ title: string; text: string }>> {
    const doc = this.doc;
    if (!doc) return [];
    const out: Array<{ title: string; text: string }> = [];
    for (let page = 1; page <= doc.numPages; page += 1) {
      if (opts.shouldStop?.()) break;
      const title = `第 ${page} 页`;
      const text = await doc.getText(page);
      if (text.trim()) out.push({ title, text });
      opts.onProgress?.(page, doc.numPages, title);
    }
    return out;
  }

  async search(kw: string, opts: { shouldStop?: () => boolean } = {}): Promise<SearchHit[]> {
    const doc = this.doc;
    if (!doc) return [];
    const pages: Array<{ page: number; text: string }> = [];
    for (let page = 1; page <= doc.numPages; page += 1) {
      if (opts.shouldStop?.()) break;
      pages.push({ page, text: await doc.getText(page) });
    }
    return searchPageTexts(pages, kw, 200).map((hit) => ({
      cfi: pdfPageLocator(hit.page),
      excerpt: `${hit.excerpt.pre}${hit.excerpt.match}${hit.excerpt.post}`,
    }));
  }

  clearSearch(): void {
    /* PDF 的搜索命中不画在页面上，没有需要清的高亮 */
  }

  setAnnotations(list: HostAnnotation[]): void {
    this.view?.setAnnotations(list.map((item) => ({ cfiRange: item.cfiRange, color: item.color, text: item.text })));
  }

  clearSelection(): void {
    this.view?.clearSelection();
  }

  refreshTheme(): void {
    this.view?.refreshTheme();
  }

  applyPrefs(prefs: ReaderPrefs): void {
    this.prefs = prefs;
    this.view?.applyPrefs();
  }

  clearPulse(): void {
    /* 落点闪烁是一次性的，div 自己 1 秒后移除；这里只需提供空实现 */
  }

  async pulseAt(cfi: string): Promise<void> {
    await this.view?.pulseAt(cfi);
  }

  setViewportWidth(width: number, _left = 0): void {
    this.view?.setViewportWidth(width);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.view?.destroy();
    this.view = null;
    const doc = this.doc;
    this.doc = null;
    this.tocItems = [];
    this.phase = 'idle';
    if (doc) await doc.destroy();
    void this.prefs;
  }

  /** 元数据：PDF 的 info 字典 + XMP。没有字数概念，给 0 */
  private async buildMeta(vaultPath: string): Promise<EngineMeta> {
    const name = (vaultPath.split('/').pop() || 'book').replace(/\.[^.]+$/, '');
    const doc = this.doc;
    if (!doc) return { title: name, chapterCount: 0, wordCount: 0 };
    const raw = await doc.getMetadata();
    return {
      title: raw.title || name,
      author: raw.author,
      description: raw.subject,
      publishDate: raw.creationDate,
      chapterCount: doc.numPages,
      wordCount: 0,
    };
  }
}

/** 目录里按章名找 href（AI 侧栏的「来源」回跳用） */
function findTocHref(items: readonly FoliateTOCItem[] | undefined, title: string): string | null {
  const target = String(title ?? '').trim();
  if (!target) return null;
  for (const item of items ?? []) {
    if ((item.label ?? '').trim() === target && item.href) return item.href;
    const sub = findTocHref(item.subitems, target);
    if (sub) return sub;
  }
  return null;
}

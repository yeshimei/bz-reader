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

import type { App, EventRef } from 'obsidian';
import type { PdfUi } from '../reader-engine';
import { normalizePath } from 'obsidian';
import { notify } from '../../core/notice';
import type { EngineMeta } from '../../data/book-meta';
import { collectPdfBacklinks, invalidatePdfBacklinks, pdfBacklinkHits } from '../../data/pdf-backlink';
import { pdfDisplayLabel } from '../../data/pdf-link';
import type { ReaderPrefs } from '../../data/prefs';
import { t } from '../../i18n';
import type { FoliateBook, FoliateTOCItem } from '../../types/foliate';
import { OpenCancelledError, type HostAnnotation, type MountOptions, type SearchHit } from '../host';
import type { ReaderEngine } from '../reader-engine';
import { PdfDocument } from './document';
import { parsePdfLocator, pdfPageLocator } from './locator';
import { pdfHitLocator, searchPageTexts } from './search';
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
  /** 这本书在库里的路径：反链要按它查，索引变动后也要靠它重算 */
  private bookPath = '';
  /** 链接索引事件：书关掉必须摘掉，否则刷到已经销毁的视图上 */
  private resolvedRef: EventRef | null = null;
  private backlinkTimer: number | null = null;

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
    /* 直接把这块内存交给 pdf.js：buf 是 readBinary 刚读出来的、之后没人再用，
       再 slice 一份只是让几百 MB 的扫描件在解析期多占一倍内存。 */
    this.doc = await PdfDocument.load(new Uint8Array(buf));
    this.tocItems = await this.doc.getToc();
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
      onViewState: (state) => opts.onPdfViewState?.(state),
      onExportPage: (page) => this.exportPage(page, vaultPath),
      onCopy: (kind) =>
        opts.onPdfCopy?.(kind, {
          page: this.view?.page ?? 1,
          offset: this.view?.currentViewOffset() ?? { left: 0, top: 0, zoom: 1 },
        }),
      onBacklinkTap: (info) => opts.onPdfBacklinkTap?.(info),
      onFileAnnotTap: (info) => opts.onPdfFileAnnotTap?.(info),
      onFlowChange: (mode) => opts.onPdfFlow?.(mode),
      onHistoryChange: (count) => opts.onHistoryChange?.(count),
      /* PDF 组的三项偏好：缩放档只在开书时读，两个开关随时读 */
      pdfPrefs: () => ({
        zoom: this.prefs?.pdfZoom ?? 'auto',
        annots: this.prefs?.pdfAnnots !== false,
        backlinks: this.prefs?.pdfBacklinks !== false,
      }),
      /* 缩略图拖到笔记：引擎只给「这条链接长什么样」，怎么显示由设置决定 */
      linkForPage: (page) => {
        const mode = this.prefs?.pdfLinkLabel ?? 'text';
        const label = pdfDisplayLabel(mode, { title: this.meta.title, page });
        return `[[${this.bookPath}#page=${page}|${label}]]`;
      },
    });
    await this.view.mount(container);
    if (this.destroyed) return;

    /* 页标签：论文前置页是 i、ii…，页脚与链接别名都该按书自己的说法 */
    void doc.getPageLabels().then((labels) => {
      if (!this.destroyed) this.view?.setPageLabels(labels);
    });

    /* 反链：笔记里引用了这本书的位置，打开时直接标在页面上。
       索引坏了 / 大库里第一次扫得慢都不该挡住看书，所以整段包在 try 里。 */
    this.bookPath = vaultPath;
    this.refreshBacklinks();
    /* 书开着的时候新写一条引用链接，框应该自己冒出来——只在开书时算一次，
       用户会以为功能坏了。索引一变动就重算，防抖 600ms 挡掉批量改名。 */
    try {
      this.resolvedRef = this.app.metadataCache.on('resolved', () => {
        if (this.destroyed) return;
        invalidatePdfBacklinks();
        if (this.backlinkTimer !== null) window.clearTimeout(this.backlinkTimer);
        this.backlinkTimer = window.setTimeout(() => {
          this.backlinkTimer = null;
          if (!this.destroyed) this.refreshBacklinks();
        }, 600);
      });
    } catch (err) {
      console.warn('[bz-reader] PDF 反链事件注册失败：', err);
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

  /** 打开书时还原上次的视角（旋转 / 双页）。没有记录就保持默认 */
  restorePdfView(state: { rotation?: number; spread?: boolean } | null | undefined): void {
    this.view?.restoreView(state);
  }

  /**
   * 导出某一页为 PNG，存进库内 `_导出/` 目录（与书同级的子目录）。
   *
   * 不进 Obsidian 的 attachments 配置：那套设置是全局的，用户可能把它指向
   * 一个完全不相干的目录，导出的图会散落在别处。
   */
  private async exportPage(page: number, vaultPath: string): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    try {
      /* 倍率走设置页（1×/2×/3×）：1× 放大了糊，3× 长文档会几十 MB */
      const blob = await doc.renderPng(page, this.prefs?.pdfExportScale ?? 2);
      if (!blob) {
        notify(t('notice.pdf.exportFailed'), 'error');
        return;
      }
      const path = await this.writePageImage(blob, page, vaultPath);
      if (path) notify(t('notice.pdf.exported', { path }), 'success');
      else notify(t('notice.pdf.exportFailed'), 'error');
    } catch (err) {
      console.warn('[bz-reader] PDF export failed:', err);
      notify(t('notice.pdf.exportFailed'), 'error');
    }
  }

  private async writePageImage(blob: Blob, page: number, vaultPath: string): Promise<string | null> {
    try {
      const cut = vaultPath.lastIndexOf('/');
      const dir = cut > 0 ? vaultPath.slice(0, cut) : '';
      const folder = dir ? `${dir}/_导出` : '_导出';
      const raw = String(this.meta.title || vaultPath.split('/').pop() || 'pdf');
      const base =
        raw
          .replace(/\.[^.]+$/, '')
          /* 文件名里的非法字符与 Obsidian 的链接字符一起换掉：留着 # 或 [ ]
             会让导出文件在双链里变成断链 */
          .replace(/[\\/:*?"<>|#^[\]]/g, '_')
          .trim()
          .slice(0, 60) || 'pdf';
      const target = normalizePath(`${folder}/${base}-p${page}.png`);
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(folder))) await adapter.mkdir(folder).catch(() => undefined);
      await adapter.writeBinary(target, await blob.arrayBuffer());
      return target;
    } catch (err) {
      console.warn('[bz-reader] PDF export failed:', err);
      return null;
    }
  }

  /**
   * 头栏 / 快捷键要的这一套 PDF 动作。
   *
   * 每次现取一个新的壳：里面的每个动作都直接打到当前的 view 上，
   * 缓存住对象反而会在「切书后重挂」时指向旧视图。
   *
   * 「回到上一处」不在这张表里（2026-11-10）：EPUB 也补上了同一条历史，
   * 两边共用 `historyUi`。
   */
  get pdfUi(): PdfUi | undefined {
    const view = this.view;
    if (!view) return undefined;
    return {
      rotation: () => view.rotation,
      spread: () => view.isSpread,
      paged: () => view.isPaged,
      zoomIn: () => view.zoomIn(),
      zoomOut: () => view.zoomOut(),
      fitWidth: () => view.setFitMode('width'),
      fitPage: () => view.setFitMode('page'),
      rotate: (deg) => view.setRotation(deg),
      setSpread: (on) => view.setSpread(on),
      /* 翻页 / 滚动是全局偏好（和 EPUB 同一项）：命令面板与排版面板都从这儿走，
         只改视图不落盘的话，换本书又退回旧值。 */
      setPaged: (on) => {
        view.setPaged(on);
        this.opts?.onPdfFlow?.(on ? 'paged' : 'scroll');
      },
      toggleLayout: () => view.toggleLayoutPanel(),
      toggleThumbs: () => view.toggleThumbsPanel(),
      openCopyMenu: (anchor) => view.toggleCopyMenu(anchor),
      exportPage: () => void view.exportCurrentPage(),
      copyLink: (kind) =>
        this.opts?.onPdfCopy?.(kind, {
          page: view.page,
          offset: view.currentViewOffset(),
        }),
    };
  }

  /**
   * 跳转历史：PDF 的栈本来就在 view 里（点目录 / 链接之前记一手），这里只转发。
   * 与 EPUB 的 `EngineHost.historyUi` 同一形状，视图层不用分格式。
   */
  get historyUi() {
    const view = this.view;
    if (!view) return undefined;
    return {
      back: () => void view.back(),
      canBack: () => view.canBack,
    };
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
    /* 页文本与文字层映射一起取：命中要写 `pdf/页/起-止`，而那个区间
       必须是文字层坐标，不能用搜索文本里的下标（差在补出来的空格上）。 */
    const layerIndex = new Map<number, number[]>();
    for (let page = 1; page <= doc.numPages; page += 1) {
      if (opts.shouldStop?.()) break;
      const layout = await doc.getTextLayout(page);
      pages.push({ page, text: layout.text });
      layerIndex.set(page, layout.layerIndex);
    }
    /* 命中也要落到页面上：点一条结果跳过去，整页字里得能看见自己在找什么 */
    this.view?.setSearchQuery(kw);
    return searchPageTexts(pages, kw).hits.map((hit) => ({
      cfi: pdfHitLocator(hit, layerIndex.get(hit.page) ?? []),
      excerpt: `${hit.excerpt.pre}${hit.excerpt.match}${hit.excerpt.post}`,
    }));
  }

  clearSearch(): void {
    this.view?.clearSearchHighlight();
  }

  /**
   * 跨书搜索跳过来时，只标词不重扫（重扫要好几秒）。
   *
   * 带 `locator` 时连「点中的是哪一处」一起给：同一页有好几个命中，
   * 不指定就只能全标，用户看不出自己点的是哪一条。
   */
  highlightQuery(kw: string, locator?: string): void {
    const next = String(kw ?? '').trim();
    if (!next) return;
    const target = locator ? parsePdfLocator(locator) : null;
    const focus = target && target.end > target.start ? target : null;
    this.view?.setSearchQuery(next, focus);
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
    /* 排版偏好对 PDF 没意义，只有「翻页 / 滚动」要跟着走 */
    this.view?.setPaged(prefs.flow === 'paged');
    /* 批注 / 反链两个开关改完要立刻生效，不能等翻页才重画 */
    this.view?.refreshPdfPrefs();
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
    if (this.backlinkTimer !== null) {
      window.clearTimeout(this.backlinkTimer);
      this.backlinkTimer = null;
    }
    if (this.resolvedRef) {
      try {
        this.app.metadataCache.offref(this.resolvedRef);
      } catch {
        /* 插件已卸载时 metadataCache 可能已经收摊 */
      }
      this.resolvedRef = null;
    }
    this.view?.destroy();
    this.view = null;
    const doc = this.doc;
    this.doc = null;
    this.tocItems = [];
    this.phase = 'idle';
    if (doc) await doc.destroy();
    void this.prefs;
  }

  /**
   * 重算反链并推给两处：页面上画框（视图自己画），侧栏列清单（回调给上层）。
   *
   * 收藏了 `collectPdfBacklinks` 的缓存：同一本书连续开关只扫一次索引，
   * 链接有变动时由 `invalidatePdfBacklinks` 作废（见上面的 resolved 事件）。
   */
  private refreshBacklinks(): void {
    if (this.destroyed || !this.bookPath) return;
    try {
      const hits = pdfBacklinkHits(collectPdfBacklinks(this.app, this.bookPath));
      this.view?.setBacklinks(hits);
      this.opts?.onPdfBacklinks?.(
        hits.map((hit) => ({
          page: hit.page,
          sourcePath: hit.sourcePath,
          label: hit.label,
          color: hit.color,
        })),
      );
    } catch (err) {
      console.warn('[bz-reader] PDF 反链读取失败：', err);
    }
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

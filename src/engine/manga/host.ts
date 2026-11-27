/* ============================================================
 * bz-reader · 漫画引擎宿主（engine/manga/host.ts）
 *
 * 把「一本 CBZ」包成 ReaderEngine。视图层不认识 zip，也不认识 canvas：
 * 它只发翻页 / 跳转 / 搜索这些动作，拿回进度与位置。
 *
 * 与 PDF 宿主同一套约定：
 *   · chapterIndex / chapterTitle 实际是「原图序号 / 话名」；
 *   · CFI 换成 `manga/<原图序号>[/<格序号>]` 定位串；
 *   · 没有文字层：搜索、导出章节、朗读取文都返回空，不假装能读。
 *
 * 一个刻意的取舍：readBinary 一次拿到整块 ArrayBuffer（zip 的中央目录在
 * 文件尾，Obsidian 的 adapter 没有 range 读取），但**只按需解压眼前那张
 * 图**，不整本解压、不整本转 base64。手机上不会为一张封面付整本的代价。
 * ============================================================ */
import type { App } from 'obsidian';
import type { EngineMeta } from '../../data/book-meta';
import type { ReaderPrefs } from '../../data/prefs';
import type { FoliateBook, FoliateTOCItem } from '../../types/foliate';
import type { HostAnnotation, MountOptions, SearchHit } from '../host';
import type { HistoryUi, MangaUi, ReaderEngine } from '../reader-engine';
import { ComicArchive, comicInfoName, imageMime, isImageName, type MangaSource } from './archive';
import {
  DEFAULT_MANGA_PREFS,
  mangaSettingsOf,
  normalizeMangaPrefs,
  normalizeMangaView,
  resolveDirection,
  type MangaPrefs,
  type MangaViewState,
} from './settings';
import {
  parseMangaLocator,
  readingDirectionFromComicInfo,
  sortPageNames,
  type MangaDirection,
} from './layout';
import { MangaView, type MangaInput } from './view';
import { NavHistory } from '../../core/nav-history';
import { isMobileShell } from '../../core/mobile';

/** 文件夹形式的漫画：一个目录就是一卷，目录里的图片自然序排页 */
export class FolderArchive implements MangaSource {
  readonly pages: string[];
  readonly groups: Array<{ label: string; page: number }> = [];
  private readonly app: App;
  private readonly dir: string;

  constructor(app: App, dir: string, pages: string[]) {
    this.app = app;
    this.dir = dir.replace(/\/$/, '');
    this.pages = pages;
  }

  get count(): number { return this.pages.length; }

  async blob(name: string): Promise<Blob | null> {
    if (!this.pages.includes(name)) return null;
    try {
      const buf = await this.app.vault.adapter.readBinary(`${this.dir}/${name}`);
      return new Blob([buf], { type: imageMime(name) });
    } catch { return null; }
  }

  async text(_name: string): Promise<string> { return ''; }
  async cover(): Promise<Blob | null> {
    return this.pages.length ? this.blob(this.pages[0]) : null;
  }
}

export class MangaEngineHost implements ReaderEngine {
  readonly isPdf = false;
  readonly isManga = true;
  readonly isScanned = true;
  readonly probe = { binds: 0, taps: 0, blocked: 0 };
  readonly contentVertical = false;

  private readonly app: App;
  private source: MangaSource | null = null;
  private view: MangaView | null = null;
  private opts: MountOptions | null = null;
  private mangaPrefs: MangaPrefs = DEFAULT_MANGA_PREFS;
  /** 本里当前生效的那几项（用户调一次就更新）：设置页改全局时靠它保住 */
  private viewState: MangaViewState = {};
  /** 传给视图的输入开关：同一个引用，设置面板改了立刻生效 */
  private readonly input: MangaInput = { mobile: isMobileShell(), desktopTurn: false };
  private direction: MangaDirection = 'rtl';
  /** ComicInfo.xml 标的方向：applyPrefs 重算时必须带着它，否则被默认值冲掉 */
  private comicDir: MangaDirection | null = null;
  private tocItems: FoliateTOCItem[] = [];
  private meta: EngineMeta = {};
  private phase = 'idle';
  private destroyed = false;
  private page = 0;
  private readonly history = new NavHistory();

  constructor(app: App) {
    this.app = app;
  }

  get contentRtl(): boolean { return this.direction === 'rtl'; }
  get loadPhase(): string { return this.phase; }
  get pageKey(): string { return `manga:${this.page + 1}`; }

  /**
   * 漫画的动作面（排版面板 + 缩略图）。
   *
   * 与 `pdfUi` 同一条约定：**现取，不缓存**。视图在 `destroy()` 里被置空，
   * 闭包里抓着旧视图就会往一块已经摘掉的 DOM 上挂面板。
   */
  get mangaUi(): MangaUi | undefined {
    const view = this.view;
    if (!view) return undefined;
    return {
      toggleLayout: (anchor) => view.toggleLayoutPanel(anchor),
      toggleThumbs: () => view.toggleThumbs(),
    };
  }

  async mount(container: HTMLElement, vaultPath: string, opts: MountOptions): Promise<void> {
    await this.destroy();
    this.destroyed = false;
    this.opts = opts;
    this.comicDir = null;
    const stored = normalizeMangaPrefs(opts.prefs.manga);
    this.mangaPrefs = stored;
    this.input.desktopTurn = opts.prefs.desktopTapTurn === true;
    this.phase = 'read';
    /* 上层先画了「正在打开…」占位；漫画视图自己接管整个容器，
       不清掉的话那条加载态会一直留在 DOM 里（2026-11-22 真机发现）。 */
    container.replaceChildren();

    const adapter = this.app.vault.adapter;
    const isFolder = await adapter.exists(vaultPath).then(async (yes) => {
      if (!yes) return false;
      try { return (await adapter.list(vaultPath)).files.length > 0; } catch { return false; }
    });

    let archive: MangaSource;
    let comicDir: MangaDirection | null = null;
    if (isFolder) {
      const listed = await adapter.list(vaultPath);
      /* 自然序：字典序会把 p10.jpg 排到 p2.jpg 前面，整卷从第二页起全错位 */
      const files = sortPageNames(listed.files
        .filter((p) => isImageName(p))
        .map((p) => p.split('/').pop() || p));
      if (!files.length) throw new Error('no images in comic folder');
      archive = new FolderArchive(this.app, vaultPath, files);
    } else {
      const buf = await adapter.readBinary(vaultPath);
      if (this.destroyed) return;
      this.phase = 'parse';
      const zip = new ComicArchive(buf);
      if (!zip.count) throw new Error('no images in comic archive');
      archive = zip;
      /* ComicInfo.xml 只解这一个文本文件，不扫整本 */
      const infoName = comicInfoName(zip.entries);
      if (infoName) comicDir = readingDirectionFromComicInfo(await zip.text(infoName));
    }
    this.source = archive;
    this.comicDir = comicDir;

    const saved = normalizeMangaView(opts.mangaView);
    this.viewState = saved;
    this.mangaPrefs = mangaSettingsOf(stored, saved);
    this.direction = resolveDirection(this.mangaPrefs.direction, comicDir);

    const groups = archive.groups;
    this.tocItems = groups.length
      ? groups.map((g) => ({ label: g.label, href: `manga/${g.page}` }))
      : archive.pages.map((name, i) => ({
          label: name.split('/').pop() || name,
          href: `manga/${i}`,
        }));

    const name = vaultPath.split('/').filter(Boolean).pop() || 'comic';
    this.meta = {
      title: name.replace(/\.[^.]+$/, ''),
      chapterCount: archive.pages.length,
      wordCount: 0,
    };

    this.phase = 'render';
    this.view = new MangaView(container, archive, this.mangaPrefs, this.input, {
      onRelocate: (info) => {
        if (this.phase !== 'ready') this.phase = 'ready';
        this.page = info.page;
        opts.onRelocate?.({
          percent: info.percent,
          cfi: info.cfi,
          chapterIndex: info.chapterIndex,
          chapterTitle: info.chapterTitle,
          chapterHref: `manga/${info.page}`,
          sectionCurrent: info.screen + 1,
          sectionTotal: info.screens,
          pageInChapter: info.screen + 1,
          pagesInChapter: info.screens,
          bookPage: info.page + 1,
          bookPages: info.total,
          remainingSeconds: 0,
        });
      },
      onViewState: (state) => {
        this.mangaPrefs = { ...this.mangaPrefs, ...state };
        /* 本里的人调一次就记一次：设置页随后改全局偏好时，applyPrefs
           要拿这份合并，而不是开书时的老快照 */
        this.viewState = { ...this.viewState, ...state };
        opts.onMangaViewState?.(state);
      },
      onTurn: (dir) => { void this.turn(dir); },
      onReady: () => {
        const bookLike: FoliateBook = {
          metadata: { title: this.meta.title, author: this.meta.author },
          sections: [],
          toc: this.tocItems,
          getCover: () => archive.cover(),
        };
        this.phase = 'ready';
        opts.onReady?.(bookLike, this.meta);
      },
    });
    this.view.setDirection(this.direction);

    /* 按书记住上次读到第几页 / 第几格；没有记录就停在封面 */
    if (saved.page !== undefined) this.view.goToPage(saved.page, saved.panel ?? -1);
  }

  private async turn(dir: 'prev' | 'next'): Promise<boolean> {
    return this.view?.turn(dir === 'next' ? 1 : -1) ?? false;
  }

  async start(cfi?: string, fraction = 0): Promise<void> {
    if (cfi) {
      const loc = parseMangaLocator(cfi);
      if (loc) { this.view?.goToPage(loc.page, loc.panel); return; }
    }
    if (fraction > 0) this.view?.goToPercent(fraction);
    this.phase = 'ready';
  }

  async next(): Promise<boolean> { return this.turn('next'); }
  async prev(): Promise<boolean> { return this.turn('prev'); }
  async goToPercent(fraction: number): Promise<void> { this.view?.goToPercent(fraction); }

  async goToCfi(cfi: string): Promise<boolean> {
    const loc = parseMangaLocator(cfi);
    if (!loc) return false;
    this.history.push({ cfi: `manga/${this.page}` });
    this.opts?.onHistoryChange?.(this.history.size);
    this.view?.goToPage(loc.page, loc.panel);
    return true;
  }

  async goToHref(href: string): Promise<void> { void this.goToCfi(href); }

  async goToChapter(title: string): Promise<boolean> {
    const hit = this.tocItems.find((x) => x.label === title);
    if (!hit) return false;
    return this.goToCfi(hit.href);
  }

  toc(): FoliateTOCItem[] { return this.tocItems; }
  currentChapterHref(): string { return `manga/${this.page}`; }
  get currentChapterIndex(): number { return this.page; }
  currentText(): string { return ''; }

  async exportChapters(): Promise<Array<{ title: string; text: string }>> { return []; }
  async search(): Promise<SearchHit[]> { return []; }
  clearSearch(): void { /* 没有文字层 */ }
  setAnnotations(_list: HostAnnotation[]): void { /* 漫画不画行内划线，书签走 CFI */ }
  clearSelection(): void { /* 没有选区 */ }
  refreshTheme(): void { this.view?.applyPrefs(this.mangaPrefs); }

  applyPrefs(prefs: ReaderPrefs): void {
    const next = normalizeMangaPrefs(prefs.manga);
    /* 合并的是「本里当前生效的那几项」，不是开书时的快照：否则设置页
       一改字号/常亮，这本单独调过的排版就被冲回开书时的样子 */
    const merged = mangaSettingsOf(next, this.viewState);
    this.mangaPrefs = merged;
    /* 「点击翻页」是通用开关，不在漫画自己的偏好里；视图拿着同一个引用，
       这里一改，开着书切设置也立刻生效。 */
    this.input.desktopTurn = prefs.desktopTapTurn === true;
    /* 方向必须带上开书时从 ComicInfo.xml 读到的值：mount 之后 ReaderView
       会再调一次 applyPrefs 套全局偏好，这里传 null 的话，文件里写的
       右到左/左到右会被一句「默认」冲掉（2026-11-22 真机发现）。 */
    this.direction = resolveDirection(merged.direction, this.comicDir);
    this.view?.applyPrefs(merged);
    this.view?.setDirection(this.direction);
  }

  restoreMangaView(state: MangaViewState | null | undefined): void {
    if (!state) return;
    const saved = normalizeMangaView(state);
    this.viewState = { ...this.viewState, ...saved };
    this.mangaPrefs = mangaSettingsOf(this.mangaPrefs, saved);
    this.direction = resolveDirection(this.mangaPrefs.direction, this.comicDir);
    this.view?.applyPrefs(this.mangaPrefs);
    this.view?.setDirection(this.direction);
  }

  async pulseAt(cfi: string): Promise<void> { await this.goToCfi(cfi); }

  setViewportWidth(_width: number, _left = 0): void {
    /* 视图自己用 ResizeObserver 跟容器宽度，这里只留接口形状 */
  }

  get historyUi(): HistoryUi {
    return {
      back: () => {
        const spot = this.history.pop();
        if (spot) void this.goToCfi(spot.cfi);
        this.opts?.onHistoryChange?.(this.history.size);
      },
      canBack: () => this.history.canBack,
    };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    const view = this.view;
    this.view = null;
    if (view) await view.destroy();
    this.source = null;
    this.opts = null;
    this.tocItems = [];
    this.history.clear();
    this.phase = 'idle';
  }
}

/** 判断一个 vault 路径是不是「图片文件夹」形式的一卷漫画 */
export async function folderComicPages(app: App, dir: string): Promise<string[]> {
  try {
    const listed = await app.vault.adapter.list(dir);
    return sortPageNames(listed.files
      .filter((p) => isImageName(p))
      .map((p) => p.split('/').pop() || p));
  } catch { return []; }
}

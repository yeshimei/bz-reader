/* ============================================================
 * bz-reader · 插件主体（src/plugin.ts）
 *
 * 一个工厂而不是一个类：基础版与高级版**共用这一份逻辑**，
 * 区别只在构建时进哪个入口。
 *   entry/base.ts → createPlugin({ pro: false })
 *   entry/pro.ts  → createPlugin({ pro: true })
 *
 * 两版共用一个工厂，高级功能按 `__BZ_READER_PRO__` 分叉：esbuild 会把
 * `if (false) { … }` 的整块删掉，所以标注的浮层、列表、引擎接线在 base 包里
 * 一行都不剩（`grep bzr-annot dist/base/main.js` = 0）。
 *
 * 唯一漏网的是 `data/notes.ts` 那几个纯函数：它们被类方法引用着，摇不掉。
 * 不执行、不碰界面，只是占几 KB；等激活码机制落地、把 pro 拆成 ReaderView
 * 的子类时一起切干净。
 *
 * 两个面的分工（2026-11-02 定）：
 *   书架 = 弹窗（入口 + 管理，不需要占 tab）
 *   阅读 = 原生 ItemView（能并排开笔记、能被布局记住、能拖到侧栏）
 * ============================================================ */
import { Plugin, Platform } from 'obsidian';
import { setApp } from './core/app';
import { setPluginRelDir, PLUGIN_ID } from './core/plugin-path';
import { closeAllModals } from './core/ui/modal';
import { notify } from './core/notice';
import { BookRepo, BASE_FORMATS, PRO_FORMATS, formatOf, scanVault } from './data/book-repo';
import { ReaderStore } from './data/store';
import type { BookFormat, ReaderBook } from './data/schema';
import { openShelf as openShelfModal } from './ui/shelf';
import { openImport } from './ui/import-panel';
import { ReaderView, VIEW_TYPE_READER, type ReaderHostApi } from './view/reader-view';
import { SideView, VIEW_TYPE_TOC, type SideTab } from './view/side-view';
import { setShelfSource, setShelfProActions, notifyShelf } from './view/shelf-state';
import { ReaderSettingTab } from './ui/settings-tab';
import { verifyLicense, licenseSummary } from './data/license';
import { normalizeSettings } from './data/settings';
// 统计/全文搜索是高级版能力：import 只被下面 if (__BZ_READER_PRO__) 分支引用，
// base 构建时模块整体摇掉（必须保持「if 块里直接调用」，隔一层本地函数会漏）
import { openStats } from './ui/stats-panel';
import { openCrossSearch } from './ui/cross-search-panel';

export interface PluginConfig {
  /** 高级版构建为 true。基础版为 false，且高级模块根本不在包里。 */
  pro: boolean;
}

export function createPlugin(cfg: PluginConfig) {
  return class BzReaderPlugin extends Plugin implements ReaderHostApi {
    store!: ReaderStore;
    repo!: BookRepo;

    private formats(): BookFormat[] {
      return cfg.pro ? PRO_FORMATS : BASE_FORMATS;
    }

    async onload(): Promise<void> {
      setApp(this.app);
      setPluginRelDir(this.manifest.dir);

      this.store = new ReaderStore(this.app);
      await this.store.load();
      this.repo = new BookRepo(this.store.get().books);

      this.registerView(VIEW_TYPE_READER, (leaf) => new ReaderView(leaf, this));
      this.registerView(VIEW_TYPE_TOC, (leaf) => new SideView(leaf));

      // 书库注入：侧栏的书库页签认这个源，不认插件实例
      setShelfSource({
        app: this.app,
        repo: this.repo,
        store: this.store,
        openBook: (book, cfi) => void this.openBook(book, cfi),
        openImport: () => this.openImportPanel(),
        syncVault: () => this.syncShelf(),
      });
      if (__BZ_READER_PRO__) {
        setShelfProActions({
          openStats: () => openStats(this.store),
          openCrossSearch: () =>
            openCrossSearch({
              app: this.app,
              store: this.store,
              books: this.repo.all().filter((b) => !(b.fileRef as { fileMissing?: boolean }).fileMissing),
              onJump: (book, cfi) => void this.openBook(book, cfi),
            }),
        });
      }

      // 基础版没有可配项（字号主题都在阅读界面上），设置页只在 pro 里注册
      if (__BZ_READER_PRO__) {
        this.addSettingTab(
          new ReaderSettingTab({
            app: this.app,
            plugin: this,
            store: this.store,
            activate: async (code) => {
              const res = await verifyLicense(code);
              return { ok: res.ok, message: res.message };
            },
            licenseInfo: () => licenseSummary(normalizeSettings(this.store.get().settings ?? undefined).license),
          }),
        );
      }

      this.addRibbonIcon('book-open', 'bz 阅读：打开书架', () => this.openShelf());

      this.addCommand({
        id: 'open',
        name: '打开书架',
        callback: () => this.openShelf(),
      });

      this.addCommand({
        id: 'continue',
        name: '继续阅读最近一本',
        callback: () => void this.continueReading(),
      });

      this.addCommand({
        id: 'import',
        name: '导入书籍',
        callback: () => this.openImportPanel(),
      });

      // 布局就绪后再放调试直达：目标视图依赖 workspace 初始化
      this.app.workspace.onLayoutReady(() => {
        void this.autoOpenIfRequested();
      });
    }

    onunload(): void {
      closeAllModals();
      // 原生视图不保证走 onClose，这里兜底结算一次（幂等，settle 内部已改完数据后 await flush）
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_READER)) {
        void (leaf.view as ReaderView).forceClose();
      }
      void this.store?.destroy();
    }

    /* ── 对外（ReaderView 用） ── */

    /**
     * 书架入口。桌面：书库已经住进左侧栏了，这里只负责把侧栏翻开并切到
     * 书库页签；移动端左侧栏是抽屉装不下书墙，仍然走全屏弹窗。
     */
    openShelf(): void {
      if (Platform.isMobile) {
        openShelfModal({
          app: this.app,
          repo: this.repo,
          store: this.store,
          formats: this.formats(),
          onOpen: (book, cfi) => void this.openBook(book, cfi),
        });
        return;
      }
      this.openTocSidebar('shelf');
    }

    /**
     * 目录放进 Obsidian 左侧栏。
     *
     * 已经有一个阅读侧栏页签就只展开侧栏、切到指定页签；没有才新建 leaf。
     * **不复用现有 leaf**（别用 getLeftLeaf(false) 然后 setViewState）：左侧栏里
     * 可能正开着文件列表、大纲、搜索，setViewState 会把它们顶掉——用户点一下
     * 「目录」，结果文件列表没了，这账算不清。
     */
    openTocSidebar(tab?: SideTab): void {
      const ws = this.app.workspace;
      const opened = ws.getLeavesOfType(VIEW_TYPE_TOC)[0];
      if (opened) {
        if (tab) (opened.view as SideView).setTab(tab);
        ws.leftSplit?.expand?.();
        return;
      }
      const leaf = ws.getLeftLeaf(true);
      if (!leaf) return;
      void leaf.setViewState({ type: VIEW_TYPE_TOC, active: true }).then(() => {
        if (tab) (leaf.view as SideView).setTab(tab);
      });
      ws.leftSplit?.expand?.();
    }

    /**
     * 打开一本书。已经在某个 tab 里开着就切过去，不重复开——
     * 重复开会得到两个 iframe、两份会话计时，关掉其中一个还会把进度写乱。
     * 带 cfi 时（跨书搜索的跳转）直接落到那一页。
     */
    async openBook(book: ReaderBook, cfi?: string): Promise<void> {
      const opened = this.app.workspace
        .getLeavesOfType(VIEW_TYPE_READER)
        .find((l) => (l.view as ReaderView).currentBookId === book.id);
      if (opened) {
        if (cfi) void (opened.view as ReaderView).jumpTo(cfi);
        await this.app.workspace.revealLeaf(opened);
        return;
      }
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({
        type: VIEW_TYPE_READER,
        active: true,
        state: { bookId: book.id, ...(cfi ? { cfi } : {}) },
      });
      await this.app.workspace.revealLeaf(leaf);
    }

    /* ── 内部 ── */

    private async continueReading(): Promise<void> {
      const recent = this.repo.recent(1)[0];
      if (!recent) {
        notify('还没有读过的书', 'info');
        this.openShelf();
        return;
      }
      await this.openBook(recent);
    }

    private openImportPanel(): void {
      openImport({
        app: this.app,
        repo: this.repo,
        store: this.store,
        formats: this.formats(),
        onDone: () => notifyShelf(),
      });
    }

    /** 从笔记库重扫一遍书：新文件登记、挪走的标记缺失（侧栏书库页每次进页都做） */
    private syncShelf(): void {
      const files = scanVault(this.app, this.formats());
      const existing = new Set(files.map((f) => f.path));
      for (const f of files) {
        const fmt = formatOf(f.path) as BookFormat;
        this.repo.ensure(f.path, fmt, f.size);
      }
      this.repo.markMissing(existing);
      this.store.touch();
    }

    /** 调试入口：storage/debug-open.json 里写 {"command":"open"} 时启动即执行（开发用） */
    private async autoOpenIfRequested(): Promise<void> {
      try {
        const dir = this.manifest.dir;
        if (!dir) return;
        const path = `${dir}/storage/debug-open.json`;
        if (!(await this.app.vault.adapter.exists(path))) return;
        const raw = JSON.parse(await this.app.vault.adapter.read(path)) as { command?: string; bookId?: string };
        if (raw.command === 'open') this.openShelf();
        else if (raw.command === 'continue') await this.continueReading();
        else if (raw.command === 'book' && raw.bookId) {
          const book = this.repo.byId(raw.bookId);
          if (book) await this.openBook(book);
        }
      } catch {
        /* 调试入口失败不影响正常启动 */
      }
    }
  };
}

export { PLUGIN_ID };

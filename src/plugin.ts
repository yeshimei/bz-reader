/* ============================================================
 * bz-reader · 插件主体（src/plugin.ts）
 *
 * 一个工厂而不是一个类：基础版与高级版共用这一份逻辑，区别只在
 * 构建时进哪个入口（entry/base.ts / entry/pro.ts）。
 *
 * 两个承载（2026-11-03 改）：
 *   书架 = **原生侧栏第一页**，内含 书库 / 笔记 / 统计 / 设置；
 *          目录 / 书签 / 划线 / AI 是同一排的后四个页签
 *   阅读 = 中心 ItemView，正文 + 悬浮工具条 + 进度条
 * 书架不再占一个中心 tab，也不再另开一个手机全屏弹窗——桌面与移动端
 * 都走 Obsidian 自己的侧栏（移动端就是那个抽屉），一套壳子两处复用。
 *
 * 快捷键：键盘上能做的动作全部注册成命令，用户可以去 Obsidian 的
 * 「快捷键」里改键；壳层设置页只负责把它们读出来显示、点一下跳过去。
 * ============================================================ */
import { Plugin, type WorkspaceLeaf } from 'obsidian';
import { setApp } from './core/app';
import { setPluginRelDir, dataDirOf, normalizeDataDir, setDataDir, PLUGIN_ID } from './core/plugin-path';
import { isMobileShell } from './core/mobile';
import { closeAllModals } from './core/ui/modal';
import { notify } from './core/notice';
import { BookRepo, BASE_FORMATS, PRO_FORMATS, formatOf, scanVault } from './data/book-repo';
import { ReaderStore } from './data/store';
import { copyTree, removeTree } from './data/migrate';
import { normalizePrefs, type ReaderPrefs } from './data/prefs';
import { normalizeSettings, type ReaderSettings } from './data/settings';
import type { BookFormat, ReaderBook } from './data/schema';
import { openImport } from './ui/import-panel';
import { ReaderView, VIEW_TYPE_READER, type ReaderCommand, type ReaderHostApi } from './view/reader-view';
import { SideView, VIEW_TYPE_TOC, type SideTab } from './view/side-view';
import { setShelfSource, setShelfProActions, notifyShelf } from './view/shelf-state';
import { ReaderSettingTab } from './ui/settings-tab';
import { verifyLicense, licenseSummary } from './data/license';
import { releaseCovers } from './data/cover';
import { can, recordActivity, revalidateLicense, setProBuild } from './data/entitlement';
import { PROTOCOL, parseProtocolParams, type LinkTarget } from './data/deeplink';
import { installBlobSrcdocPatches } from './engine/blob-srcdoc';
import { initDebugLog } from './core/debug-log';
import { openStats } from './ui/stats-panel';
import { openCrossSearch } from './ui/cross-search-panel';

/* 壳层 */
import { StudyView, VIEW_TYPE_STUDY } from './shell/study-view';
import { OverlayLayer } from './shell/overlay';
import { dispatchAction } from './shell/actions';
import { loadShellState, notify as notifyShell, setState, getState, subscribe, type StudyPage } from './shell/state';
import { setShellSource, shellPrefs } from './shell/source';

export interface PluginConfig {
  /** 高级版构建为 true。基础版为 false，且高级模块根本不在包里。 */
  pro: boolean;
}

/**
 * 把 leaf 挪到所在侧栏的第一格。
 *
 * Obsidian 没有公开的重排 API——新 leaf 一律追加到左栏底部，于是「打开书
 * 就切目录」会变成「目录在文件树、搜索、书签下面，得往下滑才看得见」。
 * 这里用内部的 removeChild / insertChild，两个方法都在运行时存在但不在
 * d.ts 里；**整个函数包在 try 里**：内部一变就放弃置顶，绝不能让
 * 「打开目录」这件事本身失败。
 */
function moveLeafToTop(leaf: WorkspaceLeaf): void {
  try {
    const parent = leaf.parent as unknown as {
      children?: WorkspaceLeaf[];
      removeChild?: (l: WorkspaceLeaf, resize?: boolean) => void;
      insertChild?: (i: number, l: WorkspaceLeaf, resize?: boolean) => void;
    } | null;
    if (!parent) return;
    if (typeof parent.removeChild !== 'function' || typeof parent.insertChild !== 'function') return;
    if (parent.children && parent.children[0] === leaf) return; // 已经在最上面
    parent.removeChild(leaf, false);
    parent.insertChild(0, leaf, false);
  } catch {
    /* 内部 API 变了就维持原顺序：位置是锦上添花，开不了侧栏才是 bug */
  }
}

export function createPlugin(cfg: PluginConfig) {
  return class BzReaderPlugin extends Plugin implements ReaderHostApi {
    store!: ReaderStore;
    repo!: BookRepo;
    private overlay: OverlayLayer | null = null;
    private offShell: (() => void) | null = null;

    private formats(): BookFormat[] {
      // 多格式属于高级能力：没有解锁就只认 EPUB / TXT
      return cfg.pro && can('fullFormats') ? PRO_FORMATS : BASE_FORMATS;
    }

    async onload(): Promise<void> {
      setApp(this.app);
      setPluginRelDir(this.manifest.dir);
      /* 移动端保命补丁：宿主 CSP 挡 blob 帧，章节必须以 srcdoc 落地。
         必须早于任何一次开书（拦 URL.createObjectURL 与 iframe.src）。 */
      installBlobSrcdocPatches();
      /* 真机排查：关键动作落到库根目录的 bz-reader-debug.md */
      initDebugLog(this.app);
      // 构建期能力 + 记一次活跃日（试用按「真的打开过的日子」算）
      setProBuild(cfg.pro);
      recordActivity();
      /* 启动即真验一次码：同步判定只能拆 payload，验签得在这里做。
         跑不过就清码（改 localStorage 伪造的假码在这一步被拦下）。 */
      void revalidateLicense().then((cleaned) => {
        if (cleaned) notifyShell();
      });
      loadShellState();

      this.store = new ReaderStore(this.app);
      await this.store.load();
      this.repo = new BookRepo(this.store.get().books);

      this.registerView(VIEW_TYPE_READER, (leaf) => new ReaderView(leaf, this));
      this.registerView(VIEW_TYPE_TOC, (leaf) => new SideView(leaf));
      this.registerView(VIEW_TYPE_STUDY, (leaf) => new StudyView(leaf));

      this.injectShellSource();

      // 弹层层：全局一个，挂 body，跟着壳层状态重画
      this.overlay = new OverlayLayer((act, el) => {
        dispatchAction(act, el, { repaint: () => notifyShell() });
      });
      this.offShell = this.registerShellSync();

      // 侧栏书库注入（移动端的全屏书架弹窗仍走这一套）
      setShelfSource({
        app: this.app,
        repo: this.repo,
        store: this.store,
        openBook: (book, cfi) => void this.openBook(book, cfi),
        openImport: () => this.openImportPanel(),
        syncVault: () => this.syncShelf(),
      });
      setShelfProActions({
        openStats: () => {
          // 基础版包里没有 openStats（构建时被换成空实现），只能走解锁层
          if (__BZ_READER_PRO__ && can('stats')) openStats(this.store);
          else setState({ overlay: { kind: 'unlock', mode: 'stats' } });
        },
        openCrossSearch: () => {
          if (__BZ_READER_PRO__ && can('crossSearch')) {
            openCrossSearch({
              app: this.app,
              store: this.store,
              books: this.repo.all().filter((b) => !(b.fileRef as { fileMissing?: boolean }).fileMissing),
              onJump: (book, cfi) => void this.openBook(book, cfi),
            });
          } else {
            setState({ overlay: { kind: 'unlock', mode: 'crossSearch' } });
          }
        },
      });

      // 原生设置页只留一个「迁到书架」的说明与跳转；真正的设置在书架第四页
      this.addSettingTab(
        new ReaderSettingTab({
          app: this.app,
          plugin: this,
          store: this.store,
          openSettings: () => this.openStudy('settings'),
          activate: async (code) => {
            const res = await verifyLicense(code);
            return { ok: res.ok, message: res.message };
          },
          licenseInfo: () => licenseSummary(normalizeSettings(this.store.get().settings ?? undefined).license),
        }),
      );

      /* 位置双链：笔记里的 obsidian://bz-reader?book=…&cfi=… 从这里落回原文 */
      this.registerObsidianProtocolHandler(PROTOCOL, (params) => {
        void this.openFromTarget(parseProtocolParams(params));
      });

      this.addRibbonIcon('library', 'bz 阅读：书架', () => this.openStudy());

      /* ── 命令 ──
       * 键盘上能做的动作这里都注册一份：用户在 Obsidian 的「快捷键」里
       * 改成自己顺手的键，壳层设置页只负责把绑定读回来显示（点一下跳过去改）。
       * 命名统一以「阅读：」「书架：」开头，在快捷键列表里搜一个词就能过滤出全部。 */
      this.addCommand({ id: 'open', name: '书架：打开书架', callback: () => this.openStudy() });
      this.addCommand({
        id: 'continue',
        name: '书架：继续阅读最近一本',
        callback: () => void this.continueReading(),
      });
      this.addCommand({ id: 'import', name: '书架：导入书籍', callback: () => this.openImportPanel() });
      this.addCommand({ id: 'notes', name: '书架：笔记', callback: () => this.openStudy('notes') });
      this.addCommand({ id: 'stats', name: '书架：统计', callback: () => this.openStudy('stats') });
      this.addCommand({ id: 'prefs', name: '书架：设置', callback: () => this.openStudy('settings') });
      this.addCommand({ id: 'search', name: '阅读：搜索（本书 / 全库）', callback: () => this.openSearch() });
      this.addCommand({ id: 'sidebar', name: '阅读：显示左侧栏', callback: () => this.openTocSidebar('toc') });

      const onReader = (id: string, name: string, kind: ReaderCommand): void => {
        this.addCommand({
          id,
          name: `阅读：${name}`,
          callback: () => {
            const view = this.activeReader();
            if (!view) {
              notify('先打开一本书再用这个命令', 'info');
              return;
            }
            view.runCommand(kind);
          },
        });
      };
      onReader('page-next', '下一页', 'next');
      onReader('page-prev', '上一页', 'prev');
      onReader('focus', '专注模式', 'focus');
      onReader('fullscreen', '全屏', 'fullscreen');
      onReader('bookmark', '记一枚书签', 'bookmark');
      onReader('typography', '排版面板', 'typography');
      onReader('bookmap', '全书鸟瞰', 'bookmap');
      onReader('tts', '朗读开关', 'tts');

      /* 两个 tab 各开一本书时，切 tab 目录要跟着换：阅读视图不会自己重发
         relocate，这里在 leaf 激活时让它把目录快照重放一遍。 */
      this.registerEvent(
        this.app.workspace.on('active-leaf-change', (leaf) => {
          const view = leaf?.view;
          if (view instanceof ReaderView) view.activate();
        }),
      );

      this.app.workspace.onLayoutReady(() => {
        void this.autoOpenIfRequested();
      });
    }

    onunload(): void {
      closeAllModals();
      this.offShell?.();
      this.overlay?.destroy();
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_READER)) {
        void (leaf.view as ReaderView).forceClose();
        /* 视图类随插件卸载一起失效，留在工作区里就是一个「插件不再活动」的空壳；
           下次加载时 Obsidian 还会尝试 load() 它，然后抛在 titleEl 上。
           所以卸载时把这些 leaf 收掉，重新加载后由用户（或自动打开）重新开。 */
        leaf.detach();
      }
      releaseCovers(); // 封面 objectURL 不释放会一直占着内存里的整张图
      /* 书架就是中心 tab 里的一个视图（VIEW_TYPE_STUDY），跟阅读视图一样是用户
         自己打开的——插件重载不该替他关掉。Obsidian 在插件停用时自己会把这些
         leaf 换成占位，我们 detach 只会让人丢掉布局。 */
      void this.store?.destroy();
    }

    /** 命令面板要「对当前这本书下手」：优先活动 leaf，其次任意一个阅读 leaf */
    private activeReader(): ReaderView | null {
      const ws = this.app.workspace;
      const active = ws.activeLeaf?.view;
      if (active instanceof ReaderView) return active;
      const leaf = ws.getLeavesOfType(VIEW_TYPE_READER)[0];
      return leaf ? (leaf.view as ReaderView) : null;
    }

    /* ── 壳层接线 ── */

    private injectShellSource(): void {
      setShellSource({
        app: this.app,
        repo: this.repo,
        store: this.store,
        openBook: (book, cfi) => void this.openBook(book, cfi),
        openImport: () => this.openImportPanel(),
        openStudy: (page) => this.openStudy(page),
        closeStudy: () => this.app.workspace.leftSplit?.collapse?.(),
        openSidebar: (tab) => this.openTocSidebar(tab),
        syncVault: () => this.syncShelf(),
        prefs: () => normalizePrefs(this.store.get().prefs ?? undefined),
        setPrefs: (patch) => this.setPrefs(patch),
        settings: () => normalizeSettings(this.store.get().settings ?? undefined),
        setSettings: (patch) => this.setSettings(patch),
        dataDir: () => dataDirOf(),
        migrateDataDir: (dir) => this.migrateDataDir(dir),
      });
    }

    /**
     * 换数据目录：落盘 → 复制 → 校验 → 切指针 → 重新加载 → 删旧。
     *
     * 顺序不能改：先落盘是因为 debounce 里可能还有没写的页码；先复制后删
     * 是因为用户几百条划线只有一份。任一步失败都保持原目录，返回失败原因。
     */
    async migrateDataDir(dir: string): Promise<{ ok: boolean; message: string }> {
      const from = dataDirOf();
      const to = normalizeDataDir(dir);
      if (to === from) return { ok: false, message: '新目录和当前目录相同' };

      const srcHasData = await this.app.vault.adapter.exists(`${from}/bz-reader.json`).catch(() => false);
      await this.store.flush();

      const res = await copyTree(this.app, from, to);
      if (res.failed.length) {
        return { ok: false, message: `有 ${res.failed.length} 个文件没复制成功，已留在原目录` };
      }
      if (srcHasData) {
        const ok = await this.app.vault.adapter
          .exists(`${to}/bz-reader.json`)
          .catch(() => false);
        if (!ok) return { ok: false, message: '复制后没找到数据文件，已留在原目录' };
      }

      setDataDir(to);
      const fresh = await this.store.load();
      // repo 持有的是 books 数组引用，就地换内容，外面拿到的引用仍然有效
      const books = this.repo.all();
      books.length = 0;
      books.push(...fresh.books);

      const removed = await removeTree(this.app, from);
      notifyShell();
      const moved = `已迁移 ${res.files} 个文件到「${to}」`;
      return { ok: true, message: removed ? moved : `${moved}（旧目录清理失败，可手动删除「${from}」）` };
    }

    /** 壳层状态一变，弹层层与主题就跟着走 */
    private registerShellSync(): () => void {
      let last = '';
      const sync = (): void => {
        const s = getState();
        const key = `${s.overlay?.kind ?? ''}|${s.overlay?.markId ?? ''}|${s.overlay?.mode ?? ''}`;
        // 强调色不进 key：改档只换 CSS 变量，不需要重画弹层内容
        this.overlay?.setAccent(shellPrefs().accent);
        if (key !== last) {
          last = key;
          this.overlay?.sync();
        }
      };
      sync();
      return subscribe(sync);
    }

    /**
     * 改排版偏好：写进 store，并让所有已打开的阅读视图立刻重排。
     * 书架设置页与阅读页的排版面板最终都落到这一个入口。
     */
    setPrefs(patch: Partial<ReaderPrefs>): void {
      const next = normalizePrefs({ ...normalizePrefs(this.store.get().prefs ?? undefined), ...patch });
      this.store.get().prefs = next;
      this.store.touch();
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_READER)) {
        (leaf.view as ReaderView).updatePrefs(next);
      }
      notifyShell();
    }

    setSettings(patch: Partial<ReaderSettings>): void {
      const next = normalizeSettings({ ...normalizeSettings(this.store.get().settings ?? undefined), ...patch });
      this.store.get().settings = next;
      this.store.touch();
      notifyShell();
    }

    /* ── 承载入口 ── */

    /**
     * 打开书架（中心 tab，单例）：已经有书架 tab 就切页并 reveal。
     *
     * 桌面与移动端同一条路：手机上的中心 tab 就是这个 tab。
     * 以前移动端另开一个全屏 Modal，等于同一页 UI 维护两种开法，
     * 而且从书架点进书之后还得再收一层弹窗。
     */
    openStudy(page: StudyPage = 'library'): void {
      setState({ studyPage: page });
      const ws = this.app.workspace;
      const opened = ws.getLeavesOfType(VIEW_TYPE_STUDY)[0];
      if (opened && opened.view instanceof StudyView) {
        opened.view.setPage(page);
        void ws.revealLeaf(opened);
        return;
      }
      if (opened) opened.detach(); // 旧类实例（热重载后残留）直接换掉
      const leaf = ws.getLeaf('tab');
      void leaf.setViewState({ type: VIEW_TYPE_STUDY, active: true }).then(() => ws.revealLeaf(leaf));
    }

    /** 书架入口（ribbon / 协议 / 命令都走它） */
    openShelf(): void {
      this.openStudy('library');
    }

    openSearch(): void {
      setState({ overlay: { kind: 'search' } });
    }

    openTocSidebar(tab?: SideTab): void {
      const ws = this.app.workspace;
      const opened = ws.getLeavesOfType(VIEW_TYPE_TOC)[0];
      if (opened && opened.view instanceof SideView) {
        if (tab) opened.view.setTab(tab);
        ws.leftSplit?.expand?.();
        return;
      }
      if (opened) opened.detach();
      const leaf = ws.getLeftLeaf(true);
      if (!leaf) return;
      void leaf.setViewState({ type: VIEW_TYPE_TOC, active: true }).then(() => {
        if (tab && leaf.view instanceof SideView) leaf.view.setTab(tab);
        moveLeafToTop(leaf);
      });
      ws.leftSplit?.expand?.();
    }

    async openBook(book: ReaderBook, cfi?: string): Promise<void> {
      // 多格式属于高级能力：升级前导入的 mobi / azw3 也要拦住，
      // 否则「书架里能点开」就等于绕过付费门
      if (!BASE_FORMATS.includes(book.fileRef.format) && !can('fullFormats')) {
        setState({ overlay: { kind: 'unlock', mode: 'fullFormats', text: book.fileRef.format } });
        return;
      }
      setState({ bookId: book.id });
      const ws = this.app.workspace;
      const all = ws.getLeavesOfType(VIEW_TYPE_READER);
      const opened = all.find((l) => (l.view as ReaderView).currentBookId === book.id);
      if (opened) {
        if (cfi) void (opened.view as ReaderView).jumpTo(cfi);
        await ws.revealLeaf(opened);
        // 书已经有 tab 在：阅读视图不会重发 relocate，目录得手动切过来
        (opened.view as ReaderView).activate();
        return;
      }
      /* 工作区里可能留着一个还没绑定书目的阅读 leaf（上次会话 / 插件重载留下的空壳）。
         这种空壳不能直接复用：对「同类型」的 leaf 再 setViewState，Obsidian 会
         认为类型没变而不再把 state 交给视图，结果就是开着 tab 却什么也没挂上。
         干脆把它收掉，下面开一个新的。 */
      for (const l of all) {
        if (!(l.view as ReaderView).currentBookId) l.detach();
      }
      const leaf = ws.getLeaf('tab');
      await leaf.setViewState({
        type: VIEW_TYPE_READER,
        active: true,
        state: { bookId: book.id, ...(cfi ? { cfi } : {}) },
      });
      await ws.revealLeaf(leaf);
    }

    /**
     * 从位置链接跳到原文。
     * 开书交给 openBook，定位交给阅读视图的三级降级（CFI → 原文片段 → 百分比）。
     */
    async openFromTarget(t: LinkTarget | null): Promise<void> {
      if (!t) return;
      const book = this.repo.byId(t.bookId) ?? this.repo.all().find((b) => b.id === t.bookId);
      if (!book) {
        notify('链接指向的书不在书架上，可能已被移走');
        return;
      }
      setState({ bookId: book.id });
      await this.openBook(book);
      const leaf = this.app.workspace
        .getLeavesOfType(VIEW_TYPE_READER)
        .find((l) => (l.view as ReaderView).currentBookId === book.id);
      if (!leaf) return;
      const ok = await (leaf.view as ReaderView).locateFromLink(t);
      if (!ok) notify('没找到原句，已停在这本书上次读到的位置', 'info');
    }

    /* ── 内部 ── */

    private async continueReading(): Promise<void> {
      const recent = this.repo.recent(1)[0];
      if (!recent) {
        notify('还没有读过的书', 'info');
        this.openStudy('library');
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
        onDone: () => {
          notifyShelf();
          notifyShell();
        },
      });
    }

    private syncShelf(): void {
      /* 扫描用「这个包能认的全部格式」，而不是「当前已解锁的格式」。
         否则一旦没解锁，mobi 书会直接从书架上消失——用户会以为书被插件删了。
         真正的门控放在 openBook：看得见、点得开提示，比凭空少几本书好得多。 */
      const files = scanVault(this.app, cfg.pro ? PRO_FORMATS : BASE_FORMATS);
      const existing = new Set(files.map((f) => f.path));
      for (const f of files) {
        const fmt = formatOf(f.path) as BookFormat;
        this.repo.ensure(f.path, fmt, f.size);
      }
      this.repo.markMissing(existing);
      this.store.touch();
      notifyShell();
    }

    private async autoOpenIfRequested(): Promise<void> {
      try {
        const dir = this.manifest.dir;
        if (!dir) return;
        const path = `${dir}/storage/debug-open.json`;
        if (!(await this.app.vault.adapter.exists(path))) return;
        const raw = JSON.parse(await this.app.vault.adapter.read(path)) as { command?: string; bookId?: string };
        // 调试入口读一次就删：留着的话每次启动都会替你开书 / 开书架，
        // 想正常启动还得去插件目录里手动删文件
        await this.app.vault.adapter.remove(path);
        if (raw.command === 'open') this.openStudy();
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

/** shell/state 的订阅（单独包一层，避免与 core/notice 的 notify 混淆） */
export { PLUGIN_ID };

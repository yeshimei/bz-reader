/* ============================================================
 * bz-reader · 插件主体（src/plugin.ts）
 *
 * 一个工厂而不是一个类：**只有一个包**（完整功能版），能力是否可用由
 * 激活码在运行期决定（`can()` → `entitlement().unlocked`）。没有 base/pro
 * 两个入口——`entry/` 下只有一个 `pro.ts`，`dist/base` 是历史产物。
 * （2026-11-04 修：这里原来写着「基础版与高级版共用这一份逻辑，区别只在
 * 构建时进哪个入口」，双包早在 2026-11-03 就撤了。）
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
import { Plugin, TFile, type WorkspaceLeaf } from 'obsidian';
import { setApp } from './core/app';
import { setPluginRelDir, dataDirOf, debugOpenPath, normalizeDataDir, setDataDir, DEFAULT_DATA_DIR, PLUGIN_ID } from './core/plugin-path';
import { isMobileEnv, isMobileShell } from './core/mobile';
import { closeAllModals } from './core/ui/modal';
import { notify } from './core/notice';
import { BookRepo, BASE_FORMATS, PRO_FORMATS, formatOf, planRelocations, scanVault } from './data/book-repo';
import { ReaderStore, verifyCopiedJson } from './data/store';
import { backupFileName, buildBackup, mergeRestore, parseBackup } from './data/backup';
import { pickJsonFile } from './core/file-pick';
import { copyTree, dirHasFiles, findDataDirs, removeTree } from './data/migrate';
import { planMove } from './core/move-plan';
import { collectDataDirCandidates, pickDataDir } from './core/data-dir-pick';
import { normalizePrefs, pickPrefs, type ReaderPrefs } from './data/prefs';
import { normalizeSettings, type ReaderSettings } from './data/settings';
import type { BookFormat, ReaderBook } from './data/schema';
import { ReaderView, VIEW_TYPE_READER, type ReaderCommand, type ReaderHostApi } from './view/reader-view';
import { SideView, VIEW_TYPE_TOC, type SideTab } from './view/side-view';
import { pickActiveReader } from './view/active-reader';
import { isDeferredViewOf } from './view/leaf-reuse';
import { setShelfSource, setShelfProActions, notifyShelf } from './view/shelf-state';
import { mountImport } from './ui/import-panel';
import { releaseCovers } from './data/cover';
import { activateLicense as applyLicense, can, recordActivity, revalidateLicense, setEntBackend, setProBuild } from './data/entitlement';
import { normalizePluginData, type PluginDataFile } from './data/plugin-data';
import { PROTOCOL, parseProtocolParams, type LinkTarget } from './data/deeplink';
import { installBlobSrcdocPatches, uninstallBlobSrcdocPatches } from './engine/blob-srcdoc';
import { openStats } from './ui/stats-panel';
import { openCrossSearch } from './ui/cross-search-panel';

/* 壳层 */
import { StudyView, VIEW_TYPE_STUDY } from './shell/study-view';
import { OverlayLayer } from './shell/overlay';
import { dispatchAction } from './shell/actions';
import { clampDailyGoal } from './shell/checkin';
import {
  DEFAULT_SHELL_STATE,
  getState,
  hydrateLibrary,
  isStudyTab,
  loadShellState,
  notify as notifyShell,
  overlayKey,
  overlayRenderKey,
  setState,
  subscribe,
  type ShellState,
  type StudyPage,
} from './shell/state';
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
    /**
     * 插件配置（`data.json`）。设置、授权、数据目录指针都在这里。
     *
     * 内存里始终有一份完整对象：`entitlement()` 是同步的，等不了 await；
     * 真正的落盘走 `persistCfg()` 防抖，卸载时 `flushCfg()` 强制写。
     */
    private cfg: PluginDataFile = normalizePluginData(null);
    private cfgTimer: number | null = null;
    /** 正在打开的书的 id：双击书卡 / 连点结果时防重复开（P1-14） */
    private opening = new Set<string>();
    private overlay: OverlayLayer | null = null;
    private offShell: (() => void) | null = null;

    private formats(): BookFormat[] {
      // 入口平权：导入列表始终列出全部格式。打开未解锁的 mobi / azw3 时
      // openBook 会弹高级版对照页，而不是让那本书在库里根本不出现。
      return PRO_FORMATS;
    }

    async onload(): Promise<void> {
      setApp(this.app);
      setPluginRelDir(this.manifest.dir);

      /* 配置先读：设置、授权、数据目录全在 data.json 里，而且 store 要知道
         数据目录在哪才能 load()。顺序反了就会「设置读到了、书架是空的」。 */
      this.cfg = normalizePluginData(await this.loadData().catch(() => null));
      setEntBackend({
        read: () => this.cfg.entitlement,
        write: (raw) => {
          this.cfg.entitlement = raw;
          this.persistCfg();
        },
      });
      setDataDir(this.cfg.dataDir);
      /* 指针可能是空的（清过缓存 / 只拷了书没带 .obsidian）：扫一遍库根找回来，
         否则下面 load() 会另建一份空库，用户以为书全丢了。 */
      await this.resolveDataDir();

      /* 移动端保命补丁：宿主 CSP 挡 blob 帧，章节必须以 srcdoc 落地。
         必须早于任何一次开书（拦 URL.createObjectURL 与 iframe.src）。 */
      installBlobSrcdocPatches();
      // 构建期能力 + 记一次活跃日（试用按「真的打开过的日子」算）
      setProBuild(cfg.pro);
      recordActivity();
      /* 启动即真验一次码：同步判定只能拆 payload，验签得在这里做。
         只对「码本身是假的」清码；过期保留、环境异常不动（见 revalidateLicense）。 */
      void revalidateLicense().then((r) => {
        if (r.changed) notifyShell();
      });
      loadShellState();

      this.store = new ReaderStore(this.app);
      await this.store.load();
      this.repo = new BookRepo(this.store.get().books);
      /* 老版本把 AI 配置和激活码写进业务 JSON；搬到 data.json 之后把残留清掉，
         否则用户把 bz-reader.json 发给别人时会顺手把自己的 Key 也发出去。 */
      this.adoptLegacySettings();
      /* 老版本把收藏 / 分组 / 目标存在 localStorage；搬进业务数据一次 */
      this.adoptLegacyLibrary();

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

      /* 不注册 Obsidian 原生设置页：设置只有一处——书架 · 设置。
         两处能改同一个值就会「在这边改了、那边还显示旧的」。 */

      /* 位置链接：笔记里的 obsidian://bz-reader?book=…&cfi=… 从这里落回原文 */
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
      /* 整段收尾放在 try/finally：视图收尾、弹层销毁任一步抛错，后面的全局
         资源（封面 objectURL、iframe 补丁、日志监听、store、data.json）也
         必须归还——否则禁用插件后它们还挂在这个进程里。 */
      try {
        closeAllModals();
        this.offShell?.();
        this.overlay?.destroy();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_READER)) {
          try {
            /* 必须是 instanceof：`getLeavesOfType` 在工作区恢复期间可能给出
               还没实例化的 DeferredView，强转后调 forceClose 会抛在 undefined 上。 */
            const v = leaf.view;
            if (v instanceof ReaderView) void v.forceClose();
          } finally {
            /* 视图类随插件卸载一起失效，留在工作区里就是一个「插件不再活动」的空壳；
               下次加载时 Obsidian 还会尝试 load() 它，然后抛在 titleEl 上。
               所以卸载时把这些 leaf 收掉，重新加载后由用户（或自动打开）重新开。 */
            leaf.detach();
          }
        }
      } finally {
        releaseCovers(); // 封面 objectURL 不释放会一直占着内存里的整张图
        /* 两个全局函数（createObjectURL / iframe.src）是我们改的，要还回去，
           否则禁用插件后它们还在收别的插件造的 Blob（P2-13） */
        uninstallBlobSrcdocPatches();
        /* 书架就是中心 tab 里的一个视图（VIEW_TYPE_STUDY），跟阅读视图一样是用户
           自己打开的——插件重载不该替他关掉。Obsidian 在插件停用时自己会把这些
           leaf 换成占位，我们 detach 只会让人丢掉布局。 */
        void this.store?.destroy();
        /* 配置（含激活码）最后写一次：刚激活就禁用插件的场景不能丢码 */
        void this.flushCfg();
      }
    }

    /** 配置防抖落盘。改设置、激活、换数据目录都走它。 */
    private persistCfg(): void {
      if (this.cfgTimer !== null) return;
      this.cfgTimer = window.setTimeout(() => {
        this.cfgTimer = null;
        void this.saveData(this.cfg).catch((e) => {
          console.warn('[bz-reader] 配置保存失败：', (e as Error)?.message || e);
        });
      }, 300);
    }

    /** 立即落盘（卸载 / 换目录前调） */
    private flushCfg(): Promise<void> {
      if (this.cfgTimer !== null) {
        window.clearTimeout(this.cfgTimer);
        this.cfgTimer = null;
      }
      return this.saveData(this.cfg).catch(() => undefined);
    }

    /**
     * 命令面板要「对当前这本书下手」。
     *
     * 顺序（A-25）：活动视图 → `activeReaderId` 对应的书 → 第一个真视图。
     * 以前只看 `activeLeaf`：焦点在目录侧栏时它永远是目录视图，于是落到
     * 「第一个阅读 leaf」，两个 tab 时命令总打错书。
     */
    private activeReader(): ReaderView | null {
      const ws = this.app.workspace;
      const active = ws.getActiveViewOfType?.(ReaderView) ?? null;
      return pickActiveReader(
        active,
        ws.getLeavesOfType(VIEW_TYPE_READER),
        getState().activeReaderId,
        (v): v is ReaderView => v instanceof ReaderView,
      );
    }

    /* ── 壳层接线 ── */

    private injectShellSource(): void {
      setShellSource({
        app: this.app,
        repo: this.repo,
        store: this.store,
        openBook: (book, cfi) => void this.openBook(book, cfi),
        openImport: () => this.openImportPanel(),
        mountImport: (host) => this.mountImportPage(host),
        openStudy: (page) => this.openStudy(page),
        closeStudy: () => this.app.workspace.leftSplit?.collapse?.(),
        openSidebar: (tab) => this.openTocSidebar(tab),
        syncVault: () => this.syncShelf(),
        prefs: () => this.currentPrefs(),
        setPrefs: (patch) => this.setPrefs(patch),
        settings: () => this.cfg.settings,
        setSettings: (patch) => this.setSettings(patch),
        currentText: () => this.activeReader()?.pageText() ?? '',
        activate: (code) => this.activateLicense(code),
        dataDir: () => dataDirOf(),
        migrateDataDir: (dir) => this.migrateDataDir(dir),
        migrateDir: (kind, from, to) => this.migrateDir(kind, from, to),
        setFavorite: (id, on) => this.patchBook(id, (b) => {
          if (on) b.favorite = true;
          else delete b.favorite;
        }),
        setGoal: (n) => {
          this.store.get().goal = n;
          this.store.touch();
        },
        setDailyGoal: (minutes) => {
          const n = clampDailyGoal(minutes);
          this.store.get().dailyGoalMinutes = n;
          this.store.touch();
          notify(`每日目标改为 ${n} 分钟`);
        },
        searchText: async (kw) => {
          const view = this.activeReader();
          return view ? view.searchText(kw) : [];
        },
        hasOpenReader: () => !!this.activeReader(),
        backup: () => this.backupData(),
        restore: () => this.restoreData(),
      });
    }

    /**
     * 一键备份：把业务数据写成一份 JSON 放进数据目录。
     *
     * 先 `flush(true)` 再序列化：内存里可能还有刚翻的一页没落盘，
     * 备份出来的却是「上一秒的书架」，用户拿它恢复就少一页进度。
     */
    private async backupData(): Promise<{ ok: boolean; message: string }> {
      const dir = dataDirOf();
      const path = `${dir}/${backupFileName()}`;
      try {
        await this.store.flush(true);
        await this.app.vault.adapter.write(path, buildBackup(this.store.get()));
        notify(`已备份到「${path}」`);
        return { ok: true, message: path };
      } catch (e) {
        const why = `备份失败：${(e as Error)?.message || '未知错误'}`;
        notify(why, 'error');
        return { ok: false, message: why };
      }
    }

    /**
     * 从备份恢复：**合并**，不替换。
     *
     * 替换会让「另一台设备上多读的那几章」凭空消失——那是数据丢失，
     * 不是恢复。合并按书 id 对齐、`updatedAt` 大的赢（同 store 的外部修改合并）。
     */
    private async restoreData(): Promise<{ ok: boolean; message: string }> {
      const picked = await pickJsonFile();
      if (!picked) return { ok: false, message: '没有选择文件' };
      let text = '';
      try {
        text = await picked.text();
      } catch (e) {
        const why = `读不了这个文件：${(e as Error)?.message || '未知错误'}`;
        notify(why, 'error');
        return { ok: false, message: why };
      }
      const parsed = parseBackup(text);
      if (!parsed.ok) {
        notify(parsed.message, 'error');
        return { ok: false, message: parsed.message };
      }
      const merged = mergeRestore(this.store.get(), parsed.data);
      const books = this.repo.all();
      books.length = 0;
      books.push(...merged.books);
      /* repo 与 store 必须指向同一个数组，否则恢复出来的书重启就没了 */
      this.store.get().books = books;
      if (merged.prefs !== undefined) this.store.get().prefs = merged.prefs;
      if (typeof merged.goal === 'number') this.store.get().goal = merged.goal;
      this.store.get().checkins = merged.checkins;
      if (typeof merged.dailyGoalMinutes === 'number') {
        this.store.get().dailyGoalMinutes = merged.dailyGoalMinutes;
      }
      this.store.touch();
      await this.store.flush(true);
      hydrateLibrary(books, this.store.get().goal);
      notifyShell();
      const extra = parsed.dropped ? `（有 ${parsed.dropped} 条记录不完整，已跳过）` : '';
      const msg = `已恢复，书架现在 ${books.length} 本${extra}`;
      notify(msg);
      return { ok: true, message: msg };
    }

    /**
     * 改一本书上的某个字段：顺手更新 updatedAt 并排一次落盘。
     *
     * `updatedAt` 不能漏：P0-01 的外部修改合并是按它取新的那一份，
     * 少了这一行，用户在电脑上点的收藏会被同步来的旧记录覆盖回去。
     */
    private patchBook(id: string, fn: (b: ReaderBook) => void): void {
      const b = this.repo.byId(id);
      if (!b) return;
      fn(b);
      b.updatedAt = Date.now();
      this.store.touch();
    }

    /** 把老版本塞在业务 JSON 里的 settings 搬进 data.json，然后删掉残留 */
    private adoptLegacySettings(): void {
      const legacy = (this.store.get() as { settings?: unknown }).settings;
      if (!legacy || typeof legacy !== 'object') return;
      const old = normalizeSettings(legacy);
      // data.json 里已经有值就不覆盖（用户可能在新版本里改过）
      this.cfg.settings = normalizeSettings({
        ...old,
        ...this.cfg.settings,
        ai: {
          baseUrl: this.cfg.settings.ai.baseUrl || old.ai.baseUrl,
          apiKey: this.cfg.settings.ai.apiKey || old.ai.apiKey,
          model: this.cfg.settings.ai.model || old.ai.model,
        },
      });
      delete (this.store.get() as { settings?: unknown }).settings;
      this.store.touch();
      void this.flushCfg();
    }

    /**
     * 老版本的收藏 / 分组 / 目标只在 localStorage 里。升级后搬进业务数据一次，
     * 之后就以业务数据为准（换设备、同步都跟着走）。
     *
     * 判据是「业务数据里一条都没有」：只要有一条，说明这台机器已经在用新
     * 存储，不能拿 localStorage 里的旧快照把它覆盖回去。
     */
    private adoptLegacyLibrary(): void {
      const st = getState();
      const books = this.repo.all();
      const data = this.store.get();
      let touched = false;
      if (st.favIds.length && !books.some((b) => b.favorite)) {
        for (const id of st.favIds) {
          const b = this.repo.byId(id);
          if (b) {
            b.favorite = true;
            touched = true;
          }
        }
      }
      if (Object.keys(st.shelves).length && !books.some((b) => b.shelf)) {
        for (const [id, name] of Object.entries(st.shelves)) {
          const b = this.repo.byId(id);
          if (b && name) {
            b.shelf = name;
            touched = true;
          }
        }
      }
      if (data.goal === undefined && st.goal !== DEFAULT_SHELL_STATE.goal) {
        data.goal = st.goal;
        touched = true;
      }
      if (touched) this.store.touch();
      data.dataDir = dataDirOf();
      hydrateLibrary(books, data.goal);
    }

    /**
     * 换数据目录：落盘 → 复制 → **真解析校验** → 切指针 → 重新加载 → 删旧。
     *
     * 顺序不能改：先落盘是因为 debounce 里可能还有没写的页码；先复制后删
     * 是因为用户几百条划线只有一份。
     *
     * 2026-11-04 补的三条（都是「复制完就删旧目录」这条路上的坑）：
     *   - 校验不是 `exists()`：副本恰好是半截 JSON 时，exists 为真、load()
     *     把它隔离成坏文件、然后旧目录被删——用户得到「迁移成功」和一个空书架。
     *     现在真的 JSON.parse + 条数比对。
     *   - 拒绝迁到自己的父级/子级：A→A/B 会把 B 复制进自己，删 A 时连 B 一起没。
     *   - 整段 try/catch：任一步 reject 都把指针指回原目录并给人话，调用方
     *     不会再看到「正在迁移…」之后一片安静。
     */
    /**
     * 迁移导出目录 / 书籍导入位置 / 数据目录。
     *
     * export 与 import 都走宿主自己的 `fileManager.renameFile`：它会按用户的
     * 偏好同步改写库内链接，不会因为插件搬了文件就把双链搬断。data 不是库内
     * 可链接内容（JSON + 封面），继续走 `migrateDataDir` 的复制与校验。
     *
     * 先算完整清单再动手；目标有同名文件就整体拒绝，中途失败把已搬的搬回去。
     */
    async migrateDir(
      kind: 'export' | 'import' | 'data',
      from: string,
      to: string,
    ): Promise<{ ok: boolean; message: string }> {
      if (kind === 'data') return this.migrateDataDir(to);

      const vault = this.app.vault;
      const files: TFile[] = [];
      if (kind === 'export') {
        for (const f of vault.getFiles()) {
          if (f.extension === 'md' && f.path.startsWith(`${from}/`)) files.push(f);
        }
      } else {
        for (const b of this.repo.all()) {
          const f = vault.getAbstractFileByPath(b.fileRef.vaultPath);
          if (f instanceof TFile) files.push(f);
        }
      }

      const plan = planMove(files.map((f) => f.path), from, to);
      if (!plan.ok) return { ok: false, message: plan.reason || '无法迁移' };

      for (const m of plan.moves) {
        if (vault.getAbstractFileByPath(m.to)) {
          return { ok: false, message: `「${m.to}」已经存在，请先处理同名文件再迁移` };
        }
      }

      const moved: Array<{ from: string; to: string }> = [];
      try {
        for (const m of plan.moves) {
          const file = vault.getAbstractFileByPath(m.from);
          if (!file) continue;
          await this.app.fileManager.renameFile(file, m.to);
          moved.push(m);
        }
      } catch (e) {
        for (const m of [...moved].reverse()) {
          const back = vault.getAbstractFileByPath(m.to);
          if (back) await this.app.fileManager.renameFile(back, m.from).catch(() => undefined);
        }
        return { ok: false, message: `迁移失败：${(e as Error)?.message || '未知错误'}，已回滚` };
      }

      if (kind === 'export') {
        this.setSettings({ exportDir: to });
      } else {
        const map = new Map(moved.map((m) => [m.from, m.to]));
        for (const book of this.repo.all()) {
          const next = map.get(book.fileRef.vaultPath);
          if (next) book.fileRef.vaultPath = next;
        }
        this.setSettings({ importDir: to });
        this.store.touch();
      }

      return {
        ok: true,
        message: plan.moves.length
          ? `已迁移 ${moved.length} 个文件到「${to}」`
          : `已切换到「${to}」（没有文件需要搬）`,
      };
    }

    async migrateDataDir(dir: string): Promise<{ ok: boolean; message: string }> {
      const from = dataDirOf();
      const to = normalizeDataDir(dir);
      if (to === from) return { ok: false, message: '新目录和当前目录相同' };
      if (to.startsWith(`${from}/`) || from.startsWith(`${to}/`)) {
        return { ok: false, message: '不能迁到当前目录的上级或下级文件夹' };
      }

      try {
        const srcHasData = await this.app.vault.adapter.exists(`${from}/bz-reader.json`).catch(() => false);
        const beforeBooks = this.store.get().books.length;
        await this.store.flush();
        /* 目标目录必须先空着：A→B 成功后再 B→A（A 可能残留或被云同步回填）时，
           直接合会拿另一份库的 bz-reader.json 覆盖这一份。 */
        if (await dirHasFiles(this.app, to)) {
          return { ok: false, message: `「${to}」里已经有文件，为避免覆盖请先清空或换一个目录` };
        }

        const res = await copyTree(this.app, from, to);
        if (res.failed.length) {
          /* 半份副本必须清掉（A-22）：下一次迁移会先看目标目录是否为空，
             残留的 bz-reader.json 会让它永远被「这里已经有文件」挡住。 */
          await removeTree(this.app, to);
          return { ok: false, message: `有 ${res.failed.length} 个文件没复制成功，已留在原目录` };
        }

        /* 复制出来的 JSON 必须能真的解析，且书数不能少。
           少了就说明复制被截断——这时绝不能往下走去删旧目录。 */
        if (srcHasData) {
          const check = await this.verifyCopy(`${to}/bz-reader.json`, beforeBooks);
          if (!check.ok) {
            await removeTree(this.app, to); // 半截副本留着只会挡住下次重试
            return { ok: false, message: check.message };
          }
        }

        setDataDir(to);
        this.store.get().dataDir = to;
        const fresh = await this.store.load();
        // repo 持有的是 books 数组引用，就地换内容，外面拿到的引用仍然有效
        const books = this.repo.all();
        books.length = 0;
        books.push(...fresh.books);
        /* 让 store 也用**同一个**数组（P3-07）：`load()` 换掉了 this.data，
           `store.get().books` 已经是新数组，而 repo 还指着旧数组。不接上这一句，
           之后 repo 里新导入的书永远落不了盘，移除的书重启又回来。 */
        this.store.get().books = books;
        hydrateLibrary(books, fresh.goal);

        const removed = await removeTree(this.app, from);
        this.cfg.dataDir = to;
        void this.flushCfg();
        notifyShell();
        const moved = `已迁移 ${res.files} 个文件到「${to}」`;
        return { ok: true, message: removed ? moved : `${moved}（旧目录清理失败，可手动删除「${from}」）` };
      } catch (e) {
        // 指针已经切走的话要指回来，否则下次启动读的是空目录
        setDataDir(from);
        this.cfg.dataDir = from;
        void this.flushCfg();
        return { ok: false, message: `迁移失败：${(e as Error)?.message || '未知错误'}，数据仍在原目录` };
      }
    }

    /** 校验复制出来的数据文件：能解析、且书数不少于迁移前 */
    private async verifyCopy(path: string, minBooks: number): Promise<{ ok: boolean; message: string }> {
      const text = await this.app.vault.adapter.read(path).catch(() => null);
      return verifyCopiedJson(text, minBooks);
    }

    /**
     * 数据目录找回来（P1-07）。
     *
     * localStorage 被清、删插件目录重装、或只把数据目录拷到新电脑时，
     * 指针会回落到默认的 `bz-reader/storage/`。它要是空的，插件就会另建
     * 一份空库——用户看起来是「书还在，进度和划线全没了」，其实旧文件就在
     * 隔壁目录。
     *
     * 只在当前是**默认目录**时才猜：用户显式设过别的目录，说明他知道自己
     * 在干什么，扫出来的东西不一定是他要的。
     */
    private async resolveDataDir(): Promise<void> {
      if (dataDirOf() !== DEFAULT_DATA_DIR) return;
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(`${DEFAULT_DATA_DIR}/bz-reader.json`).catch(() => false)) return;
      const found = (await findDataDirs(this.app)).filter((d) => d && d !== DEFAULT_DATA_DIR);
      if (!found.length) return; // 全新用户，正常
      /* 多候选不能盲选（A-30）：数组顺序由 `list('/')` 决定，挑错就等于
         把指针写到一个空库上。按书数 → 数据文件 mtime 比较；仍并列就
         让用户去设置里选，绝不写指针。 */
      const candidates = await collectDataDirCandidates(this.app, found);
      const pick = pickDataDir(candidates);
      if (pick.ambiguous) {
        notify('发现多个数据目录，无法判断该用哪一个；请到设置里选择', 'info');
        return;
      }
      if (!pick.dir) return;
      setDataDir(pick.dir);
      this.cfg.dataDir = pick.dir;
      void this.flushCfg();
      notify(`数据目录找回来了：「${pick.dir}」`, 'info');
    }

    /** 壳层状态一变，弹层层与主题就跟着走 */
    private registerShellSync(): () => void {
      let last = '';
      const sync = (): void => {
        const s = getState();
        // 内容键含 text/href/anchor：同 kind 换一条内容（第二次点脚注）也要重画；
        // 含写想法的确认条：那是同一张卡里的可见变化，漏了它确认条不会出现
        const key = overlayRenderKey(s);
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
     *
     * `notifyShell()` 放 finally（A-11）：写盘/重排哪一步抛错，界面也得
     * 广播一次——否则设置页滑块停在旧位置，用户以为没改成功。
     */
    /** 当前平台的偏好：桌面与移动各一套槽，互不覆盖 */
    currentPrefs(): ReaderPrefs {
      return pickPrefs(this.store.get(), isMobileEnv());
    }

    setPrefs(patch: Partial<ReaderPrefs>): void {
      try {
        const next = normalizePrefs({ ...this.currentPrefs(), ...patch });
        const data = this.store.get();
        if (isMobileEnv()) data.prefsMobile = next;
        else data.prefsDesktop = next;
        this.store.touch();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_READER)) {
          /* 必须是 instanceof：DeferredView 上没有 updatePrefs，强转会抛
             「is not a function」并中断整轮循环（后面的视图收不到新排版）。 */
          const view = leaf.view;
          if (view instanceof ReaderView) view.updatePrefs(next);
        }
      } finally {
        notifyShell();
      }
    }

    setSettings(patch: Partial<ReaderSettings>): void {
      this.cfg.settings = normalizeSettings({ ...this.cfg.settings, ...patch });
      this.persistCfg();
      notifyShell();
    }

    /**
     * 激活码的唯一入口（书架设置页 / 壳层解锁层共用）。
     *
     * 顺序：验签 → 通过才写 entitlement（can() 的真相）→ 落盘 data.json。
     * 2026-11-04 起**不再**同步一份进业务 JSON：那份从来没人读，
     * 却让「设置页显示已激活、can() 为 false」这个 bug 活了很久。
     */
    async activateLicense(code: string): Promise<{ ok: boolean; message: string }> {
      const res = await applyLicense(code);
      if (res.ok) {
        await this.flushCfg();
        notifyShell();
      }
      return res;
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
      /* 进页规则只写一处，四个入口共用：
           · 页签页 → 返回目标指向自己
           · 子页   → 返回目标停在上一个页签页
           · 搜索   → 清空上次的词，范围按权限落到「全库 / 本书」 */
      const cur = getState().studyPage;
      const patch: Partial<ShellState> = { studyPage: page };
      if (isStudyTab(page)) patch.studyBack = page;
      else if (isStudyTab(cur)) patch.studyBack = cur;
      if (page === 'search') {
        patch.searchKw = '';
        patch.searchScope = can('crossSearch') ? 'all' : 'book';
      }
      setState(patch);
      const ws = this.app.workspace;
      const opened = ws.getLeavesOfType(VIEW_TYPE_STUDY)[0];
      if (opened && opened.view instanceof StudyView) {
        opened.view.setPage(page);
        void ws.revealLeaf(opened);
        return;
      }
      /* DeferredView（工作区恢复 / 插件重载后的占位）不是 StudyView 实例，
         但 getViewType 认得出类型。以前直接 detach，等于把用户上次打开的书架
         tab 静默关掉；现在就地 setViewState 让它实例化，再 reveal（A-11）。 */
      if (opened && isDeferredViewOf(opened.view, VIEW_TYPE_STUDY)) {
        void opened.setViewState({ type: VIEW_TYPE_STUDY, active: true }).then(() => {
          const view = opened.view;
          if (view instanceof StudyView) view.setPage(page);
          void ws.revealLeaf(opened);
        });
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
      /* 同 openStudy：DeferredView 认类型就复用，不要 detach 重建（A-11） */
      if (opened && isDeferredViewOf(opened.view, VIEW_TYPE_TOC)) {
        void opened.setViewState({ type: VIEW_TYPE_TOC, active: true }).then(() => {
          if (tab && opened.view instanceof SideView) opened.view.setTab(tab);
          ws.leftSplit?.expand?.();
        });
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
      /* 双击书卡 / 连点搜索结果会开两次（P1-14）：EPUB 被解析两遍（手机上内存
         直接翻倍），两个视图往同一份 book 对象写进度和 sessions——进度来回跳、
         阅读时长重复计。按 bookId 去重，第二次直接忽略。 */
      if (this.opening.has(book.id)) return;
      this.opening.add(book.id);
      try {
        setState({ bookId: book.id });
        const ws = this.app.workspace;
        const all = ws.getLeavesOfType(VIEW_TYPE_READER);
        const opened = all.find(
          (l) => l.view instanceof ReaderView && l.view.currentBookId === book.id,
        );
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
           干脆把它收掉，下面开一个新的。
           **必须判 instanceof**：以前用 `as ReaderView` 强转后直接读
           `currentBookId`，后台延迟视图（DeferredView）根本没有这个字段，
           falsy 就被 detach——用户上次会话恢复出来的阅读 tab 就这么静默关掉了。 */
        for (const l of all) {
          if (l.view instanceof ReaderView && !l.view.currentBookId) l.detach();
        }
        const leaf = ws.getLeaf('tab');
        await leaf.setViewState({
          type: VIEW_TYPE_READER,
          active: true,
          state: { bookId: book.id, ...(cfi ? { cfi } : {}) },
        });
        await ws.revealLeaf(leaf);
      } finally {
        this.opening.delete(book.id);
      }
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

    /** 导入也是一整页（S1 定稿）：旧 modal 与浮层里那套已经合并掉了 */
    private openImportPanel(): void {
      this.openStudy('import');
    }

    /** 书架页把导入页挂进来；返回的拆卸函数由 ShelfPanel 在换页时调用 */
    private mountImportPage(host: HTMLElement): () => void {
      return mountImport(host, {
        app: this.app,
        repo: this.repo,
        store: this.store,
        formats: this.formats(),
        onDone: () => {
          notifyShelf();
          notifyShell();
        },
        onExit: () => this.openStudy('library'),
      });
    }

    private syncShelf(): void {
      /* 扫描用「这个包能认的全部格式」，而不是「当前已解锁的格式」。
         否则一旦没解锁，mobi 书会直接从书架上消失——用户会以为书被插件删了。
         真正的门控放在 openBook：看得见、点得开提示，比凭空少几本书好得多。 */
      const files = scanVault(this.app, PRO_FORMATS);
      /* 先认「改名/移动」：同格式、同字节数、当前路径已消失的旧记录，就地换路径。
         不做这一步的话，改个文件名就等于换了一本书——进度、划线、深链全留在
         那条被标成 fileMissing 的幽灵记录上。 */
      for (const move of planRelocations(this.repo.all(), files)) {
        this.repo.relocate(move.book, move.to);
      }
      const existing = new Set(files.map((f) => f.path));
      for (const f of files) {
        const fmt = formatOf(f.path) as BookFormat;
        this.repo.ensure(f.path, fmt, f.size);
      }
      this.repo.markMissing(existing);
      this.store.touch();
      /* 重扫之后收藏/分组要从书里重新灌一遍：同步来的新书可能带 favorite，
         只靠启动那一次 hydrate 会让它到下次重启才显示星标。 */
      hydrateLibrary(this.repo.all(), this.store.get().goal);
      notifyShell();
    }

    private async autoOpenIfRequested(): Promise<void> {
      /* 调试入口：往 <数据目录>/debug-open.json 写一份，启动时读一次就删。
         读一次就删是有意的——误留一份在盘上，每次启动都会替用户开书，而他
         会以为插件坏了，还找不到是谁干的。 */
      try {
        const path = debugOpenPath(this.app);
        if (!(await this.app.vault.adapter.exists(path))) return;
        const raw = JSON.parse(await this.app.vault.adapter.read(path)) as { command?: string; bookId?: string };
        // 调试入口读一次就删：留着的话每次启动都会替你开书 / 开书架，
        // 想正常启动还得去数据目录里手动删文件
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

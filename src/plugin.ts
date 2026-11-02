/* ============================================================
 * bz-reader · 插件主体（src/plugin.ts）
 *
 * 一个工厂而不是一个类：基础版与高级版**共用这一份逻辑**，
 * 区别只在构建时进哪个入口。
 *   entry/base.ts → createPlugin({ pro: false })
 *   entry/pro.ts  → createPlugin({ pro: true })
 *
 * 为什么用两个入口而不是 `define` 摇树：define 只能删掉
 * `if (false) { ... }` 里的代码，静态 import 的模块仍会进 bundle。
 * 两个入口是物理隔离——基础版的 main.js 里真的没有高级代码。
 * ============================================================ */
import { Plugin } from 'obsidian';
import { setApp } from './core/app';
import { setPluginRelDir, PLUGIN_ID } from './core/plugin-path';
import { closeAllModals } from './core/ui/modal';
import { notify } from './core/notice';
import { BookRepo, BASE_FORMATS, PRO_FORMATS } from './data/book-repo';
import { ReaderStore } from './data/store';
import type { BookFormat } from './data/schema';
import { openShelf } from './ui/shelf';
import { openReader } from './ui/reader';

export interface PluginConfig {
  /** 高级版构建为 true。基础版为 false，且高级模块根本不在包里。 */
  pro: boolean;
}

export function createPlugin(cfg: PluginConfig) {
  return class BzReaderPlugin extends Plugin {
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

      this.addRibbonIcon('book-open', 'bz 阅读：打开书库', () => this.openShelf());

      this.addCommand({
        id: 'open',
        name: '打开书库',
        callback: () => this.openShelf(),
      });

      this.addCommand({
        id: 'continue',
        name: '继续阅读最近一本',
        callback: () => this.continueReading(),
      });

      this.addCommand({
        id: 'import',
        name: '导入书籍',
        callback: () => this.openShelf(),
      });

      // 布局就绪后再放调试直达：目标弹窗依赖 workspace 初始化
      this.app.workspace.onLayoutReady(() => {
        void this.autoOpenIfRequested();
      });
    }

    onunload(): void {
      closeAllModals();
      void this.store?.destroy();
    }

    private openShelf(): void {
      openShelf({
        app: this.app,
        repo: this.repo,
        store: this.store,
        formats: this.formats(),
        onOpen: (book) => {
          openReader({
            app: this.app,
            store: this.store,
            book,
            onClose: () => undefined,
          });
        },
      });
    }

    private continueReading(): void {
      const recent = this.repo.recent(1)[0];
      if (!recent) {
        notify('还没有读过的书', 'info');
        this.openShelf();
        return;
      }
      openReader({ app: this.app, store: this.store, book: recent });
    }

    /** 调试入口：storage/debug-open.json 里写 {"command":"open"} 时启动即执行（开发用） */
    private async autoOpenIfRequested(): Promise<void> {
      try {
        const dir = this.manifest.dir;
        if (!dir) return;
        const path = `${dir}/storage/debug-open.json`;
        if (!(await this.app.vault.adapter.exists(path))) return;
        const raw = JSON.parse(await this.app.vault.adapter.read(path)) as { command?: string };
        if (raw.command === 'open') this.openShelf();
        else if (raw.command === 'continue') this.continueReading();
      } catch {
        /* 调试入口失败不影响正常启动 */
      }
    }
  };
}

export { PLUGIN_ID };

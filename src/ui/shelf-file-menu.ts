/* ============================================================
 * bz-reader · 文件浏览器右键菜单（ui/shelf-file-menu.ts）
 *
 * 用户本来得先开书架、再进导入页才能把库里的书登记进来；这一步直接在
 * 文件树上右键完成。逻辑分两层：core/shelf-file-menu 只判断「哪些路径、
 * 该出哪条命令」，这里负责挂到 Obsidian 的 file-menu / files-menu 上，
 * 并把确认与执行交给寄主。
 *
 * 移除走原生 Modal 二次确认：这一步是把书从书架拿走（数据保留、可加回），
 * 右键一次就生效太容易误触；弹窗用宿主原生样式，跟右键菜单是一套观感。
 * ============================================================ */
import { Modal, TFolder, type App, type Menu, type TAbstractFile } from 'obsidian';
import { t } from '../i18n';
import {
  bookPathsFromTargets,
  confirmBodyKey,
  menuLabelKey,
  planShelfMenu,
} from '../core/shelf-file-menu';

export interface ShelfFileMenuDeps {
  app: App;
  /** 库里所有文件的 vault 相对路径（展开文件夹用） */
  vaultPaths: () => string[];
  /** 某条路径是否在书架上（有记录且未归档） */
  onShelf: (path: string) => boolean;
  /** 把这些路径登记进书架（指纹查重 + 补书目 + 落盘 + 广播） */
  addPaths: (paths: string[]) => Promise<void>;
  /** 把这些路径上的书移出书架（归档，数据保留） */
  removePaths: (paths: string[]) => void;
}

/** 原生确认弹窗：一本 / 一批两种说法，确认后才真正移除 */
class RemoveConfirmModal extends Modal {
  constructor(app: App, private count: number, private onConfirm: () => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: t('filemenu.confirmTitle') });
    contentEl.createEl('p', {
      text: t(confirmBodyKey(this.count), this.count === 1 ? undefined : { n: this.count }),
    });
    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => {
      this.close();
    });
    buttons
      .createEl('button', { text: t('filemenu.confirmDo'), cls: 'mod-warning' })
      .addEventListener('click', () => {
        this.close();
        this.onConfirm();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 往一条右键菜单里挂「加入 / 移除书架」，本数决定显示哪几条、带不带数量 */
function attach(menu: Menu, files: readonly TAbstractFile[], deps: ShelfFileMenuDeps): void {
  const targets = files.map((f) => ({ path: f.path, isFolder: f instanceof TFolder }));
  const paths = bookPathsFromTargets(targets, deps.vaultPaths());
  if (!paths.length) return;
  const plan = planShelfMenu(paths, deps.onShelf);

  if (plan.addPaths.length) {
    const n = plan.addPaths.length;
    menu.addItem((item) => {
      item
        .setTitle(t(menuLabelKey('add', n), n === 1 ? undefined : { n }))
        .setIcon('book-plus')
        .setSection('action')
        .onClick(() => void deps.addPaths(plan.addPaths));
    });
  }
  if (plan.removePaths.length) {
    const n = plan.removePaths.length;
    menu.addItem((item) => {
      item
        .setTitle(t(menuLabelKey('remove', n), n === 1 ? undefined : { n }))
        .setIcon('book-minus')
        .setSection('action')
        .onClick(() => {
          new RemoveConfirmModal(deps.app, n, () => deps.removePaths(plan.removePaths)).open();
        });
    });
  }
}

/** 在插件 onload 里调一次；返回的注销函数由宿主 register 托管 */
export function registerShelfFileMenu(deps: ShelfFileMenuDeps): () => void {
  const one = deps.app.workspace.on('file-menu', (menu, file) => {
    attach(menu, [file], deps);
  });
  const many = deps.app.workspace.on('files-menu', (menu, files) => {
    attach(menu, files, deps);
  });
  return () => {
    deps.app.workspace.offref(one);
    deps.app.workspace.offref(many);
  };
}

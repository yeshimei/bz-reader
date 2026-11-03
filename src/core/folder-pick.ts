/* ============================================================
 * bz-reader · 文件夹选择器（core/folder-pick.ts）
 *
 * 为什么不让用户手输路径：vault 里的路径有口径（分隔符、首尾斜杠、
 * 大小写），手打十有八九拼错，错了还不报错——文件写进了别处。
 * 所以只给一张目录清单让人挑，不设输入框。
 *
 * 用 FuzzySuggestModal 而不是自造列表：搜索、键盘上下、Esc 关闭
 * 都是宿主原生的，与 Ctrl+O 快速切换同一套手感。
 * ============================================================ */
import { FuzzySuggestModal, TFolder, type App } from 'obsidian';

class FolderPickModal extends FuzzySuggestModal<TFolder> {
  private resolve: (v: string | null) => void = () => undefined;
  private settled = false;

  constructor(app: App, private current: string) {
    super(app);
    this.setPlaceholder('选择书籍导入到哪个文件夹…');
  }

  /** 返回选中的文件夹路径；库根目录是 '/'。取消返回 null。 */
  pick(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  getItems(): TFolder[] {
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder);
    // 根目录排最前，其余按路径排序；当前使用中的文件夹置顶并标注
    folders.sort((a, b) => a.path.localeCompare(b.path));
    return folders;
  }

  getItemText(f: TFolder): string {
    const path = f.path || '/';
    return path === this.current ? `${path}（当前）` : path;
  }

  onChooseItem(f: TFolder): void {
    this.settle(f.path || '/');
  }

  onClose(): void {
    super.onClose();
    this.settle(null);
  }

  private settle(v: string | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(v);
  }
}

/** 打开文件夹选择器。取消返回 null；选库根目录返回 '/'。 */
export function pickFolder(app: App, current: string): Promise<string | null> {
  return new FolderPickModal(app, current).pick();
}

/** 展示用：'/' 显示成「库根目录」 */
export function folderLabel(dir: string): string {
  return !dir || dir === '/' ? '库根目录' : dir;
}

/* ============================================================
 * bz-reader · 书架视图（shell/study-view.ts）
 *
 * 一个中心 ItemView，内部四页：书库 / 笔记 / 统计 / 设置。
 *
 * 为什么是一个视图而不是四个：四个页各占一个 tab 会把 tab 栏塞满，
 * 而它们的使用频率都不高（整理书单、翻笔记、看统计、调设置）。
 * 合成一个「书架」之后，tab 栏只剩「阅读」和「书架」。
 *
 * 渲染在 shelf-panel.ts 与 shelf-page.ts 里；这个类只管「画在哪」。
 * ============================================================ */
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { setState, type StudyPage } from './state';
import { ShelfPanel } from './shelf-panel';

/** 保留旧值：已保存的工作区布局按这个字符串恢复 leaf */
export const VIEW_TYPE_STUDY = 'bzs-study';

export class StudyView extends ItemView {
  private panel: ShelfPanel | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_STUDY;
  }

  getDisplayText(): string {
    return '书架';
  }

  getIcon(): string {
    return 'library';
  }

  async onOpen(): Promise<void> {
    this.panel = new ShelfPanel(this.contentEl);
    this.panel.mount();
  }

  async onClose(): Promise<void> {
    this.panel?.destroy();
    this.panel = null;
  }

  /**
   * 宿主在窗口 / 侧栏尺寸变化时调它。
   *
   * 书库筛选行按「这一块有多宽」决定摊开还是收成下拉（见 isCompactLibrary），
   * 不接这一下，把窗口从半屏拉到全屏之后整行还停在四颗下拉。
   */
  onResize(): void {
    this.panel?.onResize();
  }

  /** 外部切页（命令面板 / 侧栏「换书」时用） */
  setPage(page: StudyPage): void {
    setState({ studyPage: page });
  }
}

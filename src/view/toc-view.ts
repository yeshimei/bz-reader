/* ============================================================
 * bz-reader · 目录侧栏（view/toc-view.ts）
 *
 * 目录做成 Obsidian 自己的左侧栏 leaf，而不是阅读视图里浮出来的抽屉：
 * 桌面上阅读区不吃遮挡、能一边看目录一边翻页，也能和书页并排。
 *
 * 它只认识 toc-state：读快照、点章节就调 jumpTo，不 import 引擎、
 * 不 import 阅读视图（否则关书之后还得担心对面是不是还活着）。
 *
 * 移动端仍用原来的全屏抽屉（ui/toc.ts）——手机上左侧栏是滑出式抽屉，
 * 和微信读书那种整屏目录比起来，翻章太费劲。
 * ============================================================ */
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { FoliateTOCItem } from '../types/foliate';
import { clear, el } from '../ui/dom';
import { getToc, jumpTo, subscribeToc } from './toc-state';

export const VIEW_TYPE_TOC = 'bz-reader-toc';

interface Row {
  label: string;
  node: HTMLElement;
}

export class TocView extends ItemView {
  private countEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private rows: Row[] = [];
  private lastBookId = '';
  private lastItems: FoliateTOCItem[] | null = null;
  private lastActive = '';

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TOC;
  }

  getDisplayText(): string {
    return '目录';
  }

  getIcon(): string {
    return 'list';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('bzr-tocv-content');
    this.buildShell();
    this.register(subscribeToc(() => this.render()));
    this.render();
  }

  private buildShell(): void {
    this.contentEl.empty();
    const root = el('div', 'bzr-tocv');
    const head = el('div', 'bzr-tocv-h');
    const count = el('span', 'bzr-tocv-n', '');
    head.append(el('span', 'bzr-tocv-t', '目录'), count);
    const body = el('div', 'bzr-tocv-b');
    root.append(head, body);
    this.contentEl.appendChild(root);
    this.countEl = count;
    this.listEl = body;
  }

  /* ─────────────────── 渲染 ─────────────────── */

  private render(): void {
    const list = this.listEl;
    if (!list) return;
    const snap = getToc();

    if (!snap) {
      this.lastBookId = '';
      this.lastItems = null;
      this.lastActive = '';
      this.rows = [];
      if (this.countEl) this.countEl.textContent = '';
      clear(list);
      list.appendChild(el('div', 'bzr-tocv-empty', '打开一本书，目录会出现在这里'));
      return;
    }

    // 同一本书、同一份目录：只挪高亮，别重建——重建会把正在滚的列表弹回顶部
    if (snap.bookId === this.lastBookId && snap.items === this.lastItems) {
      this.setActive(snap.activeLabel);
      return;
    }

    this.lastBookId = snap.bookId;
    this.lastItems = snap.items;
    this.rows = [];
    clear(list);
    if (!snap.items.length) {
      list.appendChild(el('div', 'bzr-tocv-empty', '这本书没有目录'));
      if (this.countEl) this.countEl.textContent = '';
      return;
    }
    const n = this.renderLevel(snap.items, 0, list);
    if (this.countEl) this.countEl.textContent = `${n} 节`;
    this.lastActive = '';
    this.setActive(snap.activeLabel);
    // 换书之后把当前章滚进视野（长目录一开就停在第 1 章等于没做）
    const active = list.querySelector('.bzr-toc-i.is-on');
    if (active) active.scrollIntoView({ block: 'center' });
  }

  private renderLevel(items: FoliateTOCItem[], depth: number, parent: HTMLElement): number {
    let n = 0;
    for (const item of items) {
      const cls = depth === 0 ? 'bzr-toc-i' : depth === 1 ? 'bzr-toc-i d1' : 'bzr-toc-i d2';
      const row = el('button', cls);
      row.type = 'button';
      row.textContent = item.label || '（未命名章节）';
      row.title = item.label || '';
      row.addEventListener('click', () => {
        if (item.href) jumpTo(item.href);
      });
      parent.appendChild(row);
      this.rows.push({ label: item.label, node: row });
      n += 1;
      if (item.subitems?.length) n += this.renderLevel(item.subitems, depth + 1, parent);
    }
    return n;
  }

  private setActive(label: string): void {
    if (label === this.lastActive) return;
    this.lastActive = label;
    for (const row of this.rows) row.node.classList.toggle('is-on', !!label && row.label === label);
  }
}

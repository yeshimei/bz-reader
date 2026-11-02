/* ============================================================
 * bz-reader · 阅读侧栏（view/side-view.ts）
 *
 * 目录、书签、划线三块都在 Obsidian 自己的左侧栏里，一个 leaf 三个页签。
 * 做成一个 leaf 而不是三个：三块都是「这本书里的位置索引」，同看同关；
 * 分成三个 leaf，用户很快会有一列没人看的页签。
 *
 * 它只认识两份快照（toc-state / notes-state），不 import 引擎、不 import
 * 阅读视图。谁先 onOpen 都行，书关了就显示空态而不是崩。
 *
 * 移动端不走这里：手机上的左侧栏是滑出式抽屉，长目录翻起来太费劲，
 * 那边仍是整屏抽屉（ui/toc.ts）。
 * ============================================================ */
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type { FoliateTOCItem } from '../types/foliate';
import { clear, el } from '../ui/dom';
import { getToc, jumpTo, subscribeToc } from './toc-state';
import { getNotes, jumpToCfi, subscribeNotes } from './notes-state';
import { renderBookmarkList, renderHighlightList } from '../ui/note-list';

export const VIEW_TYPE_TOC = 'bz-reader-toc';

type Tab = 'toc' | 'bookmarks' | 'highlights';

interface TabDef {
  key: Tab;
  label: string;
}

export class SideView extends ItemView {
  private tabsEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private tab: Tab = 'toc';
  private tabNodes = new Map<Tab, HTMLButtonElement>();
  private rows: Array<{ label: string; node: HTMLElement }> = [];
  private lastTocRef: FoliateTOCItem[] | null = null;
  private lastBookId = '';
  private lastActive = '';

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TOC;
  }

  getDisplayText(): string {
    return '阅读';
  }

  getIcon(): string {
    return 'list';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('bzr-tocv-content');
    this.buildShell();
    this.register(subscribeToc(() => this.render()));
    if (__BZ_READER_PRO__) this.register(subscribeNotes(() => this.render()));
    this.render();
  }

  private buildShell(): void {
    this.contentEl.empty();
    const root = el('div', 'bzr-tocv');
    const head = el('div', 'bzr-tocv-h');
    const tabs = el('div', 'bzr-side-tabs');
    const defs: TabDef[] = __BZ_READER_PRO__
      ? [
          { key: 'toc', label: '目录' },
          { key: 'bookmarks', label: '书签' },
          { key: 'highlights', label: '划线' },
        ]
      : [{ key: 'toc', label: '目录' }];
    for (const def of defs) {
      const b = el('button', 'bzr-side-tab', def.label) as HTMLButtonElement;
      b.type = 'button';
      b.dataset.tab = def.key;
      b.addEventListener('click', () => {
        if (this.tab === def.key) return;
        this.tab = def.key;
        this.render();
      });
      this.tabNodes.set(def.key, b);
      tabs.appendChild(b);
    }
    head.appendChild(tabs);
    const body = el('div', 'bzr-tocv-b');
    root.append(head, body);
    this.contentEl.appendChild(root);
    this.tabsEl = tabs;
    this.listEl = body;
  }

  /* ─────────────────── 渲染 ─────────────────── */

  private render(): void {
    const list = this.listEl;
    if (!list) return;
    for (const [key, node] of this.tabNodes) node.classList.toggle('is-on', key === this.tab);

    if (this.tab === 'toc') this.renderToc(list);
    else if (this.tab === 'bookmarks') this.renderBookmarks(list);
    else this.renderHighlights(list);
    this.paintCounts();
  }

  private paintCounts(): void {
    const toc = getToc();
    const notes = __BZ_READER_PRO__ ? getNotes() : null;
    const counts: Record<Tab, number> = {
      toc: toc ? countToc(toc.items) : 0,
      bookmarks: notes?.bookmarks.length ?? 0,
      highlights: notes?.highlights.length ?? 0,
    };
    for (const [key, node] of this.tabNodes) {
      let badge = node.querySelector<HTMLElement>('.n');
      const n = counts[key];
      if (!n) {
        badge?.remove();
        continue;
      }
      if (!badge) {
        badge = el('span', 'n');
        node.appendChild(badge);
      }
      badge.textContent = String(n);
    }
  }

  private emptyState(list: HTMLElement, text: string): void {
    clear(list);
    this.rows = [];
    this.lastTocRef = null;
    this.lastBookId = '';
    list.appendChild(el('div', 'bzr-tocv-empty', text));
  }

  private renderToc(list: HTMLElement): void {
    const snap = getToc();
    if (!snap) {
      this.emptyState(list, '打开一本书，目录会出现在这里');
      return;
    }
    // 同一本书、同一份目录：只挪高亮，别重建——重建会把正在滚的列表弹回顶部
    if (snap.bookId === this.lastBookId && snap.items === this.lastTocRef) {
      this.lastActive = ''; // 强制重设，否则同 label 时会被提前 return
      this.setActive(snap.activeLabel);
      return;
    }
    this.lastBookId = snap.bookId;
    this.lastTocRef = snap.items;
    this.rows = [];
    clear(list);
    if (!snap.items.length) {
      list.appendChild(el('div', 'bzr-tocv-empty', '这本书没有目录'));
      return;
    }
    this.renderLevel(snap.items, 0, list);
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

  /** 书签页签 */
  private renderBookmarks(list: HTMLElement): void {
    this.lastTocRef = null;
    this.lastBookId = '';
    clear(list);
    this.rows = [];
    const snap = getNotes();
    if (!snap) {
      list.appendChild(el('div', 'bzr-tocv-empty', '打开一本书，书签会出现在这里'));
      return;
    }
    renderBookmarkList(list, snap.bookmarks, {
      onJump: (cfi) => jumpToCfi(cfi),
      onRemove: snap.removeBookmark,
    });
  }

  /** 划线页签 */
  private renderHighlights(list: HTMLElement): void {
    this.lastTocRef = null;
    this.lastBookId = '';
    clear(list);
    this.rows = [];
    const snap = getNotes();
    if (!snap) {
      list.appendChild(el('div', 'bzr-tocv-empty', '打开一本书，划线会出现在这里'));
      return;
    }
    renderHighlightList(list, snap.highlights, {
      onJump: (cfi) => jumpToCfi(cfi),
      onRemove: snap.removeHighlight,
    });
  }
}

function countToc(items: FoliateTOCItem[]): number {
  let n = 0;
  for (const i of items) {
    n += 1;
    if (i.subitems?.length) n += countToc(i.subitems);
  }
  return n;
}

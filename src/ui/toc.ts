/* ============================================================
 * bz-reader · 导航抽屉（ui/toc.ts）
 *
 * 只有移动端用得上（桌面走 Obsidian 左侧栏的 side-view）。手机上的
 * 左侧栏是滑出式抽屉，长目录翻起来太费劲，所以这里占满整屏。
 *
 * 三个页签：目录 / 书签 / 划线。后两个只在高级版存在——渲染函数由
 * `notes` 提供者驱动，基础版传不进来，就只长出目录一个页签。
 *
 * 当前章节高亮靠标题比对：foliate 的 TOC 项不带 section index，
 * 但 relocate 事件给的是 tocItem.label，两者同源，比得上。
 * 高亮用「改 class」而不是重建 DOM——重建会让正在滚的列表跳回顶部。
 * ============================================================ */
import type { FoliateTOCItem } from '../types/foliate';
import type { NotesSnapshot } from '../view/notes-state';
import { clear, el } from './dom';
import { renderBookmarkList, renderHighlightList } from './note-list';

type Tab = 'toc' | 'bookmarks' | 'highlights';

export interface NavPanelDeps {
  /** 标注快照；缺省（基础版）就只有目录一个页签 */
  notes?: () => NotesSnapshot | null;
}

export interface TocPanel {
  root: HTMLElement;
  scrim: HTMLElement;
  show: () => void;
  hide: () => void;
  isOpen: () => boolean;
  setItems: (items: FoliateTOCItem[]) => void;
  setActive: (title: string) => void;
  /** 标注变了之后重画当前页签（书签/划线页签开着时才有意义） */
  refresh: () => void;
}

interface Row {
  label: string;
  node: HTMLElement;
}

export function createTocPanel(onPick: (href: string) => void, deps: NavPanelDeps = {}): TocPanel {
  const scrim = el('div', 'bzr-scrim');
  const root = el('div', 'bzr-drawer bzr-nav');
  const head = el('div', 'bzr-drawer-h');
  const tabsEl = el('div', 'bzr-side-tabs');
  const close = el('button', 'bzr-drawer-x', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭');
  const count = el('span', 'bzr-drawer-count', '');
  head.append(tabsEl, count, close);
  const body = el('div', 'bzr-drawer-b');
  root.append(head, body);

  let tab: Tab = 'toc';
  let items: FoliateTOCItem[] = [];
  let rows: Row[] = [];
  let activeTitle = '';
  const tabNodes = new Map<Tab, HTMLButtonElement>();

  const defs: Array<{ key: Tab; label: string }> = deps.notes
    ? [
        { key: 'toc', label: '目录' },
        { key: 'bookmarks', label: '书签' },
        { key: 'highlights', label: '划线' },
      ]
    : [{ key: 'toc', label: '目录' }];

  for (const def of defs) {
    const b = el('button', 'bzr-side-tab', def.label) as HTMLButtonElement;
    b.type = 'button';
    b.addEventListener('click', () => {
      if (tab === def.key) return;
      tab = def.key;
      rebuild();
    });
    tabNodes.set(def.key, b);
    tabsEl.appendChild(b);
  }

  function renderLevel(list: FoliateTOCItem[], depth: number, parent: HTMLElement): number {
    let n = 0;
    for (const item of list) {
      const cls = depth === 0 ? 'bzr-toc-i' : depth === 1 ? 'bzr-toc-i d1' : 'bzr-toc-i d2';
      const row = el('button', cls);
      row.type = 'button';
      row.textContent = item.label || '（未命名章节）';
      if (item.label === activeTitle) row.classList.add('is-on');
      row.addEventListener('click', () => {
        if (item.href) onPick(item.href);
        hide();
      });
      parent.appendChild(row);
      rows.push({ label: item.label, node: row });
      n += 1;
      if (item.subitems?.length) n += renderLevel(item.subitems, depth + 1, parent);
    }
    return n;
  }

  function paintTabs(): void {
    for (const [key, node] of tabNodes) node.classList.toggle('is-on', key === tab);
  }

  function rebuild(): void {
    paintTabs();
    clear(body);
    rows = [];
    count.textContent = '';

    if (tab === 'toc') {
      if (!items.length) {
        body.appendChild(el('div', 'bzr-empty-line', '这本书没有目录'));
        return;
      }
      const n = renderLevel(items, 0, body);
      count.textContent = `${n} 节`;
      return;
    }

    const snap = deps.notes?.() ?? null;
    if (!snap) {
      body.appendChild(el('div', 'bzr-empty-line', '这本书还没有标注'));
      return;
    }
    const handlers = {
      onJump: (cfi: string) => {
        snap.jump(cfi);
        hide();
      },
      onRemove: (id: string) => {
        if (tab === 'bookmarks') snap.removeBookmark(id);
        else snap.removeHighlight(id);
        rebuild();
      },
    };
    if (tab === 'bookmarks') {
      renderBookmarkList(body, snap.bookmarks, handlers);
      count.textContent = snap.bookmarks.length ? `${snap.bookmarks.length} 条` : '';
    } else {
      renderHighlightList(body, snap.highlights, handlers);
      count.textContent = snap.highlights.length ? `${snap.highlights.length} 条` : '';
    }
  }

  function show(): void {
    rebuild();
    root.classList.add('is-open');
    scrim.classList.add('is-open');
    // 打开时把当前章滚到视野中间（目录长的书，一开就停在第 1 章等于没做）
    const active = body.querySelector('.bzr-toc-i.is-on');
    if (active) active.scrollIntoView({ block: 'center' });
  }

  function hide(): void {
    root.classList.remove('is-open');
    scrim.classList.remove('is-open');
  }

  close.addEventListener('click', hide);
  scrim.addEventListener('click', hide);

  return {
    root,
    scrim,
    show,
    hide,
    isOpen: () => root.classList.contains('is-open'),
    setItems: (list) => {
      items = list;
      if (root.classList.contains('is-open') && tab === 'toc') rebuild();
    },
    setActive: (t) => {
      if (t === activeTitle) return;
      activeTitle = t;
      for (const row of rows) row.node.classList.toggle('is-on', row.label === t);
    },
    refresh: () => {
      if (root.classList.contains('is-open') && tab !== 'toc') rebuild();
    },
  };
}

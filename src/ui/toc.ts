/* ============================================================
 * bz-reader · 目录抽屉（ui/toc.ts）
 *
 * 桌面：左侧 246px 抽屉 + 遮罩（找章节是横向浏览，从左边滑出最贴直觉）
 * 移动：占满整屏（章节多、要滚，抽屉那点宽度撑不住）
 *
 * 当前章节高亮靠标题比对：foliate 的 TOC 项不带 section index，
 * 但 relocate 事件给的是 tocItem.label，两者同源，比得上。
 * 高亮用「改 class」而不是重建 DOM——重建会让正在滚的列表跳回顶部。
 * ============================================================ */
import type { FoliateTOCItem } from '../types/foliate';
import { clear, el } from './dom';

export interface TocPanel {
  root: HTMLElement;
  scrim: HTMLElement;
  show: () => void;
  hide: () => void;
  isOpen: () => boolean;
  setItems: (items: FoliateTOCItem[]) => void;
  setActive: (title: string) => void;
}

interface Row {
  label: string;
  node: HTMLElement;
}

export function createTocPanel(onPick: (href: string) => void): TocPanel {
  const scrim = el('div', 'bzr-scrim');
  const root = el('div', 'bzr-drawer');
  const head = el('div', 'bzr-drawer-h');
  const close = el('button', 'bzr-drawer-x', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭目录');
  const count = el('span', 'bzr-drawer-count', '');
  head.append(close, el('span', '', '目录'), count);
  const body = el('div', 'bzr-drawer-b');
  root.append(head, body);

  let items: FoliateTOCItem[] = [];
  let rows: Row[] = [];
  let activeTitle = '';
  let built = false;

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

  function rebuild(): void {
    clear(body);
    rows = [];
    if (!items.length) {
      body.appendChild(el('div', 'bzr-empty-line', '这本书没有目录'));
      count.textContent = '';
    } else {
      const n = renderLevel(items, 0, body);
      count.textContent = `${n} 节`;
    }
    built = true;
  }

  function show(): void {
    if (!built) rebuild();
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
      built = false;
      if (root.classList.contains('is-open')) rebuild();
    },
    setActive: (t) => {
      if (t === activeTitle) return;
      activeTitle = t;
      for (const row of rows) row.node.classList.toggle('is-on', row.label === t);
    },
  };
}

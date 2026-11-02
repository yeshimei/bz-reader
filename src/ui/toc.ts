/* ============================================================
 * bz-reader · 目录抽屉（ui/toc.ts）
 *
 * 从左侧滑出的章节树。树形结构直接用 foliate 的 subitems，
 * 最多三层——再深的目录（中文古籍那种「卷/章/节/目」）缩进已经分不清了。
 *
 * 当前章节高亮只靠标题比对：foliate 的 TOC 项不带 section index，
 * 但 relocate 事件给的是 tocItem.label，两者同源，比得上。
 * ============================================================ */
import type { FoliateTOCItem } from '../types/foliate';
import { clear, el } from './dom';

export interface TocPanel {
  root: HTMLElement;
  show: () => void;
  hide: () => void;
  isOpen: () => boolean;
  setItems: (items: FoliateTOCItem[]) => void;
  setActive: (title: string) => void;
}

export function createTocPanel(onPick: (href: string) => void): TocPanel {
  const root = el('div', 'bzr-drawer');
  const head = el('div', 'bzr-drawer-head');
  const title = el('div', 'bzr-drawer-title', '目录');
  const close = el('button', 'bzr-icon-btn', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭目录');
  head.append(title, close);
  const body = el('div', 'bzr-drawer-body');
  root.append(head, body);

  let items: FoliateTOCItem[] = [];
  let activeTitle = '';
  let built = false;

  function renderLevel(list: FoliateTOCItem[], depth: number, parent: HTMLElement): void {
    for (const item of list) {
      const row = el('button', 'bzr-toc-item');
      row.type = 'button';
      row.style.paddingLeft = `${12 + depth * 14}px`;
      row.textContent = item.label || '（未命名章节）';
      if (item.label === activeTitle) row.classList.add('is-active');
      row.addEventListener('click', () => {
        if (item.href) onPick(item.href);
        hide();
      });
      parent.appendChild(row);
      if (item.subitems?.length) renderLevel(item.subitems, depth + 1, parent);
    }
  }

  function rebuild(): void {
    clear(body);
    if (!items.length) {
      body.appendChild(el('div', 'bzr-empty-line', '这本书没有目录'));
    } else {
      renderLevel(items, 0, body);
    }
    built = true;
  }

  function show(): void {
    if (!built) rebuild();
    root.classList.add('is-open');
  }
  function hide(): void {
    root.classList.remove('is-open');
  }

  close.addEventListener('click', hide);

  return {
    root,
    show,
    hide,
    isOpen: () => root.classList.contains('is-open'),
    setItems: (list) => {
      items = list;
      if (root.classList.contains('is-open')) rebuild();
      else built = false;
    },
    setActive: (t) => {
      activeTitle = t;
      if (root.classList.contains('is-open')) rebuild();
    },
  };
}

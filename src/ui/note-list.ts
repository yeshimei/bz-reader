/* ============================================================
 * bz-reader · 标注列表（ui/note-list.ts）
 *
 * 书签与划线要在两个地方出现：桌面的左侧栏、移动端的整屏抽屉。
 * 两个宿主差得远（一个窄列、一个铺满），但条目本身是同一个东西——
 * 所以在这一处渲染，谁要谁调，别写两套，否则「桌面删得掉、手机删不掉」
 * 这种不对称会一直存在。
 *
 * 视觉对齐原型（reader-v2 叁）：书签是「菱形铜点 + 章名 + 衬线日期」的
 * 一行小字；划线是分组列表，条目左缘一条划线色竖线，引文衬线，
 * 想法缩在引文下面。删除钮平时藏着，hover 行才现身——列表是拿来看的，
 * 不是拿来删的。
 * ============================================================ */
import type { Bookmark, Highlight } from '../data/schema';
import { colorCss } from '../data/notes';
import { clear, el } from './dom';

export interface ListHandlers {
  onJump: (cfi: string) => void;
  onRemove: (id: string) => void;
}

export function renderBookmarkList(parent: HTMLElement, bookmarks: Bookmark[], handlers: ListHandlers): void {
  clear(parent);
  if (!bookmarks.length) {
    parent.appendChild(el('div', 'bzr-tocv-empty', '还没有书签。\n阅读时点头栏的书签图标，就能把这一页记下来。'));
    return;
  }
  const items = [...bookmarks].sort((a, b) => a.percent - b.percent);
  for (const b of items) {
    const row = el('button', 'bzr-bmk');
    row.type = 'button';
    row.appendChild(el('i'));
    row.appendChild(el('span', 'tt', b.chapterTitle || b.label || '未命名章节'));
    row.appendChild(el('span', 'sp'));
    row.appendChild(el('em', '', fmtDate(b.createdAt)));
    row.addEventListener('click', () => {
      if (b.cfi) handlers.onJump(b.cfi);
    });
    row.appendChild(removeButton('删除书签', b.id, handlers.onRemove));
    parent.appendChild(row);
  }
}

export function renderHighlightList(parent: HTMLElement, highlights: Highlight[], handlers: ListHandlers): void {
  clear(parent);
  if (!highlights.length) {
    parent.appendChild(el('div', 'bzr-tocv-empty', '还没有划线。\n在正文里选中一段文字，浮出的色点里挑一个颜色。'));
    return;
  }
  for (const group of groupByChapter(highlights)) {
    const box = el('div', 'bzr-hl-g');
    const head = el('div', 'bzr-hl-gh');
    head.append(el('span', 't', group.title), el('span', 'n', String(group.items.length)));
    box.appendChild(head);
    for (const h of group.items) {
      const row = el('div', 'bzr-hlit');
      row.style.setProperty('--c', colorCss(h.color));
      const main = el('button', 'bzr-hlit-main');
      main.type = 'button';
      main.appendChild(el('span', 'tx', h.text));
      if (h.comment) main.appendChild(el('span', 'cm', h.comment));
      main.addEventListener('click', () => {
        if (h.cfiRange) handlers.onJump(h.cfiRange);
      });
      row.append(main, removeButton('删除这条划线', h.id, handlers.onRemove));
      box.appendChild(row);
    }
    parent.appendChild(box);
  }
}

function removeButton(label: string, id: string, onRemove: (id: string) => void): HTMLButtonElement {
  const x = el('button', 'bzr-note-x', '×') as HTMLButtonElement;
  x.type = 'button';
  x.title = label;
  x.setAttribute('aria-label', label);
  x.addEventListener('click', (ev) => {
    ev.stopPropagation();
    onRemove(id);
  });
  return x;
}

/** 11月2日 这种短日期：侧栏里日期是「什么时候记的」的坐标，不是档案 */
function fmtDate(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function groupByChapter(highlights: Highlight[]): Array<{ title: string; items: Highlight[] }> {
  const out: Array<{ title: string; items: Highlight[] }> = [];
  const index = new Map<string, { title: string; items: Highlight[] }>();
  const sorted = [...highlights].sort((a, b) => {
    const ca = a.chapterIndex ?? 0;
    const cb = b.chapterIndex ?? 0;
    return ca !== cb ? ca - cb : a.createdAt - b.createdAt;
  });
  for (const h of sorted) {
    const title = h.chapterTitle?.trim() || '未命名章节';
    let g = index.get(title);
    if (!g) {
      g = { title, items: [] };
      index.set(title, g);
      out.push(g);
    }
    g.items.push(h);
  }
  return out;
}

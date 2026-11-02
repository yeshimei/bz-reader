/* ============================================================
 * bz-reader · 搜索（ui/search-panel.ts）
 *
 * 桌面从顶上压下来（搜索是自上而下地扫），移动端占满整屏（结果要长度）。
 * 基础版只搜当前章节；全书搜索是高级版能力，差别只在传不传章节 index。
 *
 * 命中行的关键词高亮是**逐个文本节点拼**出来的，不走 innerHTML——
 * 书里的摘录带书名号、尖括号，一路 innerHTML 下去迟早被当成标签解析。
 * ============================================================ */
import { clear, el, searchIcon } from './dom';

export interface SearchHitline {
  cfi: string;
  excerpt: string;
  chapterLabel?: string;
}

export interface SearchPanelDeps {
  search: (query: string) => Promise<SearchHitline[]>;
  onPick: (cfi: string) => void;
  onClose: () => void;
}

export interface SearchPanel {
  root: HTMLElement;
  show: () => void;
  hide: () => void;
  isOpen: () => boolean;
}

/** 把 query 在 text 里的每一处包成 <em>（大小写不敏感，按字面匹配） */
function withMarks(text: string, query: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const q = query.trim();
  if (!q) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let at = 0;
  while (at <= text.length) {
    const found = lower.indexOf(needle, at);
    if (found < 0) {
      frag.appendChild(document.createTextNode(text.slice(at)));
      break;
    }
    if (found > at) frag.appendChild(document.createTextNode(text.slice(at, found)));
    frag.appendChild(el('em', '', text.slice(found, found + q.length)));
    at = found + q.length;
  }
  return frag;
}

export function createSearchPanel(deps: SearchPanelDeps): SearchPanel {
  const root = el('div', 'bzr-sb');
  const bar = el('div', 'bzr-sb-bar');
  const input = el('input');
  input.type = 'search';
  input.placeholder = '在本章内搜索';
  input.spellcheck = false;
  const well = el('div', 'bzr-sb-input');
  well.appendChild(input);
  const count = el('span', 'bzr-sb-count', '');
  const cancel = el('button', 'bzr-sb-cancel', '取消');
  cancel.type = 'button';
  bar.append(searchIcon(), well, count, cancel);

  const status = el('div', 'bzr-sb-status', '');
  const hits = el('div', 'bzr-sb-hits');
  root.append(bar, status, hits);

  let timer: number | null = null;
  let seq = 0;

  async function run(q: string): Promise<void> {
    const mySeq = ++seq;
    clear(hits);
    if (!q.trim()) {
      status.textContent = '';
      count.textContent = '';
      return;
    }
    status.textContent = '搜索中…';
    const found = await deps.search(q).catch(() => []);
    if (mySeq !== seq) return; // 后一次输入已经覆盖，丢掉这次结果
    count.textContent = found.length ? String(found.length) : '';
    status.textContent = found.length ? `本章 ${found.length} 处` : '本章没有匹配';
    for (const hit of found) {
      const row = el('button', 'bzr-sb-hit');
      row.type = 'button';
      row.appendChild(withMarks(hit.excerpt || '（无摘录）', q));
      if (hit.chapterLabel) row.appendChild(el('span', 'bzr-sb-loc', hit.chapterLabel));
      row.addEventListener('click', () => deps.onPick(hit.cfi));
      hits.appendChild(row);
    }
  }

  input.addEventListener('input', () => {
    if (timer !== null) window.clearTimeout(timer);
    const q = input.value;
    timer = window.setTimeout(() => void run(q), 200);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      hide();
    }
  });
  cancel.addEventListener('click', () => hide());

  function show(): void {
    root.classList.add('is-open');
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }
  function hide(): void {
    if (!root.classList.contains('is-open')) return;
    root.classList.remove('is-open');
    deps.onClose();
  }

  return { root, show, hide, isOpen: () => root.classList.contains('is-open') };
}

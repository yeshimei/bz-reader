/* ============================================================
 * bz-reader · 搜索面板（ui/search-panel.ts）
 *
 * 基础版只搜当前章节（全书搜索是高级版能力，这里是同一个 foliate 接口，
 * 差别只在传不传章节 index）。结果点一下就跳过去，并保留高亮。
 * ============================================================ */
import { clear, el } from './dom';

export interface SearchPanelDeps {
  search: (query: string) => Promise<Array<{ cfi: string; excerpt: string }>>;
  onPick: (cfi: string) => void;
  onClose: () => void;
}

export interface SearchPanel {
  root: HTMLElement;
  show: () => void;
  hide: () => void;
  isOpen: () => boolean;
}

export function createSearchPanel(deps: SearchPanelDeps): SearchPanel {
  const root = el('div', 'bzr-searchbox');
  const bar = el('div', 'bzr-searchbar');
  const input = el('input', 'bzr-search-input');
  input.type = 'search';
  input.placeholder = '在本章内搜索';
  const close = el('button', 'bzr-icon-btn', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭搜索');
  bar.append(input, close);

  const status = el('div', 'bzr-search-status', '');
  const list = el('div', 'bzr-search-list');
  root.append(bar, status, list);

  let timer: number | null = null;
  let seq = 0;

  async function run(q: string): Promise<void> {
    const mySeq = ++seq;
    clear(list);
    if (!q.trim()) {
      status.textContent = '';
      return;
    }
    status.textContent = '搜索中…';
    const hits = await deps.search(q).catch(() => []);
    if (mySeq !== seq) return; // 后一次输入已经覆盖，丢掉这次结果
    status.textContent = hits.length ? `本章 ${hits.length} 处` : '本章没有匹配';
    for (const hit of hits) {
      const row = el('button', 'bzr-search-hit');
      row.type = 'button';
      row.textContent = hit.excerpt || '（无摘录）';
      row.addEventListener('click', () => deps.onPick(hit.cfi));
      list.appendChild(row);
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
  close.addEventListener('click', () => hide());

  function show(): void {
    root.classList.add('is-open');
    window.setTimeout(() => input.focus(), 0);
  }
  function hide(): void {
    root.classList.remove('is-open');
    deps.onClose();
  }

  return { root, show, hide, isOpen: () => root.classList.contains('is-open') };
}

/* ============================================================
 * bz-reader · 搜索（ui/search-panel.ts）
 *
 * 桌面从顶上压下来（搜索是自上而下地扫），移动端占满整屏（结果要长度）。
 * 基础版只搜当前章节；全书搜索是高级版能力，差别只在传不传章节 index。
 *
 * 命中行的关键词高亮是**逐个文本节点拼**出来的，不走 innerHTML——
 * 书里的摘录带书名号、尖括号，一路 innerHTML 下去迟早被当成标签解析。
 *
 * 全书搜索边搜边出：引擎每命中一条就报一条（onHit），这里立刻挂上去。
 * 一本长篇要扫好几秒，让人盯着「搜索中…」转圈和看着结果一条条长出来，
 * 是两种完全不同的等待体验。
 * ============================================================ */
import { clear, el, searchIcon } from './dom';

export type SearchScope = 'chapter' | 'book';

export interface SearchHitline {
  cfi: string;
  excerpt: string;
  chapterLabel?: string;
}

export interface SearchPanelDeps {
  search: (
    query: string,
    scope: SearchScope,
    onHit: (hit: SearchHitline) => void,
  ) => Promise<SearchHitline[]>;
  onPick: (cfi: string) => void;
  onClose: () => void;
}

export interface SearchPanel {
  root: HTMLElement;
  show: () => void;
  hide: () => void;
  isOpen: () => boolean;
  /** 当前范围（换书时上层可能要看一眼） */
  scope: () => SearchScope;
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
  input.spellcheck = false;
  const well = el('div', 'bzr-sb-input');
  well.appendChild(input);
  const count = el('span', 'bzr-sb-count', '');
  const cancel = el('button', 'bzr-sb-cancel', '取消');
  cancel.type = 'button';
  bar.append(searchIcon(), well, count, cancel);

  /* 范围切换：只有高级版才长出来 */
  let scope: SearchScope = 'chapter';
  const scopeBar = el('div', 'bzr-sb-scope');
  const scopeBtns: Array<{ key: SearchScope; node: HTMLButtonElement }> = [];
  const makeScope = (key: SearchScope, label: string): void => {
    const b = el('button', key === scope ? 'is-on' : '', label) as HTMLButtonElement;
    b.type = 'button';
    b.addEventListener('click', () => {
      if (scope === key) return;
      scope = key;
      // 用 if 赋值而不是三元：production 才开 minify 也会把三元两个分支都算进来，
      // 「在全书中搜索」会漏进 base 包（坑 #3 的实锤案例，2026-11-02 修）
      let hint = '在本章内搜索';
      if (__BZ_READER_PRO__ && key === 'book') hint = '在全书中搜索';
      input.placeholder = hint;
      for (const it of scopeBtns) it.node.classList.toggle('is-on', it.key === scope);
      if (input.value.trim()) void run(input.value);
      else input.focus();
    });
    scopeBtns.push({ key, node: b });
    scopeBar.appendChild(b);
  };
  // 用构建期常量而不是 deps 开关：`if (false) {...}` 会被 esbuild 整块删掉，
  // 「全书」这半边在 base 包里一行都不剩；传一个运行期 flag 就删不掉了。
  if (__BZ_READER_PRO__) {
    makeScope('chapter', '本章');
    makeScope('book', '全书');
  }
  input.placeholder = '在本章内搜索';

  const status = el('div', 'bzr-sb-status', '');
  const hits = el('div', 'bzr-sb-hits');
  root.append(bar);
  if (__BZ_READER_PRO__) root.appendChild(scopeBar);
  root.append(status, hits);

  let timer: number | null = null;
  let seq = 0;

  function statusText(n: number): string {
    // 写成 if 而不是三元：dev 构建不开 minify，三元里的分支字符串会被原样留下，
    // 于是 `grep 全书 dist/base/main.js` 有命中，看起来像基础版漏了高级功能
    let where = '本章';
    if (__BZ_READER_PRO__ && scope === 'book') where = '全书';
    return n ? `${where} ${n} 处` : `${where}没有匹配`;
  }

  async function run(q: string): Promise<void> {
    const mySeq = ++seq;
    const usedScope = scope;
    clear(hits);
    if (!q.trim()) {
      status.textContent = '';
      count.textContent = '';
      return;
    }
    let searching = '搜索中…';
    if (__BZ_READER_PRO__ && usedScope === 'book') searching = '全书搜索中…';
    status.textContent = searching;
    count.textContent = '';

    // 全书结果按章节分段：几百条命中平铺在一起，人没法在上面找东西
    let group: HTMLElement | null = null;
    let groupLabel = '';
    let n = 0;

    const appendHit = (hit: SearchHitline): void => {
      if (mySeq !== seq) return;
      if (__BZ_READER_PRO__ && usedScope === 'book') {
        const label = hit.chapterLabel || '正文';
        if (label !== groupLabel) {
          groupLabel = label;
          group = el('div', 'bzr-sb-group');
          group.appendChild(el('span', 'bzr-sb-group-t', label));
          hits.appendChild(group);
        }
      }
      const row = el('button', 'bzr-sb-hit');
      row.type = 'button';
      row.appendChild(withMarks(hit.excerpt || '（无摘录）', q));
      // 本章范围下章节名全是同一个，标出来只是噪音
      if (__BZ_READER_PRO__ && usedScope === 'book' && hit.chapterLabel && !group) {
        row.appendChild(el('span', 'bzr-sb-loc', hit.chapterLabel));
      }
      row.addEventListener('click', () => deps.onPick(hit.cfi));
      (group ?? hits).appendChild(row);
      n += 1;
      count.textContent = String(n);
      let live = '搜索中…';
      if (__BZ_READER_PRO__ && usedScope === 'book') live = `全书已找到 ${n} 处…`;
      status.textContent = live;
    };

    const found = await deps.search(q, usedScope, appendHit).catch(() => []);
    if (mySeq !== seq) return; // 后一次输入已经覆盖，丢掉这次结果
    // 增量回调已经把结果挂完了；这里是「一条都没收到」时的兜底（引擎不给 onHit 的情况）
    if (!n) for (const hit of found) appendHit(hit);
    count.textContent = found.length ? String(found.length) : '';
    status.textContent = statusText(found.length);
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

  return { root, show, hide, isOpen: () => root.classList.contains('is-open'), scope: () => scope };
}

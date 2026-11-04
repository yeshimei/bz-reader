/* ============================================================
 * bz-reader · 跨书全文搜索面板（ui/cross-search-panel.ts）
 *
 * 书架的二级弹窗（高级版）：输入一句话，对书架里每本书扫全文。
 * 结果按书分组、边扫边长；点命中跳进那本书的那一页。
 *
 * 不做防抖自动搜：跨书是重操作（每本秒级），回车才开始，
 * 搜的过程给「停止」——误输入一个短词不该引发全库扫描。
 * ============================================================ */
import { Platform } from 'obsidian';
import type { App } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import { searchAcrossBooks, type CrossBookHit } from '../engine/cross-search';
import { normalizePrefs, type ReaderPrefs } from '../data/prefs';
import type { ReaderStore } from '../data/store';
import { clear, el } from './dom';
import { uiModal } from '../core/ui/modal';

export interface CrossSearchDeps {
  app: App;
  store: ReaderStore;
  books: ReaderBook[];
  onJump: (book: ReaderBook, cfi: string) => void;
}

export function openCrossSearch(deps: CrossSearchDeps): void {
  const mobile = Platform.isMobile;
  const prefs: ReaderPrefs = normalizePrefs(deps.store.get().prefs ?? undefined);

  const root = el('div', 'bzr-xs' + (mobile ? ' is-mobile' : ''));
  const bar = el('div', 'bzr-xs-bar');
  const input = el('input');
  input.type = 'search';
  input.placeholder = '在全部书里搜索';
  const go = el('button', 'bzr-btn is-primary', '搜索');
  go.type = 'button';
  const stop = el('button', 'bzr-btn', '停止');
  stop.type = 'button';
  stop.setCssProps({ display: 'none' });
  bar.append(input, go, stop);

  const status = el('div', 'bzr-xs-status', '');
  const hits = el('div', 'bzr-xs-hits');
  root.append(bar, status, hits);

  let running = false;
  let stopFlag = false;
  let seq = 0;

  function setBusy(on: boolean): void {
    running = on;
    stopFlag = on ? stopFlag : false;
    go.disabled = on;
    go.setCssProps({ display: on ? 'none' : '' });
    stop.setCssProps({ display: on ? '' : 'none' });
  }

  function groupFor(title: string): HTMLElement {
    const group = el('div', 'bzr-xs-group');
    group.appendChild(el('span', 'bzr-xs-group-t', title));
    hits.appendChild(group);
    return group;
  }

  async function run(): Promise<void> {
    const q = input.value.trim();
    if (!q || running) return;
    const mySeq = ++seq;
    setBusy(true);
    stopFlag = false;
    clear(hits);
    status.textContent = '正在扫书架…';

    const total = deps.books.length;
    let done = 0;
    let found = 0;

    await searchAcrossBooks({
      app: deps.app,
      books: deps.books,
      prefs,
      query: q,
      shouldStop: () => stopFlag || mySeq !== seq,
      onHits: (book, list: CrossBookHit[]) => {
        if (mySeq !== seq) return;
        const group = groupFor(book.meta.title);
        for (const hit of list.slice(0, 20)) {
          const row = el('button', 'bzr-xs-hit');
          row.type = 'button';
          if (hit.chapterLabel) row.appendChild(el('span', 'bzr-xs-loc', hit.chapterLabel));
          row.appendChild(document.createTextNode(hit.excerpt || '（无摘录）'));
          row.addEventListener('click', () => {
            closeAll();
            deps.onJump(book, hit.cfi);
          });
          group.appendChild(row);
        }
        if (list.length > 20) group.appendChild(el('div', 'bzr-xs-more', `还有 ${list.length - 20} 处未列出`));
        found += list.length;
        status.textContent = `已扫 ${done}/${total} 本 · 命中 ${found} 处`;
      },
      onBookDone: () => {
        if (mySeq !== seq) return;
        done += 1;
        status.textContent = `已扫 ${done}/${total} 本 · 命中 ${found} 处`;
      },
    });
    if (mySeq !== seq) return;
    setBusy(false);
    status.textContent = stopFlag
      ? '已停止'
      : found
        ? `已扫 ${total} 本 · 命中 ${found} 处`
        : total
          ? '全库没有匹配'
          : '书架是空的';
  }

  go.addEventListener('click', () => void run());
  stop.addEventListener('click', () => {
    stopFlag = true;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void run();
    }
  });

  const { close } = uiModal({
    content: root,
    className: 'bzr-xs-popup',
    title: '跨书全文搜索',
    head: true,
    maxWidth: 560,
    autofocus: false,
    onClose: () => {
      stopFlag = true;
      seq += 1;
    },
  });
  const closeAll = close;
  window.setTimeout(() => input.focus(), 0);
}

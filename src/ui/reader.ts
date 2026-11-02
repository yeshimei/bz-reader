/* ============================================================
 * bz-reader · 阅读弹窗（ui/reader.ts）
 *
 * 一屏 = 三条横栏 + 中间正文：
 *   头：返回 / 书名·章节 / 目录 · 搜索 · 排版
 *   中：foliate 渲染区（点左 30% 上一页、右 30% 下一页、中间收起工具栏）
 *   脚：上一页 / 百分比 + 剩余时间 / 下一页
 *
 * 关书时的结算顺序不能反：
 *   先结算会话 → 再落最后位置 → 再 flush 落盘 → 最后 destroy 引擎。
 * 反过来的话 destroy 先拆掉 iframe，relocate 不再触发，
 * 最后那次进度就丢了（表现是「读到 80% 关掉，重开回到 60%」）。
 * ============================================================ */
import type { App } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import type { ReaderStore } from '../data/store';
import { normalizePrefs, type ReaderPrefs } from '../data/prefs';
import { ActivityTracker } from '../engine/activity';
import { EngineHost, type RelocateInfo } from '../engine/host';
import { uiModal } from '../core/ui/modal';
import { notify } from '../core/notice';
import { durationLabel, el, percentLabel } from './dom';
import { createTocPanel } from './toc';
import { createPrefsPanel } from './prefs-panel';
import { createSearchPanel } from './search-panel';

export interface ReaderDeps {
  app: App;
  store: ReaderStore;
  book: ReaderBook;
  onClose?: () => void;
}

const COMPLETE_THRESHOLD = 0.99;

const ICON_TOC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h10M4 18h13"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>';
const ICON_TYPE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h10M9 6v12M15 11h5M17.5 11v7"/></svg>';

function iconBtn(label: string, svg: string): HTMLButtonElement {
  const b = el('button', 'bzr-icon-btn');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = svg;
  return b;
}

export function openReader(deps: ReaderDeps): void {
  const { app, store, book } = deps;

  const data = store.get();
  let prefs: ReaderPrefs = normalizePrefs(data.prefs ?? undefined);

  const root = el('div', 'bzr-reader');
  const head = el('div', 'bzr-reader-head');
  const back = el('button', 'bzr-reader-back', '书库');
  const title = el('div', 'bzr-reader-title', book.meta.title);
  const chapter = el('div', 'bzr-reader-chapter', '');
  const spacer = el('div', 'bzr-reader-spacer');
  const tocBtn = iconBtn('目录', ICON_TOC);
  const searchBtn = iconBtn('搜索本章', ICON_SEARCH);
  const prefsBtn = iconBtn('排版', ICON_TYPE);
  head.append(back, title, chapter, spacer, tocBtn, searchBtn, prefsBtn);

  const stage = el('div', 'bzr-reader-stage');

  const foot = el('div', 'bzr-reader-foot');
  const prevBtn = el('button', 'bzr-reader-nav', '上一页');
  const meta = el('div', 'bzr-reader-meta');
  const progressText = el('span', 'bzr-reader-progress-text', '');
  const remainText = el('span', 'bzr-reader-remain', '');
  meta.append(progressText, remainText);
  const nextBtn = el('button', 'bzr-reader-nav', '下一页');
  foot.append(prevBtn, meta, nextBtn);

  root.append(head, stage, foot);

  const host = new EngineHost(app);
  const tracker = new ActivityTracker();

  const toc = createTocPanel((href) => {
    void host.goToHref(href);
  });
  const prefsPanel = createPrefsPanel(prefs, (patch) => {
    prefs = normalizePrefs({ ...prefs, ...patch });
    host.applyPrefs(prefs);
    data.prefs = prefs;
    store.touch();
  });
  const search = createSearchPanel({
    search: (q) => host.search(q, { chapterOnly: true }),
    onPick: (cfi) => {
      void host.goToCfi(cfi);
      search.hide();
    },
    onClose: () => undefined,
  });
  root.append(toc.root, search.root, prefsPanel.root);

  let closed = false;
  let teardown = (): void => undefined;

  const { close } = uiModal({
    content: root,
    className: 'bzr-reader-popup',
    maxWidth: 1200,
    autofocus: false,
    onClose: () => {
      if (closed) return;
      closed = true;
      teardown();
      void settle();
      deps.onClose?.();
    },
  });

  function updateFoot(percent: number, remainingSeconds: number): void {
    progressText.textContent = percentLabel(percent);
    remainText.textContent = remainingSeconds > 0 ? `剩 ${durationLabel(remainingSeconds)}` : '';
  }

  function saveRelocate(info: RelocateInfo): void {
    book.reading.position.percent = info.percent;
    if (info.cfi) book.reading.position.cfi = info.cfi;
    book.reading.position.chapterIndex = info.chapterIndex;
    book.reading.position.chapterTitle = info.chapterTitle;
    book.reading.stats.lastReadTime = Date.now();
    if (!book.reading.stats.startReadTime) book.reading.stats.startReadTime = Date.now();
    if (info.percent >= COMPLETE_THRESHOLD && !book.reading.stats.completedTime) {
      book.reading.stats.completedTime = Date.now();
    }
    book.updatedAt = Date.now();
    if (info.chapterTitle) {
      chapter.textContent = info.chapterTitle;
      toc.setActive(info.chapterTitle);
    }
    updateFoot(info.percent, info.remainingSeconds);
    tracker.touch(info.percent);
    store.touch();
  }

  async function settle(): Promise<void> {
    host.clearSearch();
    const session = tracker.end();
    if (session) {
      book.reading.sessions.push({ ...session, percent: book.reading.position.percent });
      book.reading.stats.totalReadTime += session.durationSeconds;
      book.reading.stats.lastReadTime = Date.now();
    }
    await store.flush();
    await host.destroy();
  }

  const turn = (dir: 'prev' | 'next'): void => {
    const p = dir === 'prev' ? host.prev() : host.next();
    void p.then(() => tracker.touch());
  };

  const setBare = (bare: boolean): void => {
    root.classList.toggle('is-bare', bare);
  };
  const anyPanelOpen = (): boolean => toc.isOpen() || search.isOpen() || prefsPanel.isOpen();
  const closePanels = (): void => {
    toc.hide();
    search.hide();
    prefsPanel.hide();
  };

  prevBtn.addEventListener('click', () => turn('prev'));
  nextBtn.addEventListener('click', () => turn('next'));
  back.addEventListener('click', () => close());
  tocBtn.addEventListener('click', () => {
    const open = toc.isOpen();
    closePanels();
    if (!open) toc.show();
  });
  searchBtn.addEventListener('click', () => {
    const open = search.isOpen();
    closePanels();
    if (!open) search.show();
  });
  prefsBtn.addEventListener('click', () => {
    const open = prefsPanel.isOpen();
    closePanels();
    if (!open) prefsPanel.show();
  });

  const onKey = (e: KeyboardEvent): void => {
    if (closed) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Escape') {
      if (anyPanelOpen()) {
        e.preventDefault();
        e.stopPropagation();
        closePanels();
      }
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      turn('prev');
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      turn('next');
    }
  };
  document.addEventListener('keydown', onKey, true);
  teardown = () => document.removeEventListener('keydown', onKey, true);

  // 点正文：左右翻页，中间收放工具栏；任何面板开着时点击先关面板
  const onTap = (zone: 'left' | 'middle' | 'right'): void => {
    if (anyPanelOpen()) {
      closePanels();
      return;
    }
    if (zone === 'left') turn('prev');
    else if (zone === 'right') turn('next');
    else setBare(!root.classList.contains('is-bare'));
  };

  void (async () => {
    try {
      await host.mount(stage, book.fileRef.vaultPath, {
        prefs,
        onRelocate: saveRelocate,
        onTap,
        onReady: (_b, m) => {
          if (m.title) book.meta.title = m.title;
          if (m.author) book.meta.author = m.author;
          if (m.wordCount) book.meta.wordCount = m.wordCount;
          title.textContent = book.meta.title;
          title.title = book.meta.title;
          toc.setItems(host.toc());
          store.touch();
        },
      });
      await host.start(book.reading.position.cfi, book.reading.position.percent || 0);
      tracker.begin(book.reading.position.percent);
      if (!book.reading.stats.startReadTime) book.reading.stats.startReadTime = Date.now();
      store.touch();
      updateFoot(book.reading.position.percent || 0, 0);
      if (book.reading.position.chapterTitle) chapter.textContent = book.reading.position.chapterTitle;
    } catch (e) {
      notify((e as Error)?.message || '这本书打不开', 'error');
      close();
    }
  })();
}

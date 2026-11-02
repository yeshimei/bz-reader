/* ============================================================
 * bz-reader · 阅读弹窗（ui/reader.ts）
 *
 * 一个全屏弹窗 + 一个 foliate 宿主。上层只关心三件事：
 * 打开哪本、进度变了要存、关掉时要结算。
 *
 * 关书时的结算顺序不能反：
 *   先结算会话 → 再落最后位置 → 再 flush 落盘 → 最后 destroy 引擎。
 * 反过来的话，destroy 先拆掉 iframe，relocate 不再触发，
 * 最后那次进度就丢了（表现是「读到 80% 关掉，重开回到 60%」）。
 * ============================================================ */
import type { App } from 'obsidian';
import type { ReaderBook } from '../data/schema';
import type { ReaderStore } from '../data/store';
import { ActivityTracker } from '../engine/activity';
import { EngineHost } from '../engine/host';
import type { RelocateInfo } from '../engine/host';
import { uiModal } from '../core/ui/modal';
import { notify } from '../core/notice';
import { el } from './dom';

export interface ReaderDeps {
  app: App;
  store: ReaderStore;
  book: ReaderBook;
  onClose?: () => void;
}

const COMPLETE_THRESHOLD = 0.99;

export function openReader(deps: ReaderDeps): void {
  const { app, store, book } = deps;

  const root = el('div', 'bzr-reader');
  const head = el('div', 'bzr-reader-head');
  const back = el('button', 'bzr-reader-back', '书库');
  const title = el('div', 'bzr-reader-title', book.meta.title);
  const headSpacer = el('div', 'bzr-reader-spacer');
  head.append(back, title, headSpacer);

  const stage = el('div', 'bzr-reader-stage');
  const foot = el('div', 'bzr-reader-foot');
  const prevBtn = el('button', 'bzr-reader-nav', '上一页');
  const progressText = el('span', 'bzr-reader-progress-text', '');
  const nextBtn = el('button', 'bzr-reader-nav', '下一页');
  foot.append(prevBtn, progressText, nextBtn);

  root.append(head, stage, foot);

  const host = new EngineHost(app);
  const tracker = new ActivityTracker();

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
    progressText.textContent = `${Math.round(info.percent * 100)}%`;
    tracker.touch(info.percent);
    store.touch();
  }

  async function settle(): Promise<void> {
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

  prevBtn.addEventListener('click', () => turn('prev'));
  nextBtn.addEventListener('click', () => turn('next'));
  back.addEventListener('click', () => close());

  const onKey = (e: KeyboardEvent): void => {
    if (closed) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      turn('prev');
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      turn('next');
    }
  };
  document.addEventListener('keydown', onKey);
  teardown = () => document.removeEventListener('keydown', onKey);

  void (async () => {
    try {
      await host.mount(stage, book.fileRef.vaultPath, { onRelocate: saveRelocate });
      await host.start(book.reading.position.cfi);
      tracker.begin(book.reading.position.percent);
      if (!book.reading.stats.startReadTime) book.reading.stats.startReadTime = Date.now();
      store.touch();
      progressText.textContent = `${Math.round((book.reading.position.percent || 0) * 100)}%`;
    } catch (e) {
      notify((e as Error)?.message || '这本书打不开', 'error');
      close();
    }
  })();
}

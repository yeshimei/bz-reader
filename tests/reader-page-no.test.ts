import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { makeApp, makeReaderView, stubHost, testBook } from './helpers/plugin-harness';
import { normalizePrefs } from '../src/data/prefs';
import type { RelocateInfo } from '../src/engine/host';
import type { ReaderView } from '../src/view/reader-view';

/* 阅读页右下角的页码（2026-11-12）。
   这里只测「画不画、画什么」：数字怎么整理在 page-info / page-label 的纯函数
   测试里，这条只保证视图把两者接上了。 */

let uninstall: () => void = () => undefined;

beforeEach(() => {
  uninstall = installDomStub();
});

afterEach(() => {
  uninstall();
});

function wire(prefs: Record<string, unknown> = {}): ReaderView {
  const app = makeApp();
  /* buildShell 会订阅 metadataCache 的 resolved（引用页签跟着链接变）：
     替身里补一个只会返回可注销句柄的 on() */
  (app as unknown as { metadataCache: unknown }).metadataCache = {
    on: () => ({ unsubscribe: () => undefined }),
  };
  const { view } = makeReaderView(app);
  stubHost(view);
  (view as unknown as { prefs: unknown }).prefs = normalizePrefs(prefs);
  (view as unknown as { book: unknown }).book = testBook('b1');
  (view as unknown as { buildShell(): void }).buildShell();
  /* 真机上 buildShell 之后 updatePrefs 会走 applyChrome：这里手动补一次，
     让「页边距 / 字号写进 root 变量」那一步也发生在测试里 */
  (view as unknown as { applyChrome(): void }).applyChrome();
  return view;
}

function relocate(view: ReaderView, over: Partial<RelocateInfo> = {}): void {
  const info: RelocateInfo = {
    percent: 0.42,
    cfi: 'cfi-1',
    chapterIndex: 1,
    chapterTitle: '第二章',
    chapterHref: '2.xhtml',
    sectionCurrent: 1,
    sectionTotal: 10,
    pageInChapter: 3,
    pagesInChapter: 12,
    bookPage: 123,
    bookPages: 456,
    remainingSeconds: 0,
    ...over,
  };
  (view as unknown as { saveRelocate(i: RelocateInfo): void }).saveRelocate(info);
}

function pageNo(view: ReaderView): string {
  const node = (view as unknown as { pageNoEl: { textContent: string } | null }).pageNoEl;
  return node?.textContent ?? '';
}

describe('阅读页页码 · 显示', () => {
  it('默认关：翻页后右下角仍然是空的', () => {
    const view = wire();
    relocate(view);
    expect(pageNo(view)).toBe('');
  });

  it('本章口径：本章第几屏 / 共几屏 + 百分比', () => {
    const view = wire({ pageLabel: 'chapter' });
    relocate(view);
    expect(pageNo(view)).toBe('3 / 12 · 42%');
  });

  it('全书口径：估算的全书页码 + 百分比', () => {
    const view = wire({ pageLabel: 'book' });
    relocate(view);
    expect(pageNo(view)).toBe('123 / 456 · 42%');
  });

  it('滚动模式没有本章页数：只留百分比', () => {
    const view = wire({ pageLabel: 'chapter' });
    relocate(view, { pageInChapter: 0, pagesInChapter: 0 });
    expect(pageNo(view)).toBe('42%');
  });

  it('PDF 不画：右下角已经有页码浮条，不重复', () => {
    const view = wire({ pageLabel: 'chapter' });
    (view as unknown as { host: { isPdf: boolean } }).host.isPdf = true;
    relocate(view);
    expect(pageNo(view)).toBe('');
  });

  it('设置里切口径：不用等下一次翻页就重算', () => {
    const view = wire({ pageLabel: 'chapter' });
    relocate(view);
    expect(pageNo(view)).toBe('3 / 12 · 42%');

    view.updatePrefs(normalizePrefs({ pageLabel: 'book' }));
    expect(pageNo(view)).toBe('123 / 456 · 42%');

    view.updatePrefs(normalizePrefs({ pageLabel: 'off' }));
    expect(pageNo(view)).toBe('');
  });

  it('加载态收走上一本的页码：新书还没定位时不报假数', () => {
    const view = wire({ pageLabel: 'chapter' });
    relocate(view);
    expect(pageNo(view)).toBe('3 / 12 · 42%');

    (view as unknown as { renderLoading(t: string): void }).renderLoading('新书');
    expect(pageNo(view)).toBe('');
  });

  it('页码的位置与字号跟页边距、正文字号走（写进 root 的两个变量）', () => {
    const view = wire({ pageLabel: 'chapter', margin: 32, fontSize: 22 });
    const style = (view as unknown as { rootEl: { style: Record<string, string> } }).rootEl.style;
    expect(style['--bzr-page-margin']).toBe('32px');
    expect(style['--bzr-page-font']).toBe('22px');

    /* 改页边距/字号后跟着变：页码不是写死的 18px / 11px */
    view.updatePrefs(normalizePrefs({ pageLabel: 'chapter', margin: 64, fontSize: 28 }));
    expect(style['--bzr-page-margin']).toBe('64px');
    expect(style['--bzr-page-font']).toBe('28px');
  });
});

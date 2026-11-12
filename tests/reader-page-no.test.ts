import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Platform } from 'obsidian';
import { installDomStub } from './helpers/dom-stub';
import { makeApp, makeReaderView, stubHost, testBook } from './helpers/plugin-harness';
import { normalizePrefs } from '../src/data/prefs';
import type { RelocateInfo } from '../src/engine/host';
import type { ReaderView } from '../src/view/reader-view';

/* 沉浸模式的两角小字（2026-11-12 用户拍板）：
   · 只在全屏（沉浸）时出现；
   · 左上章节名、右下页码，字体字号一致；
   · 非沉浸时不显示（头栏有书名、侧栏有进度，正文上不再多两行）。 */

let uninstall: () => void = () => undefined;

beforeEach(() => {
  uninstall = installDomStub();
});

afterEach(() => {
  uninstall();
});

function wire(prefs: Record<string, unknown> = {}, immersive = true): ReaderView {
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
  (view as unknown as { immersive: boolean }).immersive = immersive;
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

function textOf(view: ReaderView, field: 'pageNoEl' | 'chapterEl'): string {
  const node = (view as unknown as Record<string, { textContent: string } | null>)[field];
  return node?.textContent ?? '';
}

const pageNo = (view: ReaderView): string => textOf(view, 'pageNoEl');
const chapterName = (view: ReaderView): string => textOf(view, 'chapterEl');

describe('沉浸模式的两角小字', () => {
  it('桌面端默认全书：不沉浸也显示页码与章节名', () => {
    const view = wire();
    relocate(view);
    expect(pageNo(view)).toBe('123 / 456');
    expect(chapterName(view)).toBe('第二章');
  });

  it('章节名开关关掉：只剩页码，正文也不用再让位', () => {
    const view = wire({ chapterLabel: false });
    relocate(view);
    expect(chapterName(view)).toBe('');
    expect(pageNo(view)).toBe('123 / 456');
    const root = (view as unknown as { rootEl: { classList: { contains(c: string): boolean } } }).rootEl;
    expect(root.classList.contains('has-chapter')).toBe(false);
  });

  it('本章口径：本章第几屏 / 本章共几屏', () => {
    const view = wire({ pageLabel: 'chapter' });
    relocate(view);
    expect(pageNo(view)).toBe('3 / 12');
  });

  it('全书口径：按字数估算的全书页码', () => {
    const view = wire({ pageLabel: 'book' });
    relocate(view);
    expect(pageNo(view)).toBe('123 / 456');
  });

  it('左上角显示当前章节名', () => {
    const view = wire({ pageLabel: 'chapter' });
    relocate(view);
    expect(chapterName(view)).toBe('第二章');
  });

  it('手机非沉浸：两角都不显示（页码再开也不画）', () => {
    Platform.isMobile = true;
    try {
      const view = wire({ pageLabel: 'chapter' }, false);
      relocate(view);
      expect(pageNo(view)).toBe('');
      expect(chapterName(view)).toBe('');
    } finally {
      Platform.isMobile = false;
    }
  });

  it('手机沉浸：两角都显示', () => {
    Platform.isMobile = true;
    try {
      const view = wire({ pageLabel: 'chapter' }, true);
      relocate(view);
      expect(pageNo(view)).toBe('3 / 12');
      expect(chapterName(view)).toBe('第二章');
    } finally {
      Platform.isMobile = false;
    }
  });

  it('滚动模式没有本章页数：整块不显示', () => {
    const view = wire({ pageLabel: 'chapter' });
    relocate(view, { pageInChapter: 0, pagesInChapter: 0 });
    expect(pageNo(view)).toBe('');
  });

  it('PDF 不画：右下角已经有页码浮条，不重复', () => {
    const view = wire({ pageLabel: 'chapter' });
    (view as unknown as { host: { isPdf: boolean } }).host.isPdf = true;
    relocate(view);
    expect(pageNo(view)).toBe('');
    expect(chapterName(view)).toBe('');
  });

  it('设置里切口径：不用等下一次翻页就重算', () => {
    const view = wire({ pageLabel: 'chapter' });
    relocate(view);
    expect(pageNo(view)).toBe('3 / 12');

    view.updatePrefs(normalizePrefs({ pageLabel: 'book' }));
    expect(pageNo(view)).toBe('123 / 456');

    view.updatePrefs(normalizePrefs({ pageLabel: 'off' }));
    expect(pageNo(view)).toBe('');
  });

  it('加载态收走上一本的页码：新书还没定位时不报假数', () => {
    const view = wire({ pageLabel: 'chapter' });
    relocate(view);
    expect(pageNo(view)).toBe('3 / 12');

    (view as unknown as { renderLoading(t: string): void }).renderLoading('新书');
    expect(pageNo(view)).toBe('');
  });

  it('字号与位置跟页边距、正文字号走；字体跟正文字体走', () => {
    const view = wire({ pageLabel: 'chapter', margin: 32, fontSize: 22, fontFamily: 'serif' });
    const rootStyle = (view as unknown as { rootEl: { style: Record<string, string> } }).rootEl.style;
    const leafStyle = (view as unknown as { containerEl: { style: Record<string, string> } }).containerEl.style;
    expect(rootStyle['--bzr-page-margin']).toBe('32px');
    expect(rootStyle['--bzr-font-size']).toBe('22px');
    /* 书名在头栏里，不在 .bzs-shell 内：字号/字体变量要同时写到 leaf-content */
    expect(leafStyle['--bzr-font-size']).toBe('22px');
    expect(rootStyle['--bzr-font-family']).toContain('Songti');
    expect(leafStyle['--bzr-font-family']).toContain('Songti');

    /* 改页边距/字号后跟着变：页码不是写死的 18px / 11px */
    view.updatePrefs(normalizePrefs({ pageLabel: 'chapter', margin: 64, fontSize: 28, fontFamily: 'sans' }));
    expect(rootStyle['--bzr-page-margin']).toBe('64px');
    expect(rootStyle['--bzr-font-size']).toBe('28px');
    expect(rootStyle['--bzr-font-family']).toContain('PingFang');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { RT } from '../src/shell/runtime';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { addHighlight } from '../src/data/notes';
import { FakeAdapter } from './helpers/fake-adapter';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';

/* 书摘「存笔记」要过 export 能力门；这里只测写什么，不测卖什么 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  RT.textHits = [];
  RT.textSearching = false;
});

function el(): HTMLElement {
  return { dataset: {} } as unknown as HTMLElement;
}

function installSource(opts: {
  app?: unknown;
  books?: unknown[];
  searchText?: (kw: string) => Promise<unknown[]>;
}): void {
  setShellSource({
    app: opts.app ?? makeApp(),
    repo: { all: () => opts.books ?? [] },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS, exportDir: '书摘' }),
    searchText: opts.searchText ?? (async () => []),
    hasOpenReader: () => true,
    setGoal: () => undefined,
  } as unknown as ShellSource);
}

describe('书内搜正文的结果回填（A-09）', () => {
  it('搜完在 finally 里推进 overlay.rev，弹层才会重画', async () => {
    const hits = [
      { cfi: 'epubcfi(/6/4)', excerpt: '给岁月以文明', chapterLabel: '第一章', chapterIndex: 0 },
    ];
    installSource({ searchText: async () => hits });
    setState({ ...DEFAULT_SHELL_STATE, searchKw: '文明', overlay: { kind: 'search' } });

    dispatchAction('searchtext', el());

    expect(RT.textSearching).toBe(true);
    await vi.waitFor(() => expect(RT.textSearching).toBe(false));
    expect(RT.textHits).toEqual(hits);
    expect(getState().overlay?.rev).toBe(1);
  });
});

describe('书摘卡「存笔记」（A-10）', () => {
  it('只把当前这条引文追加进导出笔记，不导出整本', async () => {
    const book = testBook('b1', '书');
    (book.meta as { author?: string }).author = '作者';
    addHighlight(book as never, { text: '当前引文', cfiRange: 'c1', chapterTitle: '第二章' });
    addHighlight(book as never, { text: '另一条划线', cfiRange: 'c2', chapterTitle: '第二章' });

    const adapter = new FakeAdapter();
    installSource({ app: { vault: { adapter } }, books: [book] });
    setState({
      ...DEFAULT_SHELL_STATE,
      bookId: 'b1',
      overlay: { kind: 'quote', text: '当前引文', chapterTitle: '第二章' },
    });

    dispatchAction('quotesave', el());

    await vi.waitFor(() => expect(adapter.files.has('书摘/书.md')).toBe(true));
    const md = adapter.files.get('书摘/书.md') ?? '';
    expect(md).toContain('「当前引文」');
    expect(md).toContain('— 书 · 作者 · 第二章');
    expect(md).not.toContain('另一条划线');
    expect(md).not.toContain('<!-- bz-reader:export -->');
  });
});

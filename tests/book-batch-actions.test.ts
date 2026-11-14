import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('../src/core/notice', () => ({
  notify: (text: string) => void notices.push(text),
}));

import { assignShelf, dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, hydrateLibrary, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';
import { installDomStub } from './helpers/dom-stub';

/**
 * 批量归类 / 批量移出书架。
 *
 * 移出书架只打归档标记，不删文件也不删记录——批量一次动十几本，这条
 * 语义更不能走偏；回执按真正处理掉的本数说，而不是选中了几本。
 */
let restoreDom: (() => void) | null = null;

function el(dataset: Record<string, string> = {}): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

interface Seeded {
  books: Array<Record<string, unknown>>;
  archived: string[];
  store: ReturnType<typeof makeStore>;
}

function seed(): Seeded {
  const books = [testBook('a', '甲'), testBook('b', '乙'), testBook('c', '丙')];
  const archived: string[] = [];
  const store = makeStore();
  const byId = (id: string) => books.find((b) => b.id === id);
  setShellSource({
    app: makeApp(),
    repo: {
      all: () => books,
      byId,
      archive: (b: Record<string, unknown>) => {
        archived.push(String(b.id));
        b.archivedAt = Date.now();
      },
    },
    store,
    settings: () => ({ ...DEFAULT_SETTINGS }),
    setShelf: (id: string, name: string) => {
      const b = byId(id);
      if (b) b.shelf = name;
      store.touch();
    },
    setShelfList: () => undefined,
  } as unknown as ShellSource);
  hydrateLibrary(books as never, 20, ['工具书']);
  return { books, archived, store };
}

beforeEach(() => {
  restoreDom = installDomStub();
  notices.length = 0;
  setState({ ...DEFAULT_SHELL_STATE, overlay: null });
  seed();
});

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE, overlay: null });
});

function enter(ids: string[] = []): void {
  dispatchAction('libsel', el());
  setState({ libSel: ids });
}

describe('进入与退出多选', () => {
  it('开一次进入、再开一次退出并把选择清空', () => {
    dispatchAction('libsel', el());
    expect(getState().libSelect).toBe(true);
    setState({ libSel: ['a', 'b'] });
    dispatchAction('libsel', el());
    expect(getState().libSelect).toBe(false);
    expect(getState().libSel).toEqual([]);
  });

  it('勾一下选上，再勾一下取消', () => {
    enter();
    dispatchAction('libselpick', el({ id: 'a' }));
    dispatchAction('libselpick', el({ id: 'b' }));
    expect(getState().libSel).toEqual(['a', 'b']);
    dispatchAction('libselpick', el({ id: 'a' }));
    expect(getState().libSel).toEqual(['b']);
  });

  it('全选只选当前筛选、分类、搜索词下看得见的书', () => {
    setState({ libKw: '甲' });
    enter();
    dispatchAction('libselall', el());
    expect(getState().libSel).toEqual(['a']);
  });

  it('全选了再点一次就取消这批', () => {
    enter();
    dispatchAction('libselall', el());
    expect(getState().libSel).toEqual(['a', 'b', 'c']);
    dispatchAction('libselall', el());
    expect(getState().libSel).toEqual([]);
  });

  it('换筛选 / 换分类 / 打字搜索都自动退出并清空', () => {
    for (const [act, data] of [
      ['libfilter', { v: 'fav' }],
      ['shelf', { v: '工具书' }],
      ['libsort', { v: 'title' }],
    ] as const) {
      enter(['a', 'b']);
      dispatchAction(act, el(data));
      expect(getState().libSelect, act).toBe(false);
      expect(getState().libSel, act).toEqual([]);
      setState({ ...DEFAULT_SHELL_STATE, overlay: null });
    }
  });
});

describe('批量移出书架', () => {
  it('一次归档选中的几本，只落盘一次，回执按本数说', () => {
    const { archived, store } = seed();
    enter(['a', 'b']);
    setState({ bookId: 'a' });

    dispatchAction('removebooksdo', el());

    expect(archived).toEqual(['a', 'b']);
    expect(store.touch).toHaveBeenCalledTimes(1);
    expect(notices).toContain('已把 2 本书移出书架，数据都保留');
    expect(getState().bookId).toBeNull();
  });

  it('做完自动退出多选并清空，不对着空书架留一条工具条', () => {
    enter(['a', 'b']);
    dispatchAction('removebooksdo', el());
    expect(getState().libSelect).toBe(false);
    expect(getState().libSel).toEqual([]);
  });

  it('选中的书已经不在架上就跳过，按真正处理掉的本数回报', () => {
    const { archived } = seed();
    enter(['a', 'ghost', 'c']);
    dispatchAction('removebooksdo', el());
    expect(archived).toEqual(['a', 'c']);
    expect(notices).toContain('已把 2 本书移出书架，数据都保留');
  });

  it('一本都没选中就什么都不做', () => {
    const { archived, store } = seed();
    enter();
    dispatchAction('removebooksdo', el());
    expect(archived).toEqual([]);
    expect(store.touch).not.toHaveBeenCalled();
  });

  it('点「移出书架」先出按本数说话的确认框，不直接动手', () => {
    const { archived } = seed();
    enter(['a', 'b']);
    dispatchAction('libselremove', el());
    expect(archived).toEqual([]);
    expect(getState().overlay?.kind).toBe('removebooks');
  });
});

describe('批量归入分类', () => {
  it('一本没选时点「归入分类」只给提示，不弹菜单', () => {
    enter();
    dispatchAction('libselclass', el());
    expect(notices).toContain('先勾选至少一本书');
    expect(getState().overlay).toBeNull();
  });

  it('从批量入口新建分类：建好把整批都放进去，不是只放第一本', () => {
    const { books } = seed();
    enter(['a', 'b']);
    (document as unknown as { querySelector: () => unknown }).querySelector = () => ({ value: '小说' });

    /* 批量工具条会带上 batch：只有它才代表「整批」。普通单本菜单不带这个标记。 */
    dispatchAction('shelfcreate', el({ id: 'a', batch: true }));

    expect(books[0].shelf).toBe('小说');
    expect(books[1].shelf).toBe('小说');
    expect(books[2].shelf).toBeUndefined();
  });

  it('多选状态下从某一本的菜单新建分类：只归这一本，别把整批拉进来', () => {
    const { books } = seed();
    enter(['a', 'b']);
    (document as unknown as { querySelector: () => unknown }).querySelector = () => ({ value: '小说' });

    dispatchAction('shelfcreate', el({ id: 'a' }));

    expect(books[0].shelf).toBe('小说');
    expect(books[1].shelf).toBeUndefined();
  });

  it('一次把几本都归到同一个分类，缓存也跟着走', () => {
    const { books } = seed();
    assignShelf(['a', 'b'], '工具书');
    expect(books[0].shelf).toBe('工具书');
    expect(books[1].shelf).toBe('工具书');
    expect(books[2].shelf).toBeUndefined();
    expect(getState().shelves.a).toBe('工具书');
    expect(getState().shelves.b).toBe('工具书');
  });

  it('多本给汇总回执，单本保持原来的那一句', () => {
    seed();
    assignShelf(['a', 'b'], '工具书');
    expect(notices).toContain('已把 2 本书归入「工具书」');
    notices.length = 0;
    assignShelf(['c'], '工具书');
    expect(notices).toContain('已归入「工具书」');
  });

  it('归完类选择还留着，可以接着归到另一类或再移出', () => {
    seed();
    enter(['a', 'b']);
    assignShelf(['a', 'b'], '工具书');
    expect(getState().libSelect).toBe(true);
    expect(getState().libSel).toEqual(['a', 'b']);
  });

  it('归到「未分类」也是一次明确的表态，空串照写', () => {
    const { books } = seed();
    assignShelf(['a', 'b'], '未分类');
    expect(books[0].shelf).toBe('');
    expect(books[1].shelf).toBe('');
    expect(notices).toContain('已把 2 本书移出分类');
  });
});

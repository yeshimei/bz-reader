import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, hydrateLibrary, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { makeApp, makeStore, testBook } from './helpers/plugin-harness';
import { installDomStub } from './helpers/dom-stub';

/**
 * 分类删除 / 改名要带上「移出书架」的书（2026-11-09 发版复核）。
 *
 * 以前这两条动作只遍历在架书：归档书的归属字段一直留着旧分类名，
 * 下次启动 `repo.all()` 重建索引时，那一格又从「书上有但名单里没有」
 * 冒回分类条——用户删了三次还在，因为每次删的都只是名单里那条。
 *
 * 判据：删/改名之后，全量书（含归档）的归属字段都要跟着变。
 */

let restoreDom: (() => void) | null = null;

beforeEach(() => {
  restoreDom = installDomStub();
});

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
});

function el(dataset: Record<string, string>): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

interface Seeded {
  live: Record<string, unknown>;
  archived: Record<string, unknown>;
  store: ReturnType<typeof makeStore>;
}

function seed(): Seeded {
  const live: Record<string, unknown> = { ...testBook('live', '在架书'), shelf: '工具书' };
  const archived: Record<string, unknown> = {
    ...testBook('arch', '归档书'),
    shelf: '工具书',
    archivedAt: 1,
  };
  const store = makeStore();
  (store.data as { shelves?: string[] }).shelves = ['工具书'];
  const byId = (id: string): Record<string, unknown> =>
    id === 'live' ? live : archived;
  setShellSource({
    app: makeApp(),
    repo: { all: () => [live, archived] },
    store,
    settings: () => ({ ...DEFAULT_SETTINGS }),
    setShelf: (id: string, name: string) => {
      byId(id).shelf = name;
    },
    setShelfList: (list: string[]) => {
      (store.data as { shelves?: string[] }).shelves = list;
    },
  } as unknown as ShellSource);
  hydrateLibrary([live, archived] as never, 20, ['工具书']);
  return { live, archived, store };
}

describe('分类删除与改名覆盖全量书', () => {
  it('删掉一个分类：归档在这类里的书也退回未分类', () => {
    const { live, archived, store } = seed();

    dispatchAction('shelfdeldo', el({ name: '工具书' }));

    expect(live.shelf).toBe('');
    expect(archived.shelf).toBe('');
    expect((store.data as { shelves?: string[] }).shelves).toEqual([]);
  });

  it('改名：归档书的归属字段跟着改成新名字', () => {
    const { live, archived } = seed();
    /* 改名要读弹层里的输入框，桩里给一个带值的替身 */
    (document as unknown as { querySelector: () => unknown }).querySelector = () => ({
      value: '参考书',
    });

    dispatchAction('shelfrenamesave', el({ name: '工具书' }));

    expect(live.shelf).toBe('参考书');
    expect(archived.shelf).toBe('参考书');
  });
});

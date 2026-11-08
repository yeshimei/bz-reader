/**
 * 从备份恢复（C12）：先问，再动手。
 *
 * 恢复的语义是**整份替换**——备份里有什么，恢复后就是什么，当前数据一条不留。
 * 所以设置页那一颗「恢复」不能点了就去读文件：路走错了就没有回头路。
 * 这一组钉住两件事：
 *   1. 点「恢复」只开确认层，`src.restore()` 一次都不许调；
 *   2. 只有确认层里的 `restoredo` 才真的执行，并且执行前先把自己收掉。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, getState, loadShellState, setState } from '../src/shell/state';
import { overlayHtml } from '../src/shell/overlay';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { makeApp, makeStore } from './helpers/plugin-harness';

const notices = vi.hoisted(() => [] as string[]);
vi.mock('../src/core/notice', () => ({
  notify: (text: string) => void notices.push(text),
}));

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  notices.length = 0;
});

function el(dataset: Record<string, string> = {}): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

function installSource(restore: () => Promise<{ ok: boolean; message: string }>): void {
  setShellSource({
    app: makeApp(),
    repo: { all: () => [] },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS }),
    restore,
  } as unknown as ShellSource);
}

describe('恢复备份：先确认，再整份替换', () => {
  it('点「恢复」只弹确认层，一个文件都不读', () => {
    const restore = vi.fn(async () => ({ ok: true, message: '' }));
    installSource(restore);

    dispatchAction('restore', el());

    expect(getState().overlay?.kind).toBe('restore');
    expect(restore).not.toHaveBeenCalled();
  });

  it('确认层写明「当前数据不保留」，危险按钮是 restoredo', () => {
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'restore' } });

    const html = overlayHtml();

    expect(html).toContain('当前数据');
    expect(html).toContain('不保留');
    expect(html).toContain('data-act="restoredo"');
    expect(html).toContain('data-act="close"');
  });

  it('只有 restoredo 才真的恢复，并且先收掉确认层', () => {
    const restore = vi.fn(async () => ({ ok: true, message: '已恢复' }));
    installSource(restore);
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'restore' } });

    dispatchAction('restoredo', el());

    expect(restore).toHaveBeenCalledTimes(1);
    expect(getState().overlay).toBeNull();
  });

  it('取消只是关掉，不恢复', () => {
    const restore = vi.fn(async () => ({ ok: true, message: '' }));
    installSource(restore);
    setState({ ...DEFAULT_SHELL_STATE, overlay: { kind: 'restore' } });

    dispatchAction('close', el());

    expect(getState().overlay).toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });
});

/**
 * 读 localStorage 的三个枚举（C12）：认不出的值退回默认。
 *
 * 以前 `if (d.libFilter)` 认任何真值：旧版本或手改过的存储里留一个
 * `libSort: "xxx"` 进来，书架排序按钮一颗都不亮，看起来像功能坏了。
 */
describe('壳层状态的枚举白名单', () => {
  const store = new Map<string, string>();

  function stubStorage(): void {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  }

  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it('认不出的筛选 / 排序 / 笔色退回默认', () => {
    stubStorage();
    store.set(
      'bzs-shell-v1',
      JSON.stringify({ libFilter: 'someday', libSort: 'magic', pen: 'neon' }),
    );

    const s = loadShellState();

    expect(s.libFilter).toBe(DEFAULT_SHELL_STATE.libFilter);
    expect(s.libSort).toBe(DEFAULT_SHELL_STATE.libSort);
    expect(s.pen).toBe(DEFAULT_SHELL_STATE.pen);
  });

  it('认识的值照旧恢复', () => {
    stubStorage();
    store.set(
      'bzs-shell-v1',
      JSON.stringify({ libFilter: 'fav', libSort: 'title', pen: 'green' }),
    );

    const s = loadShellState();

    expect(s.libFilter).toBe('fav');
    expect(s.libSort).toBe('title');
    expect(s.pen).toBe('green');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SHELL_STATE,
  bumpOverlayRev,
  closeOverlay,
  getState,
  overlayKey,
  persistShellState,
  setState,
  setStateQuiet,
  subscribe,
} from '../src/shell/state';

/** localStorage 写次数：A-24 的核心是「打字时不落盘」 */
const writes = { count: 0 };
const g = globalThis as unknown as { window?: unknown };

function installWindow(): void {
  g.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {
        writes.count += 1;
      },
      removeItem: () => undefined,
    },
  };
}

beforeEach(() => {
  installWindow();
  setState({ ...DEFAULT_SHELL_STATE });
  writes.count = 0;
});

afterEach(() => {
  setState({ ...DEFAULT_SHELL_STATE });
  delete g.window;
});

describe('搜索框打字不落盘（A-24）', () => {
  it('setStateQuiet 只改内存，不广播也不写 localStorage', () => {
    const listener = vi.fn();
    const off = subscribe(listener);

    setStateQuiet({ searchKw: '三体' });

    expect(getState().searchKw).toBe('三体');
    expect(listener).not.toHaveBeenCalled();
    expect(writes.count).toBe(0);
    off();
  });

  it('关闭浮层走正常持久化：广播一次、落盘一次', () => {
    const listener = vi.fn();
    const off = subscribe(listener);
    setStateQuiet({ searchKw: '三体' });

    closeOverlay();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(writes.count).toBe(1);
    off();
  });

  it('persistShellState 只落盘、不广播（离开搜索浮层时用）', () => {
    const listener = vi.fn();
    const off = subscribe(listener);
    setStateQuiet({ searchKw: '三体' });

    persistShellState();

    expect(writes.count).toBe(1);
    expect(listener).not.toHaveBeenCalled();
    expect(getState().searchKw).toBe('三体');
    off();
  });
});

describe('强制弹层重画（A-09）', () => {
  it('bumpOverlayRev 让 overlayKey 变化，订阅方才会调 sync()', () => {
    setState({ overlay: { kind: 'search' } });
    const before = overlayKey(getState().overlay);
    writes.count = 0;

    bumpOverlayRev();

    expect(getState().overlay?.rev).toBe(1);
    expect(overlayKey(getState().overlay)).not.toBe(before);
    expect(writes.count).toBe(1);

    bumpOverlayRev();
    expect(getState().overlay?.rev).toBe(2);
  });

  it('没有弹层时是空操作', () => {
    setState({ overlay: null });
    expect(() => bumpOverlayRev()).not.toThrow();
    expect(getState().overlay).toBeNull();
  });
});

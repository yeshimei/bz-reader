import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SHELL_STATE,
  getState,
  hydrateLibrary,
  isFav,
  setGoal,
  setState,
  toggleFav,
} from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';

interface Calls {
  fav: Array<[string, boolean]>;
  goal: number[];
}

function installSource(): Calls {
  const calls: Calls = { fav: [], goal: [] };
  setShellSource({
    setFavorite: (id, on) => calls.fav.push([id, on]),
    setGoal: (n) => calls.goal.push(n),
  } as unknown as ShellSource);
  return calls;
}

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE, overlay: null });
});

describe('收藏 / 分组 / 目标跟着业务数据走（P2-01）', () => {
  it('hydrateLibrary 从书里灌回收藏、分组、目标', () => {
    hydrateLibrary(
      [
        { id: 'a', favorite: true },
        { id: 'b', shelf: '技术书' },
        { id: 'c' },
      ],
      36,
    );
    const s = getState();
    expect(s.favIds).toEqual(['a']);
    expect(s.shelves).toEqual({ b: '技术书' });
    expect(s.goal).toBe(36);
  });

  it('没有收藏时清空，不会把上一次的星标留着', () => {
    hydrateLibrary([{ id: 'a', favorite: true }], 20);
    hydrateLibrary([{ id: 'a' }], 20);
    expect(getState().favIds).toEqual([]);
  });

  it('toggleFav 同时改界面状态和业务数据', () => {
    const calls = installSource();
    hydrateLibrary([{ id: 'a' }], 20);

    expect(toggleFav('a')).toBe(true);
    expect(isFav('a')).toBe(true);
    expect(calls.fav).toEqual([['a', true]]);

    expect(toggleFav('a')).toBe(false);
    expect(isFav('a')).toBe(false);
    expect(calls.fav).toEqual([
      ['a', true],
      ['a', false],
    ]);
  });

  it('setGoal 把目标写进业务数据，并夹在 1..200', () => {
    const calls = installSource();
    setGoal(500);
    expect(getState().goal).toBe(200);
    setGoal(0);
    expect(getState().goal).toBe(1);
    expect(calls.goal).toEqual([200, 1]);
  });

  it('没有注入源时只改界面状态，不抛', () => {
    setShellSource(null);
    expect(() => toggleFav('a')).not.toThrow();
    expect(isFav('a')).toBe(true);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { DEFAULT_PREFS } from '../src/data/prefs';
import { makeApp, makeStore } from './helpers/plugin-harness';

/**
 * 排版滑块 → setPrefs。
 *
 * `setPref` 是一串 case 手写的：新增一档偏好时忘了加分支，滑块就能拖、
 * 界面也会重绘，但值根本没写进去——看起来像「调了没用」。这里按
 * data-k 逐个钉住，新增一档时漏了会红。
 */
const calls: Array<Record<string, unknown>> = [];

afterEach(() => {
  setShellSource(null);
  calls.length = 0;
});

function install(): void {
  setShellSource({
    app: makeApp(),
    repo: { all: () => [], byId: () => null },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS }),
    prefs: () => DEFAULT_PREFS,
    setPrefs: (patch: Record<string, unknown>) => void calls.push(patch),
    searchText: async () => [],
    hasOpenReader: () => true,
    setGoal: () => undefined,
  } as unknown as ShellSource);
}

function drag(k: string, v: string): void {
  const el = { dataset: { k, v } } as unknown as HTMLElement;
  dispatchAction('setpref', el);
}

describe('排版滑块的写入', () => {
  it('左右页边距写进 margin；上下留白已经撤档，不再跟着写', () => {
    install();
    drag('margin', '40');
    expect(calls).toContainEqual({ margin: 40 });
    expect(calls.some((c) => 'marginY' in c)).toBe(false);
  });
});

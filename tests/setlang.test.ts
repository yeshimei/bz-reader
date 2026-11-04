/**
 * 设置页手动切语言（tests/setlang.test.ts）
 *
 * 切语言有两步，缺一步都像「点了没反应」：
 *   1. 写进 settings（不写就重启回旧语言）
 *   2. 立刻 setLocale（不切就是「等重启」——但命令名本来就要等重启，
 *      如果连界面都等，用户会以为这个开关是坏的）
 *
 * 第三条同样重要：data-v 是 DOM 上的字符串，手改页面或旧版本残留都可能
 * 送来别的值，落盘时必须退回 auto，不能把一个不存在的语言存进去。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { DEFAULT_PREFS } from '../src/data/prefs';
import { locale, setLocale } from '../src/i18n';
import { makeApp, makeStore } from './helpers/plugin-harness';

const patches: Array<Record<string, unknown>> = [];

afterEach(() => {
  setShellSource(null);
  setLocale('zh');
  patches.length = 0;
});

/** 宿主语言在测试里固定是 zh（见 tests/helpers/obsidian-stub.ts） */
function install(): void {
  setShellSource({
    app: makeApp(),
    repo: { all: () => [], byId: () => null },
    store: makeStore(),
    settings: () => ({ ...DEFAULT_SETTINGS }),
    prefs: () => DEFAULT_PREFS,
    setPrefs: () => undefined,
    setSettings: (patch: Record<string, unknown>) => void patches.push(patch),
    searchText: async () => [],
    hasOpenReader: () => true,
    setGoal: () => undefined,
  } as unknown as ShellSource);
}

function pick(v: string): void {
  const el = { dataset: { k: 'language', v } } as unknown as HTMLElement;
  dispatchAction('setlang', el);
}

describe('手动切换界面语言', () => {
  it('选 English：写进 settings 并立刻生效', () => {
    install();
    pick('en');
    expect(patches).toContainEqual({ language: 'en' });
    expect(locale()).toBe('en');
  });

  it('选中文：写进 settings 并立刻生效', () => {
    install();
    setLocale('en');
    pick('zh');
    expect(patches).toContainEqual({ language: 'zh' });
    expect(locale()).toBe('zh');
  });

  it('选跟随 Obsidian：落 auto，界面按宿主语言（测试宿主是 zh）', () => {
    install();
    setLocale('en');
    pick('auto');
    expect(patches).toContainEqual({ language: 'auto' });
    expect(locale()).toBe('zh');
  });

  it('八种语言都能选，不是只有中英两档', () => {
    install();
    for (const l of ['zh-TW', 'ja', 'de', 'fr', 'es', 'pt'] as const) {
      pick(l);
      expect(patches).toContainEqual({ language: l });
      expect(locale(), l).toBe(l);
    }
  });

  it('乱来的值一律落 auto，不把不存在的语言存进 data.json', () => {
    install();
    pick('klingon');
    expect(patches).toContainEqual({ language: 'auto' });
    expect(locale()).toBe('zh');
  });

  it('没有壳层来源时安静退出，不抛错', () => {
    setShellSource(null);
    expect(() => pick('en')).not.toThrow();
    expect(patches).toEqual([]);
  });
});

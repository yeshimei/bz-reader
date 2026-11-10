/**
 * AI 组的设置动作（tests/ai-settings-actions.test.ts）
 *
 * 2026-11-11：设置页的「选服务商」与「获取模型」两个按钮背后的动作。
 * 这里不测渲染（见 settings-render），只钉行为：
 *   · 切服务商只换当前那一家，别家的密钥/模型一个都不许动；
 *   · 非法值不落盘；
 *   · 没填地址就点「获取模型」，不该把请求打出去（先让人去填）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/shell/actions';
import { DEFAULT_SHELL_STATE, setState } from '../src/shell/state';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../src/data/settings';
import { makeApp, makeStore } from './helpers/plugin-harness';

/* AI 是付费能力：这里只测行为，不测卖什么 */
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return { ...actual, can: () => true };
});

let settings: ReaderSettings;
let saves = 0;

function install(ai?: Partial<ReaderSettings['ai']>): void {
  saves = 0;
  settings = {
    ...DEFAULT_SETTINGS,
    ai: { provider: 'deepseek', baseUrl: '', keys: {}, models: {}, ...ai },
  };
  setShellSource({
    app: makeApp(),
    repo: { all: () => [] },
    store: makeStore(),
    settings: () => settings,
    setSettings: (patch) => {
      saves += 1;
      settings = { ...settings, ...patch };
    },
    setGoal: () => undefined,
  } as unknown as ShellSource);
}

function el(dataset: Record<string, string>): HTMLElement {
  return { dataset } as unknown as HTMLElement;
}

afterEach(() => {
  setShellSource(null);
  setState({ ...DEFAULT_SHELL_STATE });
  vi.unstubAllGlobals();
});

describe('选服务商', () => {
  it('切到智谱：只换 provider，DeepSeek 的密钥与模型留在原位', () => {
    install({ keys: { deepseek: 'sk-d' }, models: { deepseek: 'deepseek-v4-pro' } });
    dispatchAction('setai', el({ v: 'zhipu-plan' }));
    expect(settings.ai.provider).toBe('zhipu-plan');
    expect(settings.ai.keys.deepseek).toBe('sk-d');
    expect(settings.ai.models.deepseek).toBe('deepseek-v4-pro');
    expect(saves).toBe(1);
  });

  it('切回 DeepSeek：上次的密钥与模型还在（per-provider 分存）', () => {
    install({ provider: 'zhipu-plan', keys: { deepseek: 'sk-d', 'zhipu-plan': 'zp' } });
    dispatchAction('setai', el({ v: 'deepseek' }));
    expect(settings.ai.provider).toBe('deepseek');
    expect(settings.ai.keys['zhipu-plan']).toBe('zp');
  });

  it('点了不认识的服务商：不落盘，也不改当前选择', () => {
    install({ provider: 'ollama' });
    dispatchAction('setai', el({ v: 'openai' }));
    expect(settings.ai.provider).toBe('ollama');
    expect(saves).toBe(0);
  });

  it('点的就是当前那一家：不重复写盘', () => {
    install({ provider: 'ollama' });
    dispatchAction('setai', el({ v: 'ollama' }));
    expect(saves).toBe(0);
  });
});

describe('获取模型', () => {
  it('自定义没填地址：不发请求（先让人去填地址）', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    install({ provider: 'custom', keys: {}, models: {} });
    dispatchAction('aimodels', el({}));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('需要密钥的一家没填密钥：同样不发请求', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    install({ provider: 'deepseek', keys: {} });
    dispatchAction('aimodels', el({}));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

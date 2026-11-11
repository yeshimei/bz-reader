/**
 * AI 组的设置输入（tests/ai-settings-actions.test.ts）
 *
 * 2026-11-11 同日回摆：不提供服务商选择，只有地址 / 模型 / 密钥三个输入框。
 * 这里钉行为：三个字段各写各的，不碰另外两个；已删掉的服务商键不再落盘。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchInput } from '../src/shell/actions';
import { setShellSource, type ShellSource } from '../src/shell/source';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../src/data/settings';
import { makeApp, makeStore } from './helpers/plugin-harness';

let settings: ReaderSettings;
let saves = 0;

function install(ai: Partial<ReaderSettings['ai']> = {}): void {
  saves = 0;
  settings = { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, ...ai } };
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

function input(k: string, value: string): HTMLInputElement {
  return { dataset: { role: 'setting', k }, value } as unknown as HTMLInputElement;
}

afterEach(() => {
  setShellSource(null);
});

describe('AI 三个输入框', () => {
  it('改地址：只写 baseUrl，模型与密钥不动', () => {
    install({ model: 'chat-x', apiKey: 'sk-1' });
    dispatchInput(input('ai.baseUrl', 'https://api.x/v1'));
    expect(settings.ai).toEqual({ baseUrl: 'https://api.x/v1', model: 'chat-x', apiKey: 'sk-1' });
    expect(saves).toBe(1);
  });

  it('改模型：只写 model', () => {
    install({ baseUrl: 'https://api.x/v1', apiKey: 'sk-1' });
    dispatchInput(input('ai.model', 'chat-x'));
    expect(settings.ai).toEqual({ baseUrl: 'https://api.x/v1', model: 'chat-x', apiKey: 'sk-1' });
    expect(saves).toBe(1);
  });

  it('改密钥：只写 apiKey', () => {
    install({ baseUrl: 'https://api.x/v1', model: 'chat-x' });
    dispatchInput(input('ai.apiKey', 'sk-1'));
    expect(settings.ai).toEqual({ baseUrl: 'https://api.x/v1', model: 'chat-x', apiKey: 'sk-1' });
    expect(saves).toBe(1);
  });

  it('已删掉的服务商相关键不再落盘', () => {
    install();
    dispatchInput(input('ai.key', 'sk-1'));
    dispatchInput(input('ai.provider', 'deepseek'));
    expect(saves).toBe(0);
  });
});

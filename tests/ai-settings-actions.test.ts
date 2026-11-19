/**
 * AI 组的设置输入（tests/ai-settings-actions.test.ts）
 *
 * 2026-11-19 移植注册表后，custom 仍写旧三件套，其余各家按 id 分表存。
 * 这里钉行为：每条路径只写自己的槽位，不碰别家；切服务商会触发重绘。
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

describe('AI 三个旧字段（custom 槽位）', () => {
  it('改地址：只写 baseUrl，模型与密钥不动', () => {
    install({ model: 'chat-x', apiKey: 'sk-1' });
    dispatchInput(input('ai.baseUrl', 'https://api.x/v1'));
    expect(settings.ai.baseUrl).toBe('https://api.x/v1');
    expect(settings.ai.model).toBe('chat-x');
    expect(settings.ai.apiKey).toBe('sk-1');
    expect(saves).toBe(1);
  });

  it('改模型：只写 model', () => {
    install({ baseUrl: 'https://api.x/v1', apiKey: 'sk-1' });
    dispatchInput(input('ai.model', 'chat-x'));
    expect(settings.ai.model).toBe('chat-x');
    expect(saves).toBe(1);
  });

  it('改密钥：只写 apiKey', () => {
    install({ baseUrl: 'https://api.x/v1', model: 'chat-x' });
    dispatchInput(input('ai.apiKey', 'sk-1'));
    expect(settings.ai.apiKey).toBe('sk-1');
    expect(saves).toBe(1);
  });
});

describe('AI per-provider 覆盖路径', () => {
  it('各家密钥 / 模型 / token / 思考档位写各自的 id，别家不动', () => {
    install({ apiKeys: { kimi: 'sk-k' } });
    dispatchInput(input('ai.apiKeys.openai', 'sk-o'));
    dispatchInput(input('ai.modelOverrides.openai', 'gpt-x'));
    dispatchInput(input('ai.maxTokensOverrides.openai', '4096'));
    dispatchInput(input('ai.thinkingOverrides.deepseek', 'low'));
    expect(settings.ai.apiKeys).toEqual({ kimi: 'sk-k', openai: 'sk-o' });
    expect(settings.ai.modelOverrides).toEqual({ openai: 'gpt-x' });
    expect(settings.ai.maxTokensOverrides).toEqual({ openai: 4096 });
    expect(settings.ai.thinkingOverrides).toEqual({ deepseek: 'low' });
    expect(saves).toBe(4);
  });

  it('切服务商 / 协议会落盘；不认识的路径不落盘', () => {
    install();
    dispatchInput(input('ai.provider', 'openai'));
    expect(settings.ai.provider).toBe('openai');
    dispatchInput(input('ai.customProtocol', 'anthropic'));
    expect(settings.ai.customProtocol).toBe('anthropic');
    const before = saves;
    dispatchInput(input('ai.notAField', 'x'));
    expect(saves).toBe(before);
  });
});

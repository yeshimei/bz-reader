/**
 * 设置页 · AI 服务商注册表（tests/settings-ai-providers.test.ts）
 *
 * 从 bz 主仓移植的整套设置：服务商下拉 / 自定义地址与协议 / 每家密钥行 +
 * 测试连接 / 模型名 + 获取模型名 / 最大输出 token / 思考档位。
 * 这里只钉渲染契约（结构、显隐、data-* 钩子），动作在 ai-settings-actions 测。
 */
import { describe, expect, it, vi } from 'vitest';

const entState = vi.hoisted(() => ({ unlocked: true, patron: false, name: '' }));
vi.mock('../src/data/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/entitlement')>();
  return {
    ...actual,
    can: () => entState.unlocked,
    entitlement: () => ({
      tier: entState.unlocked ? 'paid' : 'free',
      unlocked: entState.unlocked,
      patron: entState.patron,
      name: entState.name || undefined,
      license: 'BZR2.test',
    }),
  };
});

import { DEFAULT_PREFS } from '../src/data/prefs';
import { DEFAULT_SETTINGS, type AiSettings } from '../src/data/settings';
import { viewSettings } from '../src/shell/render/settings';

const html = (ai: AiSettings = DEFAULT_SETTINGS.ai): string =>
  viewSettings({
    prefs: DEFAULT_PREFS,
    settings: { ...DEFAULT_SETTINGS, ai },
    pen: 'amber',
    hotkeys: [],
    version: '1.0.0',
  });

const aiOf = (over: Partial<AiSettings>): AiSettings => ({
  ...DEFAULT_SETTINGS.ai,
  apiKeys: {},
  modelOverrides: {},
  maxTokensOverrides: {},
  thinkingOverrides: {},
  ...over,
});

describe('服务商接入区', () => {
  it('服务商下拉列出 18 家，当前选中的那家带 selected', () => {
    const out = html(aiOf({ provider: 'openai' }));
    const sel = out.match(/data-k="ai\.provider"[\s\S]*?<\/select>/)?.[0] ?? '';
    expect((sel.match(/<option /g) ?? []).length).toBe(18);
    expect(sel).toContain('value="openai" selected');
  });

  it('只显示当前服务商的密钥行，测试按钮带该家 id', () => {
    const out = html(aiOf({ provider: 'openai', apiKeys: { openai: 'sk-o', kimi: 'sk-k' } }));
    expect(out).toContain('data-k="ai.apiKeys.openai"');
    expect(out).not.toContain('data-k="ai.apiKeys.kimi"');
    expect(out).toContain('data-act="aiprovtest" data-k="openai"');
    expect(out).toContain('sk-o');
  });

  it('自定义显示地址与协议两行，密钥走旧三件套的 apiKey', () => {
    const out = html(aiOf({ provider: 'custom', baseUrl: 'https://x/v1', apiKey: 'sk-x', customProtocol: 'anthropic' }));
    expect(out).toContain('data-k="ai.baseUrl"');
    expect(out).toContain('data-k="ai.customProtocol"');
    expect(out).toContain('data-k="ai.apiKey"');
    expect(out).toContain('https://x/v1');
  });

  it('在册服务商不显示自定义地址 / 协议两行', () => {
    const out = html(aiOf({ provider: 'deepseek' }));
    expect(out).not.toContain('data-k="ai.baseUrl"');
    expect(out).not.toContain('data-k="ai.customProtocol"');
  });
});

describe('模型配置区', () => {
  it('模型名 + 获取模型名按钮 + 最大输出 token 都在', () => {
    const out = html(aiOf({ provider: 'openai', maxTokensOverrides: { openai: 4096 } }));
    expect(out).toContain('data-k="ai.modelOverrides.openai"');
    expect(out).toContain('data-act="aifetchmodels"');
    expect(out).toContain('data-k="ai.maxTokensOverrides.openai"');
    expect(out).toContain('4096');
  });

  it('custom 的模型名 / 上限覆盖走旧三件套槽位', () => {
    const out = html(aiOf({ provider: 'custom', model: 'm1', baseUrl: 'https://x/v1', apiKey: 'sk-x' }));
    expect(out).toContain('data-k="ai.model"');
    expect(out).not.toContain('data-k="ai.modelOverrides.custom"');
  });

  it('思考档位只列该家有的档：deepseek 有、自定义没有', () => {
    const withThinking = html(aiOf({ provider: 'deepseek', thinkingOverrides: { deepseek: 'low' } }));
    expect(withThinking).toContain('data-k="ai.thinkingOverrides.deepseek"');
    expect(withThinking).toContain('value="low" selected');

    const custom = html(aiOf({ provider: 'custom', baseUrl: 'https://x/v1', apiKey: 'sk-x' }));
    expect(custom).not.toContain('data-k="ai.thinkingOverrides.custom"');
  });
});

/**
 * AI 设置迁移（tests/ai-settings-migrate.test.ts）
 *
 * 移植注册表后，AI 配置从「地址 / 模型 / 密钥」三件套扩成「服务商 + per-provider
 * 覆盖表」。铁律：用户已填的不能丢——旧三件套原样落到「自定义」槽位，
 * 2026-11-11 那版分服务商结构搬到新的 override 表。
 */
import { describe, expect, it } from 'vitest';
import { aiReady, normalizeSettings } from '../src/data/settings';

describe('AI 配置迁移：旧三件套不丢', () => {
  it('老 data.json 的地址 / 密钥 / 模型全部保留，落到自定义通道', () => {
    const s = normalizeSettings({
      ai: { baseUrl: 'https://proxy.example.com/v1', apiKey: 'sk-old', model: 'my-model' },
    });
    expect(s.ai.provider).toBe('custom');
    expect(s.ai.baseUrl).toBe('https://proxy.example.com/v1');
    expect(s.ai.apiKey).toBe('sk-old');
    expect(s.ai.model).toBe('my-model');
    expect(aiReady(s)).toBe(true);
  });

  it('全新安装默认 deepseek，三件套空、各覆盖表空', () => {
    const ai = normalizeSettings({}).ai;
    expect(ai.provider).toBe('deepseek');
    expect(ai.baseUrl).toBe('');
    expect(ai.apiKey).toBe('');
    expect(ai.model).toBe('');
    expect(ai.apiKeys).toEqual({});
    expect(ai.modelOverrides).toEqual({});
    expect(ai.maxTokensOverrides).toEqual({});
    expect(ai.thinkingOverrides).toEqual({});
    expect(ai.customProtocol).toBe('openai');
  });

  it('老的分服务商结构（provider + keys/models）搬进新覆盖表', () => {
    const ai = normalizeSettings({
      ai: {
        provider: 'zhipu',
        baseUrl: 'x',
        keys: { zhipu: 'sk-z', custom: 'sk-c' },
        models: { zhipu: 'glm-x' },
      },
    }).ai;
    expect(ai.provider).toBe('zhipu');
    expect(ai.apiKeys.zhipu).toBe('sk-z');
    expect(ai.modelOverrides.zhipu).toBe('glm-x');
  });

  it('新结构原样保留：各家密钥 / 模型 / token / 思考档位互不污染', () => {
    const ai = normalizeSettings({
      ai: {
        provider: 'openai',
        apiKeys: { openai: 'sk-o', kimi: 'sk-k' },
        modelOverrides: { openai: 'gpt-x' },
        maxTokensOverrides: { openai: 4096 },
        thinkingOverrides: { deepseek: 'low' },
        customProtocol: 'anthropic',
      },
    }).ai;
    expect(ai.provider).toBe('openai');
    expect(ai.apiKeys).toEqual({ openai: 'sk-o', kimi: 'sk-k' });
    expect(ai.modelOverrides).toEqual({ openai: 'gpt-x' });
    expect(ai.maxTokensOverrides).toEqual({ openai: 4096 });
    expect(ai.thinkingOverrides).toEqual({ deepseek: 'low' });
    expect(ai.customProtocol).toBe('anthropic');
  });

  it('手改坏的 provider 回落 deepseek，已填的密钥不丢', () => {
    const ai = normalizeSettings({
      ai: { provider: 'no-such-provider', apiKeys: { ollama: 'sk-local' } },
    }).ai;
    expect(ai.provider).toBe('deepseek');
    expect(ai.apiKeys.ollama).toBe('sk-local');
  });

  it('maxTokensOverrides 只收正数，非数 / 负数被丢掉', () => {
    const ai = normalizeSettings({
      ai: { maxTokensOverrides: { openai: 4096, kimi: -1, deepseek: 'x' } },
    }).ai;
    expect(ai.maxTokensOverrides).toEqual({ openai: 4096 });
  });

  it('aiReady 按当前服务商判定：本地服务空密钥也放行', () => {
    const s = normalizeSettings({ ai: { provider: 'ollama', apiKeys: {} } });
    expect(aiReady(s)).toBe(true); // 官方端点 + 默认模型 + 本地免鉴权
    const cloud = normalizeSettings({ ai: { provider: 'openai', apiKeys: {} } });
    expect(aiReady(cloud)).toBe(false);
  });
});

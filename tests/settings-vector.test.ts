/**
 * 设置项的迁移与退役字段（tests/settings-vector.test.ts）
 *
 * 2026-11-07：向量改由第二大脑提供，本插件不再自己选嵌入模型；「连接至 BZ
 * AI 知识库」改成自动识别，也不该再有开关。老 data.json 里留着这两个字段
 * 的要安静丢掉。
 *
 * 2026-11-19：AI 设置从三件套扩成服务商注册表（各家按 id 分表存），
 * 老三件套落到 custom，旧分服务商结构的 keys/models 搬进新表，值不许丢。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/data/settings';

describe('设置项', () => {
  it('默认值里没有嵌入模型，也没有知识库开关', () => {
    expect('embedModel' in DEFAULT_SETTINGS.ai).toBe(false);
    expect('aiKnowledge' in DEFAULT_SETTINGS).toBe(false);
  });

  it('老 data.json 里的 embedModel / aiKnowledge 读进来就没了', () => {
    const s = normalizeSettings({
      ai: { baseUrl: 'https://api.x/v1', apiKey: 'k', model: 'chat-x', embedModel: 'text-embedding-3-small' },
      aiKnowledge: true,
    });
    expect('embedModel' in s.ai).toBe(false);
    expect('aiKnowledge' in s).toBe(false);
  });

  it('旧三件套原样落到自定义通道，一个值都不丢', () => {
    const s = normalizeSettings({ ai: { baseUrl: 'https://api.x/v1', apiKey: 'k', model: 'chat-x' } });
    expect(s.ai.provider).toBe('custom');
    expect(s.ai.baseUrl).toBe('https://api.x/v1');
    expect(s.ai.apiKey).toBe('k');
    expect(s.ai.model).toBe('chat-x');
  });

  it('旧分服务商结构：密钥与模型搬进新表，按 id 分开存', () => {
    const s = normalizeSettings({
      ai: { provider: 'deepseek', baseUrl: '', keys: { deepseek: 'sk-d' }, models: { deepseek: 'ds-chat' } },
    });
    expect(s.ai.provider).toBe('deepseek');
    expect(s.ai.apiKeys).toEqual({ deepseek: 'sk-d' });
    expect(s.ai.modelOverrides).toEqual({ deepseek: 'ds-chat' });
  });

  it('旧分服务商结构：custom 的槽位回到三件套', () => {
    const s = normalizeSettings({
      ai: {
        provider: 'custom',
        baseUrl: 'https://gw.example.com/v1',
        keys: { custom: 'sk-c' },
        models: { custom: 'qwen-max' },
      },
    });
    expect(s.ai.provider).toBe('custom');
    expect(s.ai.baseUrl).toBe('https://gw.example.com/v1');
    expect(s.ai.apiKey).toBe('sk-c');
    expect(s.ai.model).toBe('qwen-max');
  });

  it('各家密钥互不串行：换服务商不覆盖已填的那家', () => {
    const s = normalizeSettings({
      ai: { provider: 'deepseek', keys: { custom: 'sk-c', deepseek: 'sk-d' }, models: { custom: 'qwen-max' } },
    });
    expect(s.ai.provider).toBe('deepseek');
    expect(s.ai.apiKeys).toEqual({ custom: 'sk-c', deepseek: 'sk-d' });
    expect(s.ai.modelOverrides).toEqual({ custom: 'qwen-max' });
  });

  it('认不出的 id 回落 deepseek，各家密钥仍原样保留', () => {
    const s = normalizeSettings({
      ai: {
        provider: 'no-such-provider',
        baseUrl: 'https://api.openai.com/v1',
        keys: { openai: 'sk-o' },
        models: { openai: 'gpt-4.1' },
      },
    });
    expect(s.ai.provider).toBe('deepseek');
    expect(s.ai.apiKeys).toEqual({ openai: 'sk-o' });
    expect(s.ai.modelOverrides).toEqual({ openai: 'gpt-4.1' });
  });
});

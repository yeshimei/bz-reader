/**
 * 设置里不该再有的两项（tests/settings-vector.test.ts）
 *
 * 2026-11-07：向量改由第二大脑提供，本插件不再自己选嵌入模型；「连接至 BZ
 * AI 知识库」改成自动识别（检测到 bz 就连），也不该再有开关。
 *
 * 钉住的是**旧数据能安静地降级**：老用户的 data.json 里还留着这两个字段，
 * 读的时候必须丢掉，而不是带着它们继续跑（带 embedModel 会让人以为这里还
 * 能选模型；带 aiKnowledge 会出现「明明没开关却有个 true」）。
 *
 * 2026-11-11 同日回摆：AI 设置从「分服务商存」搬回「地址 / 模型 / 密钥」
 * 三件套。这里同时钉住迁移：预设服务商补当时的地址与默认模型，自定义优先
 * 用旧 baseUrl 与 custom 槽位，老 data.json 升级后配置不能丢。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/data/settings';

describe('设置项', () => {
  it('默认值里没有嵌入模型，也没有知识库开关', () => {
    expect(Object.keys(DEFAULT_SETTINGS.ai).sort()).toEqual(['apiKey', 'baseUrl', 'model']);
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

  it('旧三件套原样保留', () => {
    const s = normalizeSettings({ ai: { baseUrl: 'https://api.x/v1', apiKey: 'k', model: 'chat-x' } });
    expect(s.ai).toEqual({ baseUrl: 'https://api.x/v1', apiKey: 'k', model: 'chat-x' });
  });

  it('分服务商结构：预设服务商补当时的地址与默认模型', () => {
    const s = normalizeSettings({
      ai: { provider: 'deepseek', baseUrl: '', keys: { deepseek: 'sk-d' }, models: {} },
    });
    expect(s.ai).toEqual({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-d',
      model: 'deepseek-v4-flash',
    });
  });

  it('分服务商结构：自定义优先用旧 baseUrl 与 custom 槽位', () => {
    const s = normalizeSettings({
      ai: {
        provider: 'custom',
        baseUrl: 'https://gw.example.com/v1',
        keys: { custom: 'sk-c' },
        models: { custom: 'qwen-max' },
      },
    });
    expect(s.ai).toEqual({
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'sk-c',
      model: 'qwen-max',
    });
  });

  it('分服务商结构：只取当前选中那一家的密钥与模型', () => {
    const s = normalizeSettings({
      ai: { provider: 'deepseek', keys: { custom: 'sk-c' }, models: { custom: 'qwen-max' } },
    });
    expect(s.ai.apiKey).toBe('');
    expect(s.ai.model).toBe('deepseek-v4-flash');
  });

  it('分服务商结构：认不出的 id 按自定义搬，至少地址与填过的值不丢', () => {
    const s = normalizeSettings({
      ai: {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        keys: { openai: 'sk-o' },
        models: { openai: 'gpt-4.1' },
      },
    });
    expect(s.ai).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-o',
      model: 'gpt-4.1',
    });
  });
});

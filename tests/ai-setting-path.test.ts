/**
 * AI 设置输入路径（tests/ai-setting-path.test.ts）
 *
 * 设置页把每个输入框的 data-k 交给 dispatchInput 落盘。注册表移植后，
 * 「密钥 / 模型名 / token / 思考档位」按服务商分表存，custom 还复用旧
 * 三件套；这里钉住路径 → 字段的映射，空值清除覆盖，空表不写垃圾。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AiSettings } from '../src/data/settings';
import { applyAiSettingPath } from '../src/data/ai-setting-path';

const ai = (): AiSettings => ({ ...DEFAULT_SETTINGS.ai, apiKeys: {}, modelOverrides: {}, maxTokensOverrides: {}, thinkingOverrides: {} });

describe('AI 设置输入路径', () => {
  it('旧三件套与服务商 / 协议写顶层字段', () => {
    expect(applyAiSettingPath(ai(), 'ai.baseUrl', ' https://x/v1 ')?.baseUrl).toBe('https://x/v1');
    expect(applyAiSettingPath(ai(), 'ai.apiKey', ' sk-1 ')?.apiKey).toBe('sk-1');
    expect(applyAiSettingPath(ai(), 'ai.model', ' m ')?.model).toBe('m');
    expect(applyAiSettingPath(ai(), 'ai.provider', 'openai')?.provider).toBe('openai');
    expect(applyAiSettingPath(ai(), 'ai.customProtocol', 'anthropic')?.customProtocol).toBe('anthropic');
    expect(applyAiSettingPath(ai(), 'ai.customProtocol', 'bad')?.customProtocol).toBe('openai');
  });

  it('各家密钥 / 模型名 / 思考档位按 id 写表，空值清掉这一项', () => {
    const withKey = applyAiSettingPath(ai(), 'ai.apiKeys.openai', ' sk-o ')!;
    expect(withKey.apiKeys).toEqual({ openai: 'sk-o' });
    expect(applyAiSettingPath(withKey, 'ai.apiKeys.openai', '')?.apiKeys).toEqual({});

    expect(applyAiSettingPath(ai(), 'ai.modelOverrides.deepseek', 'ds-chat')?.modelOverrides).toEqual({ deepseek: 'ds-chat' });
    expect(applyAiSettingPath(ai(), 'ai.thinkingOverrides.deepseek', 'low')?.thinkingOverrides).toEqual({ deepseek: 'low' });
  });

  it('最大输出 token 只收正数；0 / 负数 / 非数清除覆盖', () => {
    expect(applyAiSettingPath(ai(), 'ai.maxTokensOverrides.openai', '4096')?.maxTokensOverrides).toEqual({ openai: 4096 });
    expect(applyAiSettingPath(ai(), 'ai.maxTokensOverrides.openai', '0')?.maxTokensOverrides).toEqual({});
    expect(applyAiSettingPath(ai(), 'ai.maxTokensOverrides.openai', '-1')?.maxTokensOverrides).toEqual({});
    expect(applyAiSettingPath(ai(), 'ai.maxTokensOverrides.openai', 'abc')?.maxTokensOverrides).toEqual({});
  });

  it('别家的值不被顺手改掉；不认识的 k 不落盘', () => {
    const cur = ai();
    cur.apiKeys = { kimi: 'sk-k' };
    expect(applyAiSettingPath(cur, 'ai.apiKeys.openai', 'sk-o')?.apiKeys).toEqual({ kimi: 'sk-k', openai: 'sk-o' });
    expect(applyAiSettingPath(cur, 'ai.notAField', 'x')).toBeNull();
  });
});

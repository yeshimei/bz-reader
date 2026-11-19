/**
 * 跨插件共享 AI 配置（data/ai-share.ts）。
 *
 * 两条口径必须钉住：
 *   1. 只映射认识的东西——对方的垃圾字段不能变成「看起来配好了」；
 *   2. 半成品不借——缺密钥的配置借过来也发不出请求，不如不借。
 */
import { describe, expect, it } from 'vitest';
import { borrowAiFromReview } from '../src/data/ai-share';
import { aiReadyOf } from '../src/data/ai-providers';

describe('borrowAiFromReview：bz Review 的设置 → 本插件认的配置', () => {
  it('自定义通道：地址 / 密钥 / 模型三件套原样搬过来', () => {
    const ai = borrowAiFromReview({
      aiProvider: 'custom',
      aiCustomEndpoint: 'https://api.example.com/v1/',
      aiCustomApiKey: 'sk-x',
      aiCustomProtocol: 'anthropic',
      aiModelOverrides: { custom: 'my-model' },
    });
    expect(ai).not.toBeNull();
    expect(ai!.provider).toBe('custom');
    expect(ai!.baseUrl).toBe('https://api.example.com/v1/');
    expect(ai!.apiKey).toBe('sk-x');
    expect(ai!.model).toBe('my-model');
    expect(ai!.customProtocol).toBe('anthropic');
    expect(aiReadyOf(ai)).toBe(true);
  });

  it('注册表服务商：密钥按 id 搬，老的单槽密钥并进表', () => {
    const ai = borrowAiFromReview({
      aiProvider: 'deepseek',
      aiApiKeys: { deepseek: 'sk-table' },
      aiModelOverrides: { deepseek: 'deepseek-chat' },
      deepseekApiKey: 'sk-legacy',
      zhipuPlanApiKey: 'zp-plan',
    });
    expect(ai!.provider).toBe('deepseek');
    expect(ai!.apiKeys.deepseek).toBe('sk-table');
    expect(ai!.apiKeys['zhipu-plan']).toBe('zp-plan');
    expect(aiReadyOf(ai)).toBe(true);
  });

  it('没选服务商但填了自定义地址：当自定义通道', () => {
    const ai = borrowAiFromReview({ aiCustomEndpoint: 'https://x.test/v1', aiCustomApiKey: 'k' });
    expect(ai!.provider).toBe('custom');
  });

  it('什么都没填：没有可借的配置', () => {
    expect(borrowAiFromReview({})).toBeNull();
    expect(borrowAiFromReview(null)).toBeNull();
    expect(borrowAiFromReview('nope')).toBeNull();
  });

  it('选了服务商却没密钥：能映射，但不算就绪（不借半成品）', () => {
    const ai = borrowAiFromReview({ aiProvider: 'deepseek' });
    expect(ai).not.toBeNull();
    expect(aiReadyOf(ai)).toBe(false);
  });
});

describe('aiReadyOf：就绪判据', () => {
  it('本地服务免鉴权：Ollama 空密钥也算就绪', () => {
    expect(aiReadyOf({
      provider: 'ollama', baseUrl: '', apiKey: '', model: '',
      apiKeys: {}, customProtocol: 'openai', modelOverrides: {}, maxTokensOverrides: {}, thinkingOverrides: {},
    })).toBe(true);
  });

  it('云端服务缺密钥：不就绪', () => {
    expect(aiReadyOf({
      provider: 'openai', baseUrl: '', apiKey: '', model: '',
      apiKeys: {}, customProtocol: 'openai', modelOverrides: {}, maxTokensOverrides: {}, thinkingOverrides: {},
    })).toBe(false);
  });
});

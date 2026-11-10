/**
 * AI 服务商表与「配好了没有」的判定（tests/ai-provider.test.ts）
 *
 * 2026-11-11：AI 组从「地址 / 模型 / 密钥」三个自由输入框改成「选服务商 →
 * 填密钥 → 选模型」。有三个结论必须钉死，它们决定用户填完密钥点 AI 按钮
 * 到底能不能用：
 *   1) 选一家就自带地址与默认模型，只填密钥即可用（Ollama 连密钥都不用）；
 *   2) 「自定义」必须自己给地址与模型，注册表给不出默认；
 *   3) 老版本存下来的三件套要安静地搬进「自定义」，一个值都不丢。
 */
import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDERS,
  DEFAULT_AI_PROVIDER,
  aiProviderLabel,
  aiProviderSpec,
  isAiProviderId,
} from '../src/data/ai-providers';
import { aiReady, normalizeSettings, resolveAi } from '../src/data/settings';

describe('服务商表', () => {
  it('四家齐全、顺序固定（设置页按这个顺序铺按钮）', () => {
    expect(AI_PROVIDERS.map((p) => p.id)).toEqual(['deepseek', 'zhipu-plan', 'ollama', 'custom']);
    expect(DEFAULT_AI_PROVIDER).toBe('deepseek');
  });

  it('前三家自带地址与默认模型，自定义两个都留空', () => {
    for (const id of ['deepseek', 'zhipu-plan', 'ollama'] as const) {
      const spec = aiProviderSpec(id);
      expect(spec.endpoint, id).toMatch(/^https?:\/\//);
      expect(spec.model, id).not.toBe('');
    }
    const custom = aiProviderSpec('custom');
    expect(custom.endpoint).toBe('');
    expect(custom.model).toBe('');
  });

  it('只有 Ollama 与自定义允许留空密钥（本地与无鉴权自建服务）', () => {
    expect(aiProviderSpec('deepseek').keyRequired).toBe(true);
    expect(aiProviderSpec('zhipu-plan').keyRequired).toBe(true);
    expect(aiProviderSpec('ollama').keyRequired).toBe(false);
    expect(aiProviderSpec('custom').keyRequired).toBe(false);
  });

  it('认不出的服务商回落缺省，不返回空表项', () => {
    expect(aiProviderSpec('openai').id).toBe('deepseek');
    expect(aiProviderSpec(undefined).id).toBe('deepseek');
    expect(isAiProviderId('zhihu')).toBe(false);
    expect(isAiProviderId('custom')).toBe(true);
  });

  it('界面名字随语言走：中文是「自定义」，不是英文原文', () => {
    expect(aiProviderLabel('custom').trim().length).toBeGreaterThan(0);
    expect(aiProviderLabel('deepseek')).toBe('DeepSeek');
  });
});

describe('配好了没有', () => {
  const ai = (patch: Record<string, unknown>) => normalizeSettings({ ai: patch });

  it('新装什么都没填：缺省是 DeepSeek，但没密钥不算可用', () => {
    const s = ai({});
    expect(resolveAi(s).provider).toBe('deepseek');
    expect(resolveAi(s).baseUrl).toBe(aiProviderSpec('deepseek').endpoint);
    expect(resolveAi(s).model).toBe(aiProviderSpec('deepseek').model);
    expect(aiReady(s)).toBe(false);
  });

  it('DeepSeek 只填密钥就能用，模型留空走默认', () => {
    const s = ai({ provider: 'deepseek', keys: { deepseek: 'sk-x' } });
    expect(aiReady(s)).toBe(true);
    expect(resolveAi(s).model).toBe(aiProviderSpec('deepseek').model);
    expect(resolveAi(s).apiKey).toBe('sk-x');
  });

  it('智谱 Plan 用 Coding 套餐地址（走标准接口会按量计费报余额不足）', () => {
    const s = ai({ provider: 'zhipu-plan', keys: { 'zhipu-plan': 'zp' } });
    expect(resolveAi(s).baseUrl).toContain('/api/coding/paas/v4');
    expect(aiReady(s)).toBe(true);
  });

  it('Ollama 本地不需要密钥，装好模型就能用', () => {
    const s = ai({ provider: 'ollama' });
    expect(aiReady(s)).toBe(true);
    expect(resolveAi(s).model).toBe(aiProviderSpec('ollama').model);
  });

  it('每家的密钥与模型各存各的，切换互不覆盖', () => {
    const s = ai({
      provider: 'zhipu-plan',
      keys: { deepseek: 'sk-d', 'zhipu-plan': 'zp' },
      models: { deepseek: 'deepseek-v4-pro' },
    });
    expect(resolveAi(s).apiKey).toBe('zp');
    expect(resolveAi(s).model).toBe(aiProviderSpec('zhipu-plan').model);
    const back = ai({
      provider: 'deepseek',
      keys: { deepseek: 'sk-d', 'zhipu-plan': 'zp' },
      models: { deepseek: 'deepseek-v4-pro' },
    });
    expect(resolveAi(back).apiKey).toBe('sk-d');
    expect(resolveAi(back).model).toBe('deepseek-v4-pro');
  });

  it('自定义：地址与模型都填了才可用，密钥可以留空（本地网关）', () => {
    expect(aiReady(ai({ provider: 'custom', baseUrl: 'https://gw.example.com/v1' }))).toBe(false);
    expect(
      aiReady(ai({ provider: 'custom', baseUrl: 'https://gw.example.com/v1', models: { custom: 'qwen-max' } })),
    ).toBe(true);
    const s = ai({ provider: 'custom', baseUrl: 'https://gw.example.com/v1', models: { custom: 'qwen-max' } });
    expect(resolveAi(s)).toMatchObject({ baseUrl: 'https://gw.example.com/v1', model: 'qwen-max', apiKey: '' });
  });

  it('未知服务商不会把整份设置弄坏：回落 DeepSeek 照常判可用', () => {
    const s = ai({ provider: 'openai', keys: { deepseek: 'sk-d' } });
    expect(resolveAi(s).provider).toBe('deepseek');
    expect(aiReady(s)).toBe(true);
  });
});

describe('老数据搬家', () => {
  it('v0.1 的三件套（地址 + 密钥 + 模型）整份搬进「自定义」', () => {
    const s = normalizeSettings({
      ai: { baseUrl: 'https://api.x/v1', apiKey: 'sk-old', model: 'chat-x' },
    });
    expect(s.ai.provider).toBe('custom');
    expect(s.ai.baseUrl).toBe('https://api.x/v1');
    expect(s.ai.keys.custom).toBe('sk-old');
    expect(s.ai.models.custom).toBe('chat-x');
    expect(aiReady(s)).toBe(true);
  });

  it('旧地址空着、只填过密钥：留作 DeepSeek 的密钥，不硬塞进自定义', () => {
    const s = normalizeSettings({ ai: { baseUrl: '', apiKey: 'sk-d', model: '' } });
    expect(s.ai.provider).toBe('deepseek');
    expect(s.ai.keys.deepseek).toBe('sk-d');
    expect(s.ai.models.deepseek ?? '').toBe('');
  });

  it('新结构原样读回，不因重复归一化被改写', () => {
    const seed = {
      ai: {
        provider: 'ollama',
        baseUrl: 'https://keep.example/v1',
        keys: { deepseek: 'sk-d', ollama: 'unused' },
        models: { deepseek: 'deepseek-v4-pro', ollama: 'qwen2.5:7b' },
      },
    };
    const once = normalizeSettings(seed);
    const twice = normalizeSettings(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
    expect(resolveAi(once).model).toBe('qwen2.5:7b');
  });

  it('手改坏的 JSON：非字符串的密钥/模型收敛成空，不把对象带进请求', () => {
    const s = normalizeSettings({
      ai: {
        provider: 'deepseek',
        keys: { deepseek: 42 },
        models: { deepseek: { evil: true } },
      },
    });
    expect(s.ai.keys.deepseek ?? '').toBe('');
    expect(s.ai.models.deepseek ?? '').toBe('');
    /* 真正的判据是「发请求时拿到的是空串，不是一个对象」 */
    expect(resolveAi(s).apiKey).toBe('');
    expect(resolveAi(s).model).toBe(aiProviderSpec('deepseek').model);
  });
});

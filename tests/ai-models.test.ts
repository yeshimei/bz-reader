/**
 * 模型列表拉取（tests/ai-models.test.ts）
 *
 * 「获取模型名」按钮的纯数据层：OpenAI 兼容 GET /models、Ollama GET /api/tags。
 * 依赖用 deps 注入，测试不发真实请求、也不碰 DOM。
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchProviderModels, parseModelList } from '../src/core/ai-models';
import { getProviderDescriptor, type AiSettingsLike } from '../src/data/ai-providers';

const settings = (over: Partial<AiSettingsLike> = {}): AiSettingsLike => ({
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  model: '',
  apiKeys: { openai: 'sk-o' },
  customProtocol: 'openai',
  modelOverrides: {},
  maxTokensOverrides: {},
  thinkingOverrides: {},
  ...over,
});

type FakeResp = { ok: boolean; status: number; json: () => Promise<unknown> };
const fetchReturning = (data: unknown) =>
  vi.fn(async (): Promise<FakeResp> => ({ ok: true, status: 200, json: async () => data }));

describe('模型列表解析', () => {
  it('OpenAI 兼容读 data[].id，兼容 data.models[].name', () => {
    expect(parseModelList(getProviderDescriptor('openai'), { data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] })).toEqual([
      'gpt-x',
      'gpt-y',
    ]);
    expect(parseModelList(getProviderDescriptor('openai'), { models: [{ name: 'm1' }] })).toEqual(['m1']);
  });

  it('Ollama 读 models[].name', () => {
    expect(parseModelList(getProviderDescriptor('ollama'), { models: [{ name: 'llama3.1' }] })).toEqual(['llama3.1']);
  });

  it('空列表抛错，文案给人看', () => {
    expect(() => parseModelList(getProviderDescriptor('openai'), { data: [] })).toThrow(/可用模型/);
  });
});

describe('按服务商拉取模型列表', () => {
  it('OpenAI 兼容：GET /models，Bearer 鉴权，id 去重保序', async () => {
    const fetchFn = fetchReturning({ data: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] });
    const models = await fetchProviderModels('openai', settings(), { fetchFn });
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-o');
    expect(models).toEqual([
      { id: 'a', detail: 'OpenAI' },
      { id: 'b', detail: 'OpenAI' },
    ]);
  });

  it('Ollama：GET 本机 /api/tags，不带鉴权头', async () => {
    const fetchFn = fetchReturning({ models: [{ name: 'llama3.1', details: { parameter_size: '8B' } }] });
    const models = await fetchProviderModels('ollama', settings(), { fetchFn });
    expect(fetchFn.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(models).toEqual([{ id: 'llama3.1', detail: 'Ollama（本地）' }]);
  });

  it('Anthropic 走 x-api-key + 版本头，不打 Bearer', async () => {
    const fetchFn = fetchReturning({ data: [{ id: 'claude-x' }] });
    await fetchProviderModels('anthropic', settings({ apiKeys: { anthropic: 'sk-c' } }), { fetchFn });
    expect(fetchFn.mock.calls[0][1].headers['x-api-key']).toBe('sk-c');
    expect(fetchFn.mock.calls[0][1].headers['anthropic-version']).toBe('2023-06-01');
  });

  it('自定义读设置里的地址；没填地址或密钥直接拦下', async () => {
    const fetchFn = fetchReturning({ data: [{ id: 'm' }] });
    await fetchProviderModels(
      'custom',
      settings({ baseUrl: 'https://my.proxy/v1/', apiKey: 'sk-x', customProtocol: 'openai' }),
      { fetchFn },
    );
    expect(fetchFn.mock.calls[0][0]).toBe('https://my.proxy/v1/models');

    await expect(fetchProviderModels('custom', settings({ baseUrl: '', apiKey: 'sk-x' }), { fetchFn })).rejects.toThrow(
      /地址/,
    );
    await expect(
      fetchProviderModels('custom', settings({ baseUrl: 'https://x/v1', apiKey: '' }), { fetchFn }),
    ).rejects.toThrow(/密钥/);
  });
});

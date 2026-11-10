/**
 * 模型列表拉取（tests/ai-models.test.ts）
 *
 * 「获取模型」按钮把服务商 /models 的返回摊成一行行名字给用户挑。三层要钉：
 *   1) 两种响应形态（OpenAI 兼容 data[].id、Ollama /api/tags 的 models[].name）；
 *   2) 端点拼接（Ollama 的列表挂在根路径，不在 /v1 下）；
 *   3) 失败文案给人看——401 是密钥、404 是这家不支持列表接口、超时是网络。
 * 拉不到不能让模型框变成死路：界面那头仍然允许手填，这里只负责把话说清楚。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MODELS_TIMEOUT_MS,
  fetchProviderModels,
  parseModelList,
  modelsUrlOf,
} from '../src/data/ai-models';

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
const fail = (status: number, body: unknown = {}) => ({ ok: false, status, json: async () => body });

describe('响应解析', () => {
  it('OpenAI 兼容：data[].id', () => {
    expect(parseModelList('openai', { data: [{ id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b']);
  });

  it('少数网关回 models[].name，同样认得', () => {
    expect(parseModelList('openai', { models: [{ name: 'm1' }, { name: 'm2' }] })).toEqual(['m1', 'm2']);
  });

  it('Ollama：models[].name', () => {
    expect(parseModelList('ollama', { models: [{ name: 'llama3.1:latest' }] })).toEqual(['llama3.1:latest']);
  });

  it('畸形项跳过；一条都没有就报「没有返回可用模型」', () => {
    expect(parseModelList('openai', { data: [{ id: 'a' }, {}, { id: 3 }, null] })).toEqual(['a']);
    expect(() => parseModelList('openai', { data: [] })).toThrow('没有返回可用');
    expect(() => parseModelList('ollama', {})).toThrow('没有返回可用');
  });

  it('重复名字去重保序（有的网关会把别名再列一遍）', () => {
    expect(parseModelList('openai', { data: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b']);
  });
});

describe('端点拼接', () => {
  it('普通服务商走 {地址}/models，尾部斜杠不要拼双份', () => {
    expect(modelsUrlOf('openai', 'https://api.x/v1')).toBe('https://api.x/v1/models');
    expect(modelsUrlOf('openai', 'https://api.x/v1/')).toBe('https://api.x/v1/models');
  });

  it('Ollama 的列表挂在根路径 /api/tags（/v1 下没有这个接口）', () => {
    expect(modelsUrlOf('ollama', 'http://localhost:11434/v1')).toBe('http://localhost:11434/api/tags');
    expect(modelsUrlOf('ollama', 'http://192.168.1.9:11434/v1/')).toBe('http://192.168.1.9:11434/api/tags');
  });
});

describe('拉取', () => {
  it('带 Bearer 头，返回去重后的名字', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ data: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] }));
    const list = await fetchProviderModels(
      { listApi: 'openai', baseUrl: 'https://api.x/v1', apiKey: 'sk-1' },
      { fetchFn: fetchFn as never },
    );
    expect(list).toEqual(['a', 'b']);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.x/v1/models');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-1');
  });

  it('Ollama 不带鉴权头', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ models: [{ name: 'llama3.1:latest' }] }));
    await fetchProviderModels(
      { listApi: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '' },
      { fetchFn: fetchFn as never },
    );
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('401 / 403 说「密钥无效」，404 说「这家不支持模型列表」', async () => {
    const one = (status: number) => ({ fetchFn: vi.fn().mockResolvedValue(fail(status)) as never });
    await expect(
      fetchProviderModels({ listApi: 'openai', baseUrl: 'https://a/v1', apiKey: 'k' }, one(401)),
    ).rejects.toThrow('检查密钥');
    await expect(
      fetchProviderModels({ listApi: 'openai', baseUrl: 'https://a/v1', apiKey: 'k' }, one(403)),
    ).rejects.toThrow('检查密钥');
    await expect(
      fetchProviderModels({ listApi: 'openai', baseUrl: 'https://a/v1', apiKey: 'k' }, one(404)),
    ).rejects.toThrow('不支持模型列表');
  });

  it('其他状态码把服务商给的错误说明带出来', async () => {
    const fetchFn = vi.fn().mockResolvedValue(fail(500, { error: { message: 'boom' } }));
    await expect(
      fetchProviderModels({ listApi: 'openai', baseUrl: 'https://a/v1', apiKey: 'k' }, { fetchFn: fetchFn as never }),
    ).rejects.toThrow('boom');
  });

  it('超时报「8 秒没有响应」，而不是一直转圈', async () => {
    const fetchFn = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(
      fetchProviderModels({ listApi: 'openai', baseUrl: 'https://a/v1', apiKey: 'k' }, { fetchFn: fetchFn as never }),
    ).rejects.toThrow(`${MODELS_TIMEOUT_MS / 1000} 秒没有响应`);
  });

  it('普通网络错误说连不上', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    await expect(
      fetchProviderModels({ listApi: 'openai', baseUrl: 'https://a/v1', apiKey: 'k' }, { fetchFn: fetchFn as never }),
    ).rejects.toThrow('连不上');
  });

  it('没给地址就不发请求（先提示去填）', async () => {
    const fetchFn = vi.fn();
    await expect(
      fetchProviderModels({ listApi: 'openai', baseUrl: '', apiKey: '' }, { fetchFn: fetchFn as never }),
    ).rejects.toThrow('接口地址');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_TIMEOUT_MS, aiAsk } from '../src/data/ai';
import type { ReaderSettings } from '../src/data/settings';

/** 2026-11-11：走「自定义」这条路——地址、密钥、模型齐备，与旧口径的测试数据等价 */
function settings(patch: Partial<ReaderSettings['ai']> = {}): ReaderSettings {
  return {
    exportDir: 'bz-reader/notes',
    exportComments: true,
    importDir: 'bz-reader/books',
    language: 'auto',
    aiAck: false,
    debugLog: false,
    ai: {
      provider: 'custom',
      baseUrl: 'https://api.example.com/v1',
      keys: { custom: 'sk-test' },
      models: { custom: 'test-model' },
      ...patch,
    },
  };
}

const okResponse = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

describe('AI 请求（P2-12：没有超时就会一直转圈）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('没配置时给人话，不是静默失败', async () => {
    /* DeepSeek 是必填密钥的一家：清空密钥才算「没配置」
       （自定义允许空密钥，拿它测这条会误判为已配好） */
    await expect(
      aiAsk(settings({ provider: 'deepseek', keys: {} }), { task: 'explain', text: 'x' }),
    ).rejects.toThrow('还没配置 AI');
  });

  it('超时错误变成「60 秒没有响应」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' })),
    );
    await expect(aiAsk(settings(), { task: 'explain', text: 'x' })).rejects.toThrow('60 秒没有响应');
  });

  it('普通网络错误告诉用户连不上', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));
    await expect(aiAsk(settings(), { task: 'explain', text: 'x' })).rejects.toThrow('连不上 AI 接口');
  });

  it('401 提示检查 Key，404 提示检查地址', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(aiAsk(settings(), { task: 'explain', text: 'x' })).rejects.toThrow('检查 API Key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(aiAsk(settings(), { task: 'explain', text: 'x' })).rejects.toThrow('检查接口地址');
  });

  it('返回空内容不当成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('   ')));
    await expect(aiAsk(settings(), { task: 'explain', text: 'x' })).rejects.toThrow('AI 没有返回内容');
  });

  it('正常返回 trim 后的文本', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('  hello  ')));
    await expect(aiAsk(settings(), { task: 'explain', text: 'x' })).resolves.toEqual({ text: 'hello' });
  });

  it('请求真的带上 60 秒超时信号，且地址拼成 /chat/completions', async () => {    const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await aiAsk(settings(), { task: 'explain', text: 'x' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(AI_TIMEOUT_MS).toBe(60_000);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(String(init.headers && (init.headers as Record<string, string>).Authorization)).toContain('Bearer sk-test');
  });

  it('自定义无密钥：不带 Authorization 头（本地网关不必收一个空 Bearer）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await aiAsk(settings({ keys: {} }), { task: 'explain', text: 'x' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('外部取消给出「已取消」，不冒充超时', async () => {
    const ctrl = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            (init.signal as AbortSignal).addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      ),
    );
    const p = aiAsk(settings(), { task: 'explain', text: 'x' }, { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow('已取消');
  });
});

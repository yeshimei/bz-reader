import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_ASK_TIMEOUT_MS, AI_TIMEOUT_MS, aiAsk, askTimeoutMs } from '../src/data/ai';
import type { ReaderSettings } from '../src/data/settings';

/** 地址、密钥、模型齐备的测试数据（三件套口径） */
function settings(patch: Partial<ReaderSettings['ai']> = {}): ReaderSettings {
  return {
    exportDir: 'bz-reader/notes',
    exportComments: true,
    importDir: 'bz-reader/books',
    language: 'auto',
    aiAck: false,
    debugLog: false,
    ai: {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'test-model',
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
    await expect(
      aiAsk(settings({ apiKey: '' }), { task: 'explain', text: 'x' }),
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

  /* 2026-11-15 用户报「扫描页识别：AI 没有返回内容」，图上明明一整页字。
     原来四种完全不同的原因共用一句提示，用户不知道该换模型还是调参数。
     下面五条把「拿到结果之后」这条路钉住：分段数组要认，空正文要分因。 */
  it('兼容分段数组的正文：有的兼容层把 content 回成 [{type:"text"}]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: [{ type: 'text', text: ' 你好' }, { type: 'text', text: '世界 ' }] } }],
        }),
      }),
    );
    await expect(aiAsk(settings(), { task: 'explain', text: 'x' })).resolves.toEqual({ text: '你好世界' });
  });

  it('空正文 + 被长度上限截断：提示指向输出上限，不是笼统一句', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '' } }] }),
      }),
    );
    await expect(aiAsk(settings(), { task: 'explain', text: 'x' })).rejects.toThrow(/长度上限/);
  });

  it('空正文 + 只有思考过程：提示换一个能看图的模型', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: '先看看这一页…' } }],
        }),
      }),
    );
    await expect(aiAsk(settings(), { task: 'explain', text: 'x' })).rejects.toThrow(/思考过程/);
  });

  it('空正文的普通情况：点明多半不支持看图，并带上当前模型名', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: null } }] }),
      }),
    );
    const p = aiAsk(settings(), { task: 'explain', text: 'x' });
    await expect(p).rejects.toThrow(/多模态/);
    await expect(aiAsk(settings(), { task: 'explain', text: 'x' })).rejects.toThrow(/test-model/);
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

  /* 真机（2026-11-16）：本地 14B 带 4800 字依据要 77 秒，带 8 块 7000 字
     超过 180 秒。全书问答必须等得久一点。 */
  it('全书问答等 5 分钟，划词任务仍是 60 秒', () => {
    expect(AI_ASK_TIMEOUT_MS).toBe(300_000);
    expect(askTimeoutMs('ask')).toBe(AI_ASK_TIMEOUT_MS);
    expect(askTimeoutMs('explain')).toBe(AI_TIMEOUT_MS);
    expect(askTimeoutMs('summarize')).toBe(AI_TIMEOUT_MS);
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

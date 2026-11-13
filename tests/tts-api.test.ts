import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { synthesizeSpeech, ttsBody, ttsEndpoint, ttsErrorCode } from '../src/core/tts-api';

const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  g.window = { setTimeout, clearTimeout };
});

afterEach(() => {
  delete g.window;
  vi.restoreAllMocks();
});

describe('TTS 端点推导', () => {
  it('没填地址时用官方默认端点', () => {
    expect(ttsEndpoint('')).toBe('https://api.deepseek.com/v1/tools/tts');
  });

  it('根地址补 /v1/tools/tts', () => {
    expect(ttsEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/tools/tts');
    expect(ttsEndpoint('https://api.deepseek.com/')).toBe('https://api.deepseek.com/v1/tools/tts');
  });

  it('已经以 /v1 结尾只补 /tools/tts', () => {
    expect(ttsEndpoint('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/tools/tts');
  });

  it('已经填到 /tools/tts 的原样用', () => {
    expect(ttsEndpoint('https://proxy.example/x/tools/tts')).toBe('https://proxy.example/x/tools/tts');
  });

  it('第三方代理的 /v1 也按同一规则补', () => {
    expect(ttsEndpoint('https://proxy.example/v1')).toBe('https://proxy.example/v1/tools/tts');
  });
});

describe('请求体与错误分类', () => {
  it('wav、不过滤 Markdown（书正文不是 Markdown）', () => {
    expect(ttsBody('你好', 'tide')).toEqual({
      text: '你好',
      voice_id: 'tide',
      format: 'wav',
      filter_markdown: false,
    });
  });

  it('401 / 403 是 Key 问题，400 是内容被拒，429 是限流，503/504 是繁忙', () => {
    expect(ttsErrorCode(401, '')).toBe('unauthorized');
    expect(ttsErrorCode(403, '')).toBe('unauthorized');
    expect(ttsErrorCode(400, 'Content Exists Risk')).toBe('rejected');
    expect(ttsErrorCode(429, '')).toBe('rate');
    expect(ttsErrorCode(503, '')).toBe('busy');
    expect(ttsErrorCode(504, '')).toBe('busy');
    expect(ttsErrorCode(500, 'boom')).toBe('http');
  });
});

describe('合成请求', () => {
  it('把地址、鉴权、请求体发出去，返回音频字节', async () => {
    const audio = new Uint8Array([1, 2, 3, 4]).buffer;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => audio,
    })) as unknown as typeof fetch;

    const got = await synthesizeSpeech({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      text: '他推开门。',
      voice: 'stella',
      fetchImpl,
    });

    expect(got.byteLength).toBe(4);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/tools/tts');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toEqual({
      text: '他推开门。',
      voice_id: 'stella',
      format: 'wav',
      filter_markdown: false,
    });
  });

  it('没配 Key 直接抛 unauthorized，不发请求', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      synthesizeSpeech({ apiKey: '  ', text: '你好', voice: 'stella', fetchImpl }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('400 抛 rejected，并把服务端那句话留在 message 里', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => 'Content Exists Risk',
    })) as unknown as typeof fetch;
    await expect(
      synthesizeSpeech({ apiKey: 'k', text: '敏感内容', voice: 'tide', fetchImpl }),
    ).rejects.toMatchObject({
      code: 'rejected',
      message: expect.stringContaining('Content Exists Risk'),
    });
  });

  it('空音频按失败处理，不把 0 字节当成成功', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;
    await expect(
      synthesizeSpeech({ apiKey: 'k', text: '你好', voice: 'stella', fetchImpl }),
    ).rejects.toMatchObject({ code: 'empty' });
  });

  it('外部取消后抛 aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as unknown as typeof fetch;
    await expect(
      synthesizeSpeech({ apiKey: 'k', text: '你好', voice: 'stella', signal: ctrl.signal, fetchImpl }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});

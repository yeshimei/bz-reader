/**
 * 流式问答（tests/ai-stream.test.ts）
 *
 * 锁的是「第一个字什么时候出现」。本地 14B 答一问 77 秒，这 77 秒界面
 * 一片空白，比答得慢更劝退——所以问答走流式，模型吐一个字界面就多一个字。
 *
 * 三件事必须成立：请求真的带 `stream: true`；帧被切碎（甚至切在汉字中间）
 * 也能拼回来；上游不认流、回了整份 JSON 时不能整个失败。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { postChat } from '../src/data/ai';

const config = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'test-model' };
const enc = new TextEncoder();

function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const part of parts) ctrl.enqueue(part);
      ctrl.close();
    },
  });
}

function sseResponse(parts: Uint8Array[]) {
  return {
    ok: true,
    headers: { get: () => 'text/event-stream' },
    body: streamOf(parts),
    json: async () => ({}),
  };
}

const sseText = (pieces: string[]): string =>
  pieces.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join('') +
  'data: [DONE]\n\n';

afterEach(() => vi.unstubAllGlobals());

describe('postChat · 流式', () => {
  it('请求带 stream: true，增量按顺序交出去，返回整条', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([enc.encode(sseText(['婚姻是', '一座', '围城']))]));
    vi.stubGlobal('fetch', fetchMock);

    const got: string[] = [];
    const text = await postChat(config, [{ role: 'user', content: '问' }], { onDelta: (p) => got.push(p) });

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(got).toEqual(['婚姻是', '一座', '围城']);
    expect(text).toBe('婚姻是一座围城');
  });

  it('一帧被切成两半也能拼回来（切在汉字中间）', async () => {
    const all = enc.encode(sseText(['围城', '很好']));
    /* 故意切在第一个汉字的三个字节中间：逐帧 toString 会解成乱码 */
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([all.slice(0, 12), all.slice(12, 40), all.slice(40)]));
    vi.stubGlobal('fetch', fetchMock);

    const got: string[] = [];
    const text = await postChat(config, [{ role: 'user', content: '问' }], { onDelta: (p) => got.push(p) });
    expect(text).toBe('围城很好');
    expect(got.join('')).toBe('围城很好');
  });

  it('上游忽略 stream 回了整份 JSON：退回一次性解析，不失败', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      body: streamOf([enc.encode('{"choices":[{"message":{"content":"一次性"}}]}')]),
      json: async () => ({ choices: [{ message: { content: '一次性' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const got: string[] = [];
    const text = await postChat(config, [{ role: 'user', content: '问' }], { onDelta: (p) => got.push(p) });
    expect(text).toBe('一次性');
    expect(got).toEqual([]);
  });

  it('流里一个字都没有：报「没有返回内容」，不当成空答案', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([enc.encode('data: [DONE]\n\n')])));
    await expect(postChat(config, [{ role: 'user', content: '问' }], { onDelta: () => undefined })).rejects.toThrow(
      /没有返回内容/,
    );
  });

  it('不给 onDelta 就不开流（识别这类短任务不需要边出边画）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: '一次性' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await postChat(config, [{ role: 'user', content: '问' }])).toBe('一次性');
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.stream).toBeUndefined();
  });
});

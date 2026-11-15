import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blobToDataUrl,
  bytesToBase64,
  dataUrlOf,
  mimeOf,
  recognizeOnPage,
  recognizeViaHttp,
  VISION_PROMPT,
  visionMessages,
} from '../src/data/ai-vision';
import type { ReaderSettings } from '../src/data/settings';

function settings(patch: Partial<ReaderSettings['ai']> = {}): ReaderSettings {
  return {
    exportDir: 'bz-reader/notes',
    exportComments: true,
    importDir: 'bz-reader/books',
    language: 'auto',
    aiAck: false,
    debugLog: false,
    ai: { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'vision-model', ...patch },
  };
}

const okResponse = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

describe('视觉识别的请求形状', () => {
  it('一段文字 + 一张图，图走 image_url', () => {
    const messages = visionMessages('data:image/jpeg;base64,AAA');
    const user = messages[1]!;
    const content = user.content as Array<Record<string, unknown>>;
    expect(content[0]?.type).toBe('text');
    expect(String(content[0]?.text)).toContain('JSON');
    expect(content[1]?.type).toBe('image_url');
    expect((content[1]?.image_url as { url: string }).url).toBe('data:image/jpeg;base64,AAA');
  });

  it('prompt 明确要求 0..1 的坐标与行数组', () => {
    expect(VISION_PROMPT).toContain('0 到 1');
    expect(VISION_PROMPT).toContain('"lines"');
    expect(VISION_PROMPT).toContain('一行一个对象');
  });
});

describe('recognizeOnPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('模型回 JSON：解析成行与位置', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse('{"lines":[{"text":"第一行","box":[0.1,0.2,0.5,0.03]}]}'),
    );
    vi.stubGlobal('fetch', fetchMock);
    const got = await recognizeOnPage(settings(), { image: 'data:image/jpeg;base64,AAA' });
    expect(got.layout).toBe(true);
    expect(got.lines[0]?.text).toBe('第一行');
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as {
      temperature: number;
      max_tokens: number;
      messages: unknown[];
    };
    expect(body.temperature).toBe(0.1);
    expect(body.max_tokens).toBe(4000);
    expect(body.messages).toHaveLength(2);
  });

  it('模型只回整页文字：layout=false，不假装能划词', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('{"text":"整页的一段字"}')));
    const got = await recognizeOnPage(settings(), { image: 'x' });
    expect(got.layout).toBe(false);
    expect(got.text).toBe('整页的一段字');
  });

  it('一个字都没认出来就报错，别静默返回空页', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('{"lines":[]}')));
    await expect(recognizeOnPage(settings(), { image: 'x' })).rejects.toThrow('没有认出文字');
  });

  it('没配置 AI 时说清去哪配', async () => {
    await expect(recognizeOnPage(settings({ apiKey: '' }), { image: 'x' })).rejects.toThrow('还没配置 AI');
  });
});

describe('外部 OCR 服务', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POST 纯 base64，不是 dataURL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lines: [{ text: '甲', box: [100, 200, 300, 40] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const got = await recognizeViaHttp({ url: 'http://127.0.0.1:9000/ocr', image: 'QUJD', mime: 'image/jpeg' });
    expect(got.lines[0]?.text).toBe('甲');
    expect(got.layout).toBe(true);
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.image).toBe('QUJD');
    expect(body.mime).toBe('image/jpeg');
  });

  it('外层套了 data 也认', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { text: '整页字' } }) }),
    );
    const got = await recognizeViaHttp({ url: 'http://x', image: 'QUJD', mime: 'image/png' });
    expect(got.text).toBe('整页字');
  });

  it('请求体同时带 image 与 base64（Umi-OCR 只认后者），像素坐标按出图尺寸换算', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 100,
        data: [
          {
            text: '第一行',
            box: [
              [100, 200],
              [500, 200],
              [500, 240],
              [100, 240],
            ],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const got = await recognizeViaHttp({
      url: 'http://127.0.0.1:1224/api/ocr',
      image: 'QUJD',
      mime: 'image/jpeg',
      width: 1000,
      height: 2000,
    });
    expect(got.layout).toBe(true);
    expect(got.lines[0]?.rect).toEqual({ left: 0.1, top: 0.1, width: 0.4, height: 0.02 });
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.base64).toBe('QUJD');
    expect(body.image).toBe('QUJD');
  });

  it('请求体带 Umi-OCR 的带坐标输出参数，否则只回整页文本、不能划词', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 100, data: [{ text: '甲', box: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.13], [0.1, 0.13]] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await recognizeViaHttp({ url: 'http://127.0.0.1:1224/api/ocr', image: 'QUJD', mime: 'image/jpeg' });
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.options).toEqual({ 'data.format': 'dict', 'tbpu.parser': 'multi_none' });
  });

  it('Umi-OCR 的 code 101 当「这页没字」，其他失败码把码带进提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 101, data: [] }) }));
    await expect(recognizeViaHttp({ url: 'http://x', image: 'QUJD', mime: 'image/jpeg' })).rejects.toThrow('没有认出文字');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ code: 500, data: null, msg: '模型没加载' }) }),
    );
    await expect(recognizeViaHttp({ url: 'http://x', image: 'QUJD', mime: 'image/jpeg' })).rejects.toThrow('code 500');
  });

  it('没填地址 / 连不上 / 非 200 / 非 JSON 都给一句人话', async () => {
    await expect(recognizeViaHttp({ url: '', image: 'x', mime: 'image/jpeg' })).rejects.toThrow('还没填 OCR 服务地址');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(recognizeViaHttp({ url: 'http://x', image: 'x', mime: 'image/jpeg' })).rejects.toThrow('连不上 OCR 服务');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    await expect(recognizeViaHttp({ url: 'http://x', image: 'x', mime: 'image/jpeg' })).rejects.toThrow('502');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => Promise.reject(new Error('bad')) }));
    await expect(recognizeViaHttp({ url: 'http://x', image: 'x', mime: 'image/jpeg' })).rejects.toThrow('不是 JSON');
  });
});

describe('图 → dataURL', () => {
  it('base64 与标准实现逐字节一致（含补齐位）', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(bytesToBase64(new Uint8Array([77]))).toBe('TQ==');
    expect(bytesToBase64(new Uint8Array([77, 97]))).toBe('TWE=');
    expect(bytesToBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu');
    expect(bytesToBase64(new TextEncoder().encode('hello world'))).toBe('aGVsbG8gd29ybGQ=');
  });

  it('dataURL 带 mime 前缀', () => {
    expect(dataUrlOf('QUJD')).toBe('data:image/jpeg;base64,QUJD');
    expect(dataUrlOf('QUJD', 'image/png')).toBe('data:image/png;base64,QUJD');
  });

  it('Blob 的 mime 归一到 image/，非图片退回 jpeg', () => {
    expect(mimeOf({ type: 'image/png' } as Blob)).toBe('image/png');
    expect(mimeOf({ type: '' } as Blob)).toBe('image/jpeg');
    expect(mimeOf(null)).toBe('image/jpeg');
  });

  it('blobToDataUrl 转出来能直接用；没有图就抛', async () => {
    const blob = new Blob([new Uint8Array([77, 97, 110])], { type: 'image/png' });
    expect(await blobToDataUrl(blob)).toBe('data:image/png;base64,TWFu');
    await expect(blobToDataUrl(null)).rejects.toThrow('没有生成图片');
  });
});

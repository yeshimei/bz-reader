/* ============================================================
 * bz-reader · 语音引擎门面
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  isFreeEngine,
  synthesizeFor,
  ttsCacheTag,
  ttsEngineReady,
  ttsMimeOf,
  type TtsRoute,
} from '../src/core/tts-engine';

function route(over: Partial<TtsRoute> = {}): TtsRoute {
  return {
    engine: 'deepseek',
    ai: { baseUrl: 'https://api.deepseek.com', apiKey: 'k' },
    local: { url: 'http://127.0.0.1:8880', model: 'kokoro', apiKey: '', format: 'mp3' },
    ...over,
  };
}

describe('ttsCacheTag', () => {
  it('DeepSeek 的键保持原样：老缓存是花过钱的，不能作废', () => {
    expect(ttsCacheTag('deepseek', 'stella')).toBe('stella');
  });

  it('本地加 local: 前缀，和云端同名音色不串', () => {
    expect(ttsCacheTag('local', 'stella')).toBe('local:stella');
  });
});

describe('ttsMimeOf', () => {
  it('DeepSeek 永远 wav，不看设置里的格式', () => {
    expect(ttsMimeOf('deepseek', 'mp3')).toBe('audio/wav');
  });

  it('本地按用户选的格式', () => {
    expect(ttsMimeOf('local', 'mp3')).toBe('audio/mpeg');
    expect(ttsMimeOf('local', 'opus')).toBe('audio/ogg');
    expect(ttsMimeOf('local', 'wav')).toBe('audio/wav');
  });
});

describe('ttsEngineReady', () => {
  it('DeepSeek 要 key', () => {
    expect(ttsEngineReady(route({ ai: { baseUrl: '', apiKey: '  ' } }))).toBe(false);
    expect(ttsEngineReady(route())).toBe(true);
  });

  it('本地要地址，不要 key', () => {
    expect(ttsEngineReady(route({ engine: 'local', local: { url: ' http://127.0.0.1:8880 ', model: '', apiKey: '', format: 'mp3' } }))).toBe(true);
    expect(ttsEngineReady(route({ engine: 'local', local: { url: '', model: '', apiKey: '', format: 'mp3' } }))).toBe(false);
  });
});

describe('isFreeEngine', () => {
  it('只有本地免费', () => {
    expect(isFreeEngine('local')).toBe(true);
    expect(isFreeEngine('deepseek')).toBe(false);
    expect(isFreeEngine('system')).toBe(false);
  });
});

describe('synthesizeFor', () => {
  it('本地引擎走 request 通道，返回对应 mime', async () => {
    const out = await synthesizeFor(route({ engine: 'local' }), '你好。', 'zf_xiaobei', undefined, {
      request: async () => ({ status: 200, arrayBuffer: new Uint8Array([1, 2]).buffer, text: '' }),
    });
    expect(out.mime).toBe('audio/mpeg');
    expect(new Uint8Array(out.buf)).toEqual(new Uint8Array([1, 2]));
  });

  it('本地引擎不看 DeepSeek 的 key：没配云端也能用', async () => {
    const out = await synthesizeFor(
      route({ engine: 'local', ai: { baseUrl: '', apiKey: '' } }),
      '你好。',
      'v',
      undefined,
      { request: async () => ({ status: 200, arrayBuffer: new Uint8Array([7]).buffer, text: '' }) },
    );
    expect(out.mime).toBe('audio/mpeg');
    expect(out.buf.byteLength).toBe(1);
  });

  it('DeepSeek 引擎走 fetch，返回 wav', async () => {
    const calls: string[] = [];
    const out = await synthesizeFor(route(), '你好。', 'stella', undefined, {
      fetchImpl: (async (url: string) => {
        calls.push(url);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([3]).buffer,
          text: async () => '',
        };
      }) as unknown as typeof fetch,
    });
    expect(out.mime).toBe('audio/wav');
    expect(calls[0]).toContain('/v1/tools/tts');
  });

  it('系统语音不该走网络：直接抛，别悄悄换成 DeepSeek 花用户的钱', async () => {
    await expect(synthesizeFor(route({ engine: 'system' }), '你好。', 'v', undefined, {})).rejects.toThrow();
  });
});

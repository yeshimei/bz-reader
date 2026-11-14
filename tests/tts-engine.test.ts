/* ============================================================
 * bz-reader · 语音引擎门面（2026-11-14 二轮）
 *
 * 这一层决定「哪台引擎出声、缓存键怎么算、要什么才叫配好了」。
 * 在线从 DeepSeek 里独立出来之后多了一条分支：地址是官方就走老接口，
 * 其它地址走 OpenAI 兼容——两条路都各有断言，别让哪条悄悄串到另一条。
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  isFreeEngine,
  synthesizeFor,
  ttsCacheTag,
  ttsEngineReady,
  ttsMimeOf,
  ttsOnlineIsDeepseek,
  ttsVoiceFor,
  type TtsRoute,
} from '../src/core/tts-engine';

function route(over: Partial<TtsRoute> = {}): TtsRoute {
  return {
    engine: 'online',
    online: { url: 'https://api.deepseek.com', model: '', apiKey: 'k', format: 'mp3' },
    local: { url: 'http://127.0.0.1:8880', model: 'kokoro', apiKey: '', format: 'mp3' },
    ...over,
  };
}

describe('ttsOnlineIsDeepseek', () => {
  it('官方地址（含空地址）走老接口', () => {
    expect(ttsOnlineIsDeepseek(route())).toBe(true);
    expect(ttsOnlineIsDeepseek(route({ online: { url: '', model: '', apiKey: 'k', format: 'mp3' } }))).toBe(true);
  });

  it('别家地址不算', () => {
    expect(ttsOnlineIsDeepseek(route({ online: { url: 'https://tts.example.com', model: '', apiKey: 'k', format: 'mp3' } }))).toBe(false);
  });
});

describe('ttsCacheTag', () => {
  it('官方语音的键保持原样：老缓存是花过钱的，不能作废', () => {
    expect(ttsCacheTag(route(), 'stella')).toBe('stella');
  });

  it('本地加 local: 前缀，和云端同名音色不串', () => {
    expect(ttsCacheTag(route({ engine: 'local' }), 'stella')).toBe('local:mp3:stella');
  });

  it('兼容服务的键带模型：换模型之后音频不该复用', () => {
    const r = route({
      online: { url: 'https://tts.example.com', model: 'cosyvoice-2', apiKey: 'k', format: 'mp3' },
    });
    expect(ttsCacheTag(r, 'alice')).toBe('online:mp3:cosyvoice-2:alice');
    expect(ttsCacheTag(r, 'alice')).not.toBe(
      ttsCacheTag(route({ online: { ...r.online, model: 'cosyvoice-1' } }), 'alice'),
    );
  });
});

describe('ttsMimeOf', () => {
  it('官方永远 wav，不看设置里的格式', () => {
    expect(ttsMimeOf(route())).toBe('audio/wav');
  });

  it('本地按用户选的格式', () => {
    expect(ttsMimeOf(route({ engine: 'local' }))).toBe('audio/mpeg');
    expect(ttsMimeOf(route({ engine: 'local', local: { ...route().local, format: 'opus' } }))).toBe('audio/ogg');
    expect(ttsMimeOf(route({ engine: 'local', local: { ...route().local, format: 'wav' } }))).toBe('audio/wav');
  });

  it('兼容服务按它自己回格式', () => {
    const r = route({ online: { url: 'https://tts.example.com', model: 'm', apiKey: 'k', format: 'wav' } });
    expect(ttsMimeOf(r)).toBe('audio/wav');
  });
});

describe('ttsEngineReady', () => {
  it('官方要 key，地址可以空（落回官方默认）', () => {
    expect(ttsEngineReady(route({ online: { url: '', model: '', apiKey: '  ', format: 'mp3' } }))).toBe(false);
    expect(ttsEngineReady(route({ online: { url: '', model: '', apiKey: 'k', format: 'mp3' } }))).toBe(true);
  });

  it('兼容服务要地址，key 不强制（内网网关常常不要）', () => {
    expect(
      ttsEngineReady(route({ online: { url: '', model: '', apiKey: '', format: 'mp3' } })),
    ).toBe(false);
    expect(
      ttsEngineReady(route({ online: { url: 'http://192.168.1.9:9000', model: 'm', apiKey: '', format: 'mp3' } })),
    ).toBe(true);
  });

  it('本地要地址，不要 key', () => {
    expect(ttsEngineReady(route({ engine: 'local', local: { url: ' http://127.0.0.1:8880 ', model: '', apiKey: '', format: 'mp3' } }))).toBe(true);
    expect(ttsEngineReady(route({ engine: 'local', local: { url: '', model: '', apiKey: '', format: 'mp3' } }))).toBe(false);
  });

  it('系统语音永远可用', () => {
    expect(ttsEngineReady(route({ engine: 'system' }))).toBe(true);
  });
});

describe('isFreeEngine', () => {
  it('只有本地免费', () => {
    expect(isFreeEngine('local')).toBe(true);
    expect(isFreeEngine('online')).toBe(false);
    expect(isFreeEngine('system')).toBe(false);
  });
});

describe('ttsVoiceFor', () => {
  const prefs = { ttsVoice: 'tide', ttsVoiceLocal: 'zf_xiaobei', ttsVoiceOnline: '' };

  it('官方：空值兜底成 stella，老数据不哑', () => {
    /* 老数据的 tide 由 prefs 迁移搬进 ttsVoiceOnline，这里只做最后一道兜底 */
    expect(ttsVoiceFor(route(), { ...prefs, ttsVoiceOnline: '' })).toBe('tide');
    expect(ttsVoiceFor(route(), { ttsVoice: '', ttsVoiceLocal: '', ttsVoiceOnline: '' })).toBe('stella');
    expect(ttsVoiceFor(route(), { ...prefs, ttsVoiceOnline: 'tide' })).toBe('tide');
  });

  it('兼容服务：用在线那格，空就是服务默认', () => {
    const r = route({ online: { url: 'https://tts.example.com', model: 'm', apiKey: 'k', format: 'mp3' } });
    expect(ttsVoiceFor(r, prefs)).toBe('');
    expect(ttsVoiceFor(r, { ...prefs, ttsVoiceOnline: 'alice' })).toBe('alice');
  });

  it('本地不借在线的音色', () => {
    expect(ttsVoiceFor(route({ engine: 'local' }), prefs)).toBe('zf_xiaobei');
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

  it('在线 · 官方走 fetch 的老接口', async () => {
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

  it('在线 · 兼容服务走 OpenAI 的 /v1/audio/speech，并把模型带上', async () => {
    const urls: string[] = [];
    const bodies: string[] = [];
    const out = await synthesizeFor(
      route({ online: { url: 'https://tts.example.com', model: 'cosyvoice-2', apiKey: 'sk-x', format: 'wav' } }),
      '你好。',
      'alice',
      undefined,
      {
        request: async (req) => {
          urls.push(req.url);
          bodies.push(String(req.body ?? ''));
          return { status: 200, arrayBuffer: new Uint8Array([4]).buffer, text: '' };
        },
      },
    );
    expect(out.mime).toBe('audio/wav');
    expect(urls[0]).toBe('https://tts.example.com/v1/audio/speech');
    expect(bodies[0]).toContain('cosyvoice-2');
    expect(bodies[0]).toContain('alice');
  });

  it('系统语音不该走网络：直接抛，别悄悄换成在线服务花用户的钱', async () => {
    await expect(synthesizeFor(route({ engine: 'system' }), '你好。', 'v', undefined, {})).rejects.toThrow();
  });
});

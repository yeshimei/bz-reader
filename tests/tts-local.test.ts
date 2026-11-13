/* ============================================================
 * bz-reader · 本地 TTS 客户端（2026-11-14）
 *
 * 本地服务五花八门，但绝大多数认 OpenAI 的 `/v1/audio/speech`。
 * 这一层只做纯函数与一次请求：地址怎么拼、body 怎么写、错误怎么分、
 * 一堆 mp3 怎么拼成一个文件。全部能在 node 里断言。
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  concatMp3,
  localBody,
  localEndpoint,
  localErrorCode,
  localVoicesEndpoint,
  parseVoiceList,
  synthesizeLocal,
  type LocalResponse,
} from '../src/core/tts-local';

function bytes(...n: number[]): ArrayBuffer {
  return new Uint8Array(n).buffer;
}

/** 造一个带 ID3v2 头的 mp3 片段：头 10 字节 + size 字节的填充 */
function mp3(payload: number[], pad = 4): ArrayBuffer {
  const out = new Uint8Array(10 + pad + payload.length);
  out.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00], 0); // "ID3" 4.0 flags 0
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = pad; // syncsafe size
  out.set(payload, 10 + pad);
  return out.buffer;
}

describe('localEndpoint', () => {
  it('裸地址补成 /v1/audio/speech', () => {
    expect(localEndpoint('http://127.0.0.1:8880')).toBe('http://127.0.0.1:8880/v1/audio/speech');
  });

  it('已经以 /v1 结尾只补 /audio/speech', () => {
    expect(localEndpoint('http://127.0.0.1:8880/v1')).toBe('http://127.0.0.1:8880/v1/audio/speech');
  });

  it('已经写全的原样用（反代路径不规则时自己填全）', () => {
    expect(localEndpoint('http://192.168.1.9:8080/tts/v1/audio/speech')).toBe(
      'http://192.168.1.9:8080/tts/v1/audio/speech',
    );
  });

  it('去掉结尾斜杠，端口原样保留', () => {
    expect(localEndpoint('  http://127.0.0.1:8880///  ')).toBe('http://127.0.0.1:8880/v1/audio/speech');
  });

  it('空地址返回空串，交给调用方报「没配地址」', () => {
    expect(localEndpoint('')).toBe('');
    expect(localEndpoint(null)).toBe('');
  });
});

describe('localVoicesEndpoint', () => {
  it('跟着根地址走，补 /v1/audio/voices', () => {
    expect(localVoicesEndpoint('http://127.0.0.1:8880')).toBe('http://127.0.0.1:8880/v1/audio/voices');
    expect(localVoicesEndpoint('http://127.0.0.1:8880/v1')).toBe('http://127.0.0.1:8880/v1/audio/voices');
  });
});

describe('localBody', () => {
  it('走 OpenAI 的字段名（input 而不是 text）', () => {
    expect(localBody('你好。', 'zf_xiaobei', 'kokoro', 'mp3')).toEqual({
      model: 'kokoro',
      input: '你好。',
      voice: 'zf_xiaobei',
      response_format: 'mp3',
    });
  });

  it('模型留空就不发 model：有的服务只认自己的默认模型', () => {
    expect(localBody('你好。', 'zf_xiaobei', '  ', 'wav')).not.toHaveProperty('model');
  });

  it('音色留空就不发 voice，让服务用它自己的默认音色', () => {
    expect(localBody('你好。', '  ', 'kokoro', 'mp3')).not.toHaveProperty('voice');
  });
});

describe('localErrorCode', () => {
  it('400 / 404 是配置问题，不是内容被拒', () => {
    expect(localErrorCode(400, '')).toBe('config');
    expect(localErrorCode(404, '')).toBe('config');
  });

  it('401 / 403 是没授权', () => {
    expect(localErrorCode(401, '')).toBe('unauthorized');
  });

  it('429 限流，5xx 忙', () => {
    expect(localErrorCode(429, '')).toBe('rate');
    expect(localErrorCode(500, '')).toBe('busy');
    expect(localErrorCode(503, '')).toBe('busy');
  });

  it('网络层异常（status 0）算 network', () => {
    expect(localErrorCode(0, 'ECONNREFUSED')).toBe('network');
  });
});

describe('parseVoiceList', () => {
  it('认 { voices: [...] }', () => {
    expect(parseVoiceList({ voices: ['af_heart', 'zf_xiaobei'] })).toEqual(['af_heart', 'zf_xiaobei']);
  });

  it('认裸数组', () => {
    expect(parseVoiceList(['alloy', 'echo'])).toEqual(['alloy', 'echo']);
  });

  it('认 [{ id }] / [{ name }]', () => {
    expect(parseVoiceList({ voices: [{ id: 'a' }, { name: 'b' }, { voice: 'c' }] })).toEqual(['a', 'b', 'c']);
  });

  it('去重、去空、去空白', () => {
    expect(parseVoiceList([' a ', 'a', '', null, 3])).toEqual(['a']);
  });

  it('什么都不认识就返回空数组，别抛', () => {
    expect(parseVoiceList(null)).toEqual([]);
    expect(parseVoiceList({ oops: 1 })).toEqual([]);
    expect(parseVoiceList('nope')).toEqual([]);
  });
});

describe('concatMp3', () => {
  it('剥掉每段的 ID3v2 头再拼：中间不能夹着 10 字节垃圾', () => {
    const one = mp3([0xaa, 0xbb], 4);
    const two = mp3([0xcc], 2);
    const out = new Uint8Array(concatMp3([one, two])!);
    expect([...out]).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('本来就没有 ID3 头的原样接上', () => {
    const out = new Uint8Array(concatMp3([bytes(0x11, 0x22), bytes(0x33)])!);
    expect([...out]).toEqual([0x11, 0x22, 0x33]);
  });

  it('没有可拼的东西返回 null', () => {
    expect(concatMp3([])).toBeNull();
    expect(concatMp3([new ArrayBuffer(0)])).toBeNull();
  });
});

describe('synthesizeLocal', () => {
  const ok = (buf: ArrayBuffer): LocalResponse => ({ status: 200, arrayBuffer: buf, text: '' });

  it('POST 到规范化后的端点，带 Authorization（只在填了 key 时）', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const out = await synthesizeLocal({
      baseUrl: 'http://127.0.0.1:8880',
      apiKey: 'k',
      model: 'kokoro',
      text: '你好。',
      voice: 'zf_xiaobei',
      format: 'mp3',
      request: async (req) => {
        seen.push({ url: req.url, headers: req.headers ?? {}, body: String(req.body) });
        return ok(bytes(1, 2, 3));
      },
    });
    expect(seen[0].url).toBe('http://127.0.0.1:8880/v1/audio/speech');
    expect(seen[0].headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(seen[0].body)).toMatchObject({ input: '你好。', voice: 'zf_xiaobei', response_format: 'mp3' });
    expect(new Uint8Array(out)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('没填 key 就不发 Authorization：本地服务多数不认它，发了反而被拒', async () => {
    let auth: string | undefined = 'unset';
    await synthesizeLocal({
      baseUrl: 'http://127.0.0.1:8880',
      apiKey: '   ',
      model: '',
      text: '嗨',
      voice: 'v',
      format: 'wav',
      request: async (req) => {
        auth = req.headers?.Authorization;
        return ok(bytes(9));
      },
    });
    expect(auth).toBeUndefined();
  });

  it('连不上（服务没启动）归到 network，并带上地址', async () => {
    await expect(
      synthesizeLocal({
        baseUrl: 'http://127.0.0.1:8880',
        apiKey: '',
        model: '',
        text: '嗨',
        voice: 'v',
        format: 'mp3',
        request: async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:8880');
        },
      }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('超过时限归到 timeout', async () => {
    await expect(
      synthesizeLocal({
        baseUrl: 'http://127.0.0.1:8880',
        apiKey: '',
        model: '',
        text: '嗨',
        voice: 'v',
        format: 'mp3',
        timeoutMs: 10,
        request: () => new Promise<LocalResponse>(() => undefined),
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('返回空音频算失败，不要拿空 blob 去播', async () => {
    await expect(
      synthesizeLocal({
        baseUrl: 'http://127.0.0.1:8880',
        apiKey: '',
        model: '',
        text: '嗨',
        voice: 'v',
        format: 'mp3',
        request: async () => ok(new ArrayBuffer(0)),
      }),
    ).rejects.toMatchObject({ code: 'empty' });
  });

  it('非 2xx 按状态码分类，并把服务端那句话带进 message', async () => {
    await expect(
      synthesizeLocal({
        baseUrl: 'http://127.0.0.1:8880',
        apiKey: '',
        model: '',
        text: '嗨',
        voice: 'nobody',
        format: 'mp3',
        request: async () => ({ status: 400, arrayBuffer: new ArrayBuffer(0), text: 'voice not found: nobody' }),
      }),
    ).rejects.toMatchObject({ code: 'config', message: 'voice not found: nobody' });
  });

  it('没配地址直接报 config，不用发请求', async () => {
    let called = false;
    await expect(
      synthesizeLocal({
        baseUrl: '   ',
        apiKey: '',
        model: '',
        text: '嗨',
        voice: 'v',
        format: 'mp3',
        request: async () => {
          called = true;
          return ok(bytes(1));
        },
      }),
    ).rejects.toMatchObject({ code: 'config' });
    expect(called).toBe(false);
  });
});

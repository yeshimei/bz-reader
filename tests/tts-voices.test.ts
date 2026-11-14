/* ============================================================
 * bz-reader · 音色属于模型（2026-11-14）
 *
 * 用户原话：「音色是由模型决定的，用户如果换了其他模型，你这个音色对不上。
 * 在线的也是一样的。」所以这里守两件事：
 *   1. 列表缓存按「地址 + 模型」，换任何一头都重新拉；
 *   2. 换完之后旧音色不在新列表里就清空，落回服务默认。
 * 另外守住「拉不到列表就保留原值」——别把人家配好的音色当垃圾清掉。
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import { builtinVoicesOf, reconcileVoice, voiceKeyOf } from '../src/core/tts-voices';
import { ttsProtocolOf } from '../src/core/tts-protocol';

describe('ttsProtocolOf', () => {
  it('空的按官方默认：老用户升级后不填地址也能出声', () => {
    expect(ttsProtocolOf('')).toBe('deepseek');
    expect(ttsProtocolOf('   ')).toBe('deepseek');
    expect(ttsProtocolOf(null)).toBe('deepseek');
  });

  it('官方域名（带不带协议、带不带路径）都算官方', () => {
    expect(ttsProtocolOf('https://api.deepseek.com')).toBe('deepseek');
    expect(ttsProtocolOf('https://api.deepseek.com/v1')).toBe('deepseek');
    expect(ttsProtocolOf('api.deepseek.com')).toBe('deepseek');
  });

  it('其它一律 OpenAI 兼容', () => {
    expect(ttsProtocolOf('http://127.0.0.1:8880')).toBe('openai');
    expect(ttsProtocolOf('https://tts.example.com/v1')).toBe('openai');
    expect(ttsProtocolOf('https://api.deepseek.com.evil.test')).toBe('openai');
  });

  it('写坏的地址不当官方：宁可让兼容那条路报错，也别偷偷把请求发去官方', () => {
    expect(ttsProtocolOf('http://[::1')).toBe('openai');
  });
});

describe('voiceKeyOf', () => {
  it('地址去尾斜杠、大小写不敏感；模型保持原样', () => {
    expect(voiceKeyOf('HTTP://127.0.0.1:8880/', 'Kokoro')).toBe(voiceKeyOf('http://127.0.0.1:8880', 'Kokoro'));
  });

  it('换了模型就换键：缓存自然不命中，不用手写失效', () => {
    expect(voiceKeyOf('http://h:1', 'a')).not.toBe(voiceKeyOf('http://h:1', 'b'));
  });

  it('换了地址也换键', () => {
    expect(voiceKeyOf('http://h:1', 'a')).not.toBe(voiceKeyOf('http://h:2', 'a'));
  });
});

describe('builtinVoicesOf', () => {
  it('只有官方有内置的两把嗓子', () => {
    expect(builtinVoicesOf('https://api.deepseek.com')).toEqual(['stella', 'tide']);
    expect(builtinVoicesOf('')).toEqual(['stella', 'tide']);
    expect(builtinVoicesOf('http://127.0.0.1:8880')).toEqual([]);
  });
});

describe('reconcileVoice', () => {
  it('还在列表里就留着', () => {
    expect(reconcileVoice(['a', 'b'], 'b')).toBe('b');
  });

  it('换了模型、旧音色不在新列表里：清空，落回服务默认', () => {
    expect(reconcileVoice(['x', 'y'], 'b')).toBe('');
  });

  it('拉不到列表：保留用户填的，别替服务判它不认', () => {
    expect(reconcileVoice([], 'b')).toBe('b');
  });

  it('本来就是空的，保持空', () => {
    expect(reconcileVoice(['a'], '')).toBe('');
    expect(reconcileVoice([], '  ')).toBe('');
  });
});

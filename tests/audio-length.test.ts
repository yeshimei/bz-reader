/* ============================================================
 * bz-reader · 音频时长（tests/audio-length.test.ts）
 *
 * 时间轴全靠这一层算，错一位就是整章高亮偏移。这里不碰真实音频文件，
 * 手写帧头字节：mp3 的帧长与时长都是帧头里那几个位的纯函数，能精确断言。
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import { audioDurationMs, mp3DurationMs, wavDurationMs } from '../src/core/audio-length';

/** MPEG1 Layer III / 64 kbps / 44.1 kHz / mono / 无 padding：一帧 208 字节 */
const FRAME = Uint8Array.from([0xff, 0xfb, 0x50, 0xc0]);

/** MPEG2 Layer III / 64 kbps / 22.05 kHz / mono：一帧同样 208 字节 */
const FRAME_V2 = Uint8Array.from([0xff, 0xf3, 0x80, 0xc0]);

function mp3(frames: number, head = FRAME, bodySize = 204): ArrayBuffer {
  const size = frames * (head.length + bodySize);
  const out = new Uint8Array(size);
  for (let i = 0; i < frames; i++) {
    const at = i * (head.length + bodySize);
    out.set(head, at);
  }
  return out.buffer;
}

function withId3(payload: ArrayBuffer, tagSize: number): ArrayBuffer {
  const out = new Uint8Array(10 + tagSize + payload.byteLength);
  out.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, (tagSize >> 21) & 0x7f, (tagSize >> 14) & 0x7f, (tagSize >> 7) & 0x7f, tagSize & 0x7f]);
  out.set(new Uint8Array(payload), 10 + tagSize);
  return out.buffer;
}

function wav(dataBytes: number, sampleRate = 24000, channels = 1, bits = 16): ArrayBuffer {
  const byteRate = (sampleRate * channels * bits) / 8;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, (channels * bits) / 8, true);
  view.setUint16(34, bits, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return out.buffer;
}

describe('mp3 时长', () => {
  it('一帧 26.12ms（1152 样本 / 44.1kHz）', () => {
    expect(mp3DurationMs(mp3(1))).toBe(26);
  });

  it('十帧累加', () => {
    expect(mp3DurationMs(mp3(10))).toBe(261);
  });

  it('MPEG2 的每帧只有 576 样本，时长按 22.05kHz 算', () => {
    expect(mp3DurationMs(mp3(10, FRAME_V2))).toBe(261);
  });

  it('跳过 ID3v2 头，不把头当脏字节', () => {
    expect(mp3DurationMs(withId3(mp3(5), 24))).toBe(131);
  });

  it('空 buffer 给 0', () => {
    expect(mp3DurationMs(new ArrayBuffer(0))).toBe(0);
    expect(mp3DurationMs(new ArrayBuffer(3))).toBe(0);
  });

  it('压根不是 mp3 时给 0，不抛也不死循环', () => {
    expect(mp3DurationMs(new ArrayBuffer(100_000))).toBe(0);
  });

  it('中间夹杂脏字节还能接上后面的帧', () => {
    const clean = new Uint8Array(mp3(3));
    const dirty = new Uint8Array(clean.byteLength + 8);
    dirty.set(clean.subarray(0, 208), 0);
    dirty.set([1, 2, 3, 4, 5, 6, 7, 8], 208);
    dirty.set(clean.subarray(208), 216);
    expect(mp3DurationMs(dirty.buffer)).toBe(78);
  });
});

describe('wav 时长', () => {
  it('按字节率除数据块大小', () => {
    expect(wavDurationMs(wav(48000))).toBe(1000);
    expect(wavDurationMs(wav(24000))).toBe(500);
  });

  it('48kHz 立体声也跟着变', () => {
    expect(wavDurationMs(wav(48000 * 2 * 2, 48000, 2, 16))).toBe(1000);
  });

  it('不是 RIFF 给 0', () => {
    expect(wavDurationMs(new ArrayBuffer(64))).toBe(0);
  });

  it('数据块长度写 0xFFFFFFFF 时按实际剩余字节算', () => {
    const buf = wav(48000);
    new DataView(buf).setUint32(40, 0xffffffff, true);
    expect(wavDurationMs(buf)).toBe(1000);
  });
});

describe('按格式分派', () => {
  it('mp3 / wav 各走各的', () => {
    expect(audioDurationMs(mp3(10), 'mp3')).toBe(261);
    expect(audioDurationMs(wav(48000), 'wav')).toBe(1000);
  });

  it('大小写不敏感', () => {
    expect(audioDurationMs(mp3(10), 'MP3')).toBe(261);
  });

  it('不认识的格式给 0，不瞎猜', () => {
    expect(audioDurationMs(mp3(10), 'ogg')).toBe(0);
    expect(audioDurationMs(new ArrayBuffer(0), 'mp3')).toBe(0);
  });
});

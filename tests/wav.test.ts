import { describe, expect, it } from 'vitest';
import { concatWav, readWav } from '../src/core/wav';

function makeWav(samples: number[], sampleRate = 24000): ArrayBuffer {
  const data = new Uint8Array(samples.length * 2);
  const dv = new DataView(data.buffer);
  samples.forEach((s, i) => dv.setInt16(i * 2, s, true));
  const out = new ArrayBuffer(44 + data.length);
  const v = new DataView(out);
  const bytes = new Uint8Array(out);
  const tag = (o: number, s: string): void => {
    for (let i = 0; i < 4; i++) bytes[o + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + data.length, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, data.length, true);
  bytes.set(data, 44);
  return out;
}

describe('读 WAV', () => {
  it('解析出采样率、声道、位深与 PCM 字节', () => {
    const info = readWav(makeWav([1, 2, 3]));
    expect(info?.sampleRate).toBe(24000);
    expect(info?.channels).toBe(1);
    expect(info?.bits).toBe(16);
    expect(info?.data.byteLength).toBe(6);
  });

  it('不是 RIFF 的字节返回 null', () => {
    expect(readWav(new ArrayBuffer(10))).toBeNull();
    expect(readWav(new Uint8Array(64).buffer)).toBeNull();
  });
});

describe('拼 WAV', () => {
  it('两段拼成一段，PCM 长度相加、头按第一段重写', () => {
    const out = concatWav([makeWav([1, 2]), makeWav([3, 4, 5])]);
    expect(out).not.toBeNull();
    const info = readWav(out!);
    expect(info?.data.byteLength).toBe(10);
    expect(info?.sampleRate).toBe(24000);
    /* RIFF 头里的总长度对得上，不然播放器只播第一段 */
    expect(new DataView(out!).getUint32(4, true)).toBe(36 + 10);
  });

  it('空数组 / 有一段坏掉都返回 null，不产出坏文件', () => {
    expect(concatWav([])).toBeNull();
    expect(concatWav([makeWav([1]), new ArrayBuffer(8)])).toBeNull();
  });
});

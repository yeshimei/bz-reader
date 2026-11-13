/* ============================================================
 * bz-reader · WAV 拼接（core/wav.ts）
 *
 * DeepSeek TTS 返回的是 wav（单声道 24kHz 16-bit）。导出「这一页 / 这一章
 * 的音频」要把多段拼成一个文件，所以需要一个最小 WAV 读写：
 *   · readWav：找 fmt / data 两个 chunk，别的 chunk 一律不管；
 *   · concatWav：沿用第一段的格式，把 PCM 首尾相接，重写 44 字节头。
 *
 * 不做重采样、不做声道合并：拼接的前提是格式一致，格式不一致就按第一段
 * 写头（声音会变调），调用方应保证同一音色的段才拼在一起。
 * ============================================================ */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bits: number;
  data: Uint8Array;
}

function tagOf(view: DataView, off: number): string {
  return String.fromCharCode(view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3));
}

export function readWav(buf: ArrayBuffer): WavInfo | null {
  if (!buf || buf.byteLength < 44) return null;
  const view = new DataView(buf);
  if (tagOf(view, 0) !== 'RIFF' || tagOf(view, 8) !== 'WAVE') return null;
  let fmt: { sampleRate: number; channels: number; bits: number } | null = null;
  let data: Uint8Array | null = null;
  let p = 12;
  while (p + 8 <= buf.byteLength) {
    const id = tagOf(view, p);
    const size = view.getUint32(p + 4, true);
    const body = p + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= buf.byteLength) {
      fmt = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      const end = Math.min(buf.byteLength, body + size);
      data = new Uint8Array(buf, body, Math.max(0, end - body));
    }
    p = body + size + (size % 2);
  }
  if (!fmt || !data) return null;
  return { ...fmt, data };
}

/** 拼接多段 wav；任何一段读不出来就返回 null（宁可不出文件，不出一段坏音频） */
export function concatWav(buffers: readonly ArrayBuffer[]): ArrayBuffer | null {
  if (!buffers.length) return null;
  const parts: WavInfo[] = [];
  for (const buf of buffers) {
    const info = readWav(buf);
    if (!info) return null;
    parts.push(info);
  }
  const first = parts[0];
  const total = parts.reduce((n, p) => n + p.data.byteLength, 0);
  const out = new ArrayBuffer(44 + total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  const tag = (off: number, s: string): void => {
    for (let i = 0; i < 4; i++) bytes[off + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + total, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, first.channels, true);
  view.setUint32(24, first.sampleRate, true);
  const byteRate = first.sampleRate * first.channels * Math.max(1, first.bits / 8);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, first.channels * Math.max(1, first.bits / 8), true);
  view.setUint16(34, first.bits, true);
  tag(36, 'data');
  view.setUint32(40, total, true);
  let off = 44;
  for (const p of parts) {
    bytes.set(p.data, off);
    off += p.data.byteLength;
  }
  return out;
}

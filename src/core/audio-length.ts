/* ============================================================
 * bz-reader · 音频时长（core/audio-length.ts）
 *
 * 离线包的时间轴要求「每句多长」，而这个时长必须和拼进 mp3 的字节严格
 * 同源。三种拿法里选了这个：
 *
 *   1. 服务端回报时长 —— 要改本地服务的接口，DeepSeek 又没有，通用性差；
 *   2. `decodeAudioData` —— 准，但要真解码，几百段要好几秒，还得在
 *      浏览器里跑，node 单测覆盖不到；
 *   3. **数 mp3 帧** —— 纯函数、零依赖、逐帧精确到 26ms，本章就用它。
 *
 * CBR 拼接不重编码，帧边界就是真实时间边界，所以「帧数 × 每帧时长」算
 * 出来的起点和播放器听到的位置是一致的。误差上限是一帧（26ms），一句
 * 话两三秒，肉眼看不出来。
 *
 * 只认 mp3（Layer III）与 wav 两种——本地服务只会给这两类，别的一律 0，
 * 让调用方退回「没有时间轴」，不要瞎猜。
 * ============================================================ */

/** MPEG1 Layer III 比特率表（kbps），下标即帧头里的 bitrate index */
const BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

/** MPEG2 / 2.5 Layer III 比特率表 */
const BR_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

const SR_V1 = [44100, 48000, 32000];
const SR_V2 = [22050, 24000, 16000];
const SR_V25 = [11025, 12000, 8000];

/** 扫不到帧头时最多前移多少字节就放弃 */
const MAX_RESYNC = 8192;

interface Frame {
  /** 整帧字节数 */
  size: number;
  /** 这帧有多少毫秒 */
  ms: number;
}

/**
 * 解析 offset 处的一个 mp3 帧。不是帧头就返回 null。
 *
 * 只处理 Layer III：本地服务与服务端 ffmpeg 都固定输出 mp3，别的层遇到
 * 了也当不认识——宁可算不出时长，也别按错的表算出一个稳定偏的时间轴。
 */
function readFrame(view: DataView, offset: number): Frame | null {
  if (offset + 4 > view.byteLength) return null;
  const b0 = view.getUint8(offset);
  const b1 = view.getUint8(offset + 1);
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 0x03; /* 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=保留 */
  const layerBits = (b1 >> 1) & 0x03; /* 1=Layer III */
  if (versionBits === 1 || layerBits !== 1) return null;

  const b2 = view.getUint8(offset + 2);
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleIndex = (b2 >> 2) & 0x03;
  if (bitrateIndex === 0 || bitrateIndex === 15) return null; /* 自由码率 / 非法 */
  if (sampleIndex === 3) return null;

  const padding = (b2 >> 1) & 0x01;
  const mpeg1 = versionBits === 3;
  const bitrate = (mpeg1 ? BR_V1_L3 : BR_V2_L3)[bitrateIndex] * 1000;
  const sampleRate = (mpeg1 ? SR_V1 : versionBits === 2 ? SR_V2 : SR_V25)[sampleIndex];
  if (!bitrate || !sampleRate) return null;

  const size = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  if (size < 4) return null;
  const samples = mpeg1 ? 1152 : 576;
  return { size, ms: (samples / sampleRate) * 1000 };
}

/** 跳过 ID3v2 头（可能连着好几个） */
function id3End(view: DataView): number {
  let at = 0;
  for (let guard = 0; guard < 4; guard++) {
    if (at + 10 > view.byteLength) return at;
    if (view.getUint8(at) !== 0x49 || view.getUint8(at + 1) !== 0x44 || view.getUint8(at + 2) !== 0x33) return at;
    const size =
      ((view.getUint8(at + 6) & 0x7f) << 21) |
      ((view.getUint8(at + 7) & 0x7f) << 14) |
      ((view.getUint8(at + 8) & 0x7f) << 7) |
      (view.getUint8(at + 9) & 0x7f);
    at += 10 + size;
  }
  return Math.min(at, view.byteLength);
}

/**
 * mp3 有多长（毫秒）。算不出返回 0，不抛。
 *
 * 中途遇到脏字节会前移重找帧头：拼接时剥过 ID3，正常情况下第一帧就对；
 * 但用户拷来别人压的文件也可能夹着 APE 标签，能救就救。
 */
export function mp3DurationMs(buf: ArrayBuffer): number {
  const view = new DataView(buf);
  if (view.byteLength < 4) return 0;
  let at = id3End(view);
  let total = 0;
  let misses = 0;
  while (at + 4 <= view.byteLength) {
    const frame = readFrame(view, at);
    if (frame) {
      total += frame.ms;
      at += frame.size;
      misses = 0;
      continue;
    }
    /* 连续扫不到帧头就停：脏文件和「根本不是 mp3」都按算不出来处理 */
    misses += 1;
    if (misses > MAX_RESYNC) break;
    at += 1;
  }
  return Math.round(total);
}

/**
 * wav 有多长（毫秒）：按 `fmt ` 里的字节率除 `data` 块大小。
 *
 * 不认非 PCM 的编码块——算不准就不算。
 */
export function wavDurationMs(buf: ArrayBuffer): number {
  const view = new DataView(buf);
  if (view.byteLength < 12) return 0;
  /* 'RIFF' .... 'WAVE' */
  if (view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) return 0;
  let at = 12;
  let byteRate = 0;
  let dataSize = -1;
  while (at + 8 <= view.byteLength) {
    const id = view.getUint32(at, false);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 0x666d7420 && size >= 16 && body + 16 <= view.byteLength) {
      byteRate = view.getUint32(body + 8, true);
    } else if (id === 0x64617461) {
      /* 流式 wav 会写 0 或 0xFFFFFFFF，按实际剩余字节算 */
      dataSize = size === 0xffffffff || size === 0 || body + size > view.byteLength
        ? view.byteLength - body
        : size;
      break;
    }
    at = body + size + (size % 2); /* 块按偶数字节对齐 */
  }
  if (byteRate <= 0 || dataSize <= 0) return 0;
  return Math.round((dataSize / byteRate) * 1000);
}

/** 按格式挑算法。不认识的格式返回 0。 */
export function audioDurationMs(buf: ArrayBuffer, format: string): number {
  if (!buf.byteLength) return 0;
  const fmt = String(format ?? '').toLowerCase();
  if (fmt === 'mp3') return mp3DurationMs(buf);
  if (fmt === 'wav') return wavDurationMs(buf);
  return 0;
}

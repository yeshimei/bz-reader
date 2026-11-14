/* ============================================================
 * bz-reader · 本地 TTS 客户端（core/tts-local.ts）
 *
 * 「本地」指用户自己机器上跑着的合成服务，不是插件内置模型。插件仍然只是
 * 客户端：把一句文字 POST 出去，拿回一段音频。和 DeepSeek 是同一条路，
 * 只是地址从 api.deepseek.com 换成了 127.0.0.1。
 *
 * 协议选 OpenAI 的 `/v1/audio/speech`，因为它是本地 TTS 生态的最大公约数
 * （Kokoro-FastAPI / openedai-speech / LocalAI / GPT-SoVITS / CosyVoice /
 * IndexTTS / Fish Speech 都有这一层）。换服务只改地址，不用改插件。
 *
 * 为什么走 `requestUrl` 而不是 fetch：本地服务不会放行 `app://obsidian.md`
 * 这个来源，直接 fetch 会被跨域拦掉；`requestUrl` 走宿主自己的网络栈，
 * 没有这个限制。代价是拿不到 AbortSignal——请求发出去了就收不回来，
 * 我们只能「不等了」。本地合成不要钱，重来一次没有损失。
 *
 * 这个文件不 import obsidian：请求函数由调用方注入，测试里给个假的就能跑。
 * ============================================================ */

import { TtsError, type TtsErrorCode } from './tts-api';

/** 本地服务常见的三种输出。mp3 体积小一个数量级，整章预生成必须用它。 */
export type TtsFormat = 'mp3' | 'wav' | 'opus';

export const TTS_FORMATS: readonly TtsFormat[] = ['mp3', 'wav', 'opus'];

export const LOCAL_MIME: Record<TtsFormat, string> = {
  mp3: 'audio/mpeg',
  /* opus 在容器里是 ogg；写 audio/ogg 比 audio/opus 兼容性好 */
  opus: 'audio/ogg',
  wav: 'audio/wav',
};

export function normalizeFormat(v: unknown): TtsFormat {
  return v === 'wav' || v === 'opus' ? v : 'mp3';
}

/** 首句可能要加载模型，CPU 上等半分钟是常态；给足，但别无限等 */
export const LOCAL_TIMEOUT_MS = 120_000;

function trimBase(baseUrl: string | null | undefined): string {
  return String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * 用户填的根地址 → 合成端点。
 *
 * 三种写法都认：`http://127.0.0.1:8880`、`.../v1`、已经写全的
 * `.../v1/audio/speech`（反代路径不规则的自己填全）。空地址返回空串，
 * 调用方据此报「没配地址」。
 */
export function localEndpoint(baseUrl: string | null | undefined): string {
  const raw = trimBase(baseUrl);
  if (!raw) return '';
  if (/\/audio\/speech$/i.test(raw)) return raw;
  if (/\/v1$/i.test(raw)) return `${raw}/audio/speech`;
  return `${raw}/v1/audio/speech`;
}

/**
 * 音色列表端点。
 *
 * 只有部分服务提供（Kokoro-FastAPI、openedai-speech 有），拉不到就让用户
 * 手填——这件事不该拦住整个功能。
 *
 * 2026-11-14：带上 `?model=`。音色是模型给的（用户原话），同一个服务换模型
 * 之后音色集合可以完全不同；服务不认这个参数会忽略它，认的就能按模型回列表。
 */
export function localVoicesEndpoint(baseUrl: string | null | undefined, model?: string | null): string {
  const raw = trimBase(baseUrl);
  if (!raw) return '';
  const base = /\/audio\/voices$/i.test(raw)
    ? raw
    : /\/audio\/speech$/i.test(raw)
      ? raw.replace(/\/audio\/speech$/i, '/audio/voices')
      : /\/v1$/i.test(raw)
        ? `${raw}/audio/voices`
        : `${raw}/v1/audio/voices`;
  const m = String(model ?? '').trim();
  return m ? `${base}?model=${encodeURIComponent(m)}` : base;
}

/**
 * 探活最多等这么久。
 *
 * 地址误填成一个不通的 IP 时请求会一直挂着不返回：没有这道上限，用户点
 * 「朗读」之后按钮毫无反应，比报错更让人迷惑。3000ms 够本地回环应答，
 * 也不至于让真·离线等太久。
 */
export const LOCAL_PROBE_MS = 3000;

/**
 * 服务在不在。
 *
 * 只发一个 GET 音色列表的轻请求，按「答没答」判活，不看内容对不对：
 * 401/403 也是活着——服务在、只是 key 不对，那种错该由合成时的具体提示
 * 来说；404 说明它不提供音色列表，照样活着。只有 5xx、连不上、超时才算
 * 没起来。
 */
export async function localServiceAlive(input: {
  baseUrl: string | null | undefined;
  request: LocalRequester;
  timeoutMs?: number;
}): Promise<boolean> {
  const url = localVoicesEndpoint(input.baseUrl);
  if (!url) return false;
  const timeoutMs = Math.max(50, input.timeoutMs ?? LOCAL_PROBE_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const res = await Promise.race([input.request({ url, method: 'GET' }), timeout]);
    return res !== null && res.status > 0 && res.status < 500;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 请求体。字段名照 OpenAI：`input` 不是 `text`。
 *
 * 音色留空就不发 `voice`：我们不知道用户装的是哪家服务，猜一个名字只会
 * 得到「音色不存在」；不发则由服务用它自己的默认音色。
 */
export function localBody(
  text: string,
  voice: string,
  model: string,
  format: TtsFormat,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    input: text,
    response_format: format,
  };
  const v = String(voice ?? '').trim();
  if (v) body.voice = v;
  const m = String(model ?? '').trim();
  if (m) body.model = m;
  return body;
}

/**
 * 状态码 → 错误分类。
 *
 * 和 DeepSeek 那套的区别在 400 / 404：云端 400 多是内容审核拒了这段，
 * 本地 400 几乎总是「音色名写错 / 参数不对」，提示要让人去改配置，
 * 而不是以为这段文字有问题。
 */
export function localErrorCode(status: number, body: string): TtsErrorCode {
  const s = Number.isFinite(status) ? status : 0;
  if (s === 0 || s < 0) return 'network';
  if (s === 400 || s === 404 || s === 422) return 'config';
  if (s === 401 || s === 403) return 'unauthorized';
  if (s === 429) return 'rate';
  if (s >= 500) return 'busy';
  void body;
  return 'http';
}

/**
 * 解析音色列表。
 *
 * 各家的形状：`{voices: ["a"]}`、`["a"]`、`{voices: [{id: "a"}]}`、`[{name: "a"}]`。
 * 认不出来就返回空数组——「拉不到音色」不该让设置页报错。
 */
export function parseVoiceList(json: unknown): string[] {
  /* 顶层只认数组或对象：JSON 解析出一个裸字符串说明服务返回的不是列表 */
  if (!json || typeof json !== 'object') return [];
  const pick = (node: unknown): string[] => {
    if (typeof node === 'string') return [node];
    if (Array.isArray(node)) return node.flatMap(pick);
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      for (const key of ['voices', 'data', 'items']) {
        if (key in o) return pick(o[key]);
      }
      for (const key of ['id', 'name', 'voice', 'voice_id']) {
        const v = o[key];
        if (typeof v === 'string') return [v];
      }
    }
    return [];
  };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of pick(json)) {
    const v = String(raw ?? '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * 去掉 ID3v2 头。
 *
 * 每段 mp3 都自带一个 10 字节以上的标签头，直接首尾相接的话，接缝处会
 * 夹着一段「ID3…」垃圾。多数播放器能扛，但有的会在切章时咔一声。
 * 顺手剥掉，拼出来的就是一个干净的单文件。
 */
export function stripId3(buf: ArrayBuffer): ArrayBuffer {
  const view = new Uint8Array(buf);
  if (view.byteLength < 10) return buf;
  if (view[0] !== 0x49 || view[1] !== 0x44 || view[2] !== 0x33) return buf;
  /* 4 字节 syncsafe 长度：每字节只放 7 位 */
  const size = ((view[6] & 0x7f) << 21) | ((view[7] & 0x7f) << 14) | ((view[8] & 0x7f) << 7) | (view[9] & 0x7f);
  const start = 10 + size;
  if (start >= view.byteLength) return new ArrayBuffer(0);
  return buf.slice(start);
}

/** 一段音频在拼好的文件里的字节区间（2026-11-14）。 */
export interface AudioSlice {
  off: number;
  bytes: number;
}

/**
 * 把一堆 mp3 片段拼成一个文件，同时记下每段的字节区间。
 *
 * 区间是**拼的时候量的**，不是事后按码率估的：每段的起点天然是帧头，
 * 直接切出来就是一段合法 mp3。播放时一句一个 blob，不用 seek、不用
 * 猜帧对齐（社区里 TTS 插件都是这个结构）。
 *
 * 空片段保留 `bytes: 0` 的占位，好让区间数组和句子一一对应。
 */
export function concatMp3Slices(
  parts: readonly ArrayBuffer[],
): { data: ArrayBuffer; slices: AudioSlice[] } | null {
  const pieces = parts.map(stripId3);
  const total = pieces.reduce((n, b) => n + b.byteLength, 0);
  if (!total) return null;
  const out = new Uint8Array(total);
  const slices: AudioSlice[] = [];
  let at = 0;
  for (const b of pieces) {
    slices.push({ off: at, bytes: b.byteLength });
    if (b.byteLength) out.set(new Uint8Array(b), at);
    at += b.byteLength;
  }
  return { data: out.buffer, slices };
}

/** 把一堆 mp3 片段拼成一个文件。全空返回 null。 */
export function concatMp3(parts: readonly ArrayBuffer[]): ArrayBuffer | null {
  return concatMp3Slices(parts)?.data ?? null;
}

export interface LocalRequest {
  url: string;
  method: 'POST' | 'GET';
  headers?: Record<string, string>;
  body?: string;
}

/** 只要这几个字段：`requestUrl` 的响应能直接满足 */
export interface LocalResponse {
  status: number;
  arrayBuffer: ArrayBuffer;
  text: string;
}

export type LocalRequester = (req: LocalRequest) => Promise<LocalResponse>;

export interface LocalSynthesisInput {
  baseUrl: string | null | undefined;
  apiKey?: string;
  model?: string;
  text: string;
  voice: string;
  format: TtsFormat;
  request: LocalRequester;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * 合成一句，返回音频字节。失败一律抛 `TtsError`，调用方按 code 说话。
 *
 * `signal` 只是「别等了」：底下的请求收不回来，但结果会被丢掉。
 */
export async function synthesizeLocal(input: LocalSynthesisInput): Promise<ArrayBuffer> {
  const url = localEndpoint(input.baseUrl);
  if (!url) throw new TtsError('config', 0, 'No local speech endpoint configured');

  const text = String(input.text ?? '').trim();
  if (!text) throw new TtsError('empty', 0, 'No readable text');
  if (input.signal?.aborted) throw new TtsError('aborted', 0, 'Cancelled');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = String(input.apiKey ?? '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  /* 下限给 50ms 而不是 1s：测试要跑得快，正常调用方给的是几十秒 */
  const timeoutMs = Math.max(50, input.timeoutMs ?? LOCAL_TIMEOUT_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TtsError('timeout', 0, `Local speech timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    onAbort = (): void => reject(new TtsError('aborted', 0, 'Cancelled'));
    input.signal?.addEventListener('abort', onAbort);
  });

  let res: LocalResponse;
  try {
    res = await Promise.race([
      input.request({
        url,
        method: 'POST',
        headers,
        body: JSON.stringify(localBody(text, input.voice, input.model ?? '', input.format)),
      }),
      timeout,
      aborted,
    ]);
  } catch (e) {
    if (e instanceof TtsError) throw e;
    throw new TtsError('network', 0, `Cannot reach the local speech service: ${(e as Error)?.message || 'network error'}`);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) input.signal?.removeEventListener('abort', onAbort);
  }

  if (res.status < 200 || res.status >= 300) {
    const body = String(res.text ?? '').trim();
    throw new TtsError(
      localErrorCode(res.status, body),
      res.status,
      body || `Local speech service returned ${res.status}`,
    );
  }

  if (!res.arrayBuffer || !res.arrayBuffer.byteLength) {
    throw new TtsError('empty', res.status, 'Local speech service returned empty audio');
  }
  return res.arrayBuffer;
}

/** 拉音色列表。失败返回空数组——调用方退回手填，别报错。 */
export async function fetchLocalVoices(input: {
  baseUrl: string | null | undefined;
  apiKey?: string;
  /** 音色属于模型：带上它，服务才能回这个模型能用的那几个 */
  model?: string;
  request: LocalRequester;
  timeoutMs?: number;
}): Promise<string[]> {
  const url = localVoicesEndpoint(input.baseUrl, input.model);
  if (!url) return [];
  const headers: Record<string, string> = {};
  const key = String(input.apiKey ?? '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = Math.max(50, input.timeoutMs ?? 10_000);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  try {
    const res = await Promise.race([input.request({ url, method: 'GET', headers }), timeout]);
    if (res.status < 200 || res.status >= 300) return [];
    const body = String(res.text ?? '').trim();
    if (!body) return [];
    return parseVoiceList(JSON.parse(body));
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

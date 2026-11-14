/* ============================================================
 * bz-reader · 语音引擎门面（2026-11-14）
 *
 * 朗读有四条出音频的路（正文播放、整章预生成、整页导出、设置页试听），
 * 以前它们各自直接调 DeepSeek。加本地 TTS 之后，「用哪个引擎」这件事
 * 必须只在一处判断——散在四处的话，迟早有一处忘了改，用户就会听到
 * 上一台引擎的声音。
 *
 * 2026-11-14 二轮：在线不再绑死 DeepSeek。地址与密钥由用户填，协议按
 * 地址判定（见 core/tts-protocol）：官方地址走原来的 `/v1/tools/tts`，
 * 其它地址走 OpenAI 兼容的 `/v1/audio/speech`——和本地那套同一个函数。
 * ============================================================ */

import { synthesizeSpeech } from './tts-api';
import { LOCAL_MIME, synthesizeLocal, type LocalRequester, type TtsFormat } from './tts-local';
import { DEEPSEEK_TTS_BASE, ttsProtocolOf } from './tts-protocol';

export type TtsEngine = 'online' | 'system' | 'local';

export interface LocalTtsSettings {
  /** 服务根地址，例如 http://127.0.0.1:8880 */
  url: string;
  model: string;
  /** 多数本地服务不需要；有的加了反向代理才要 */
  apiKey: string;
  format: TtsFormat;
}

/**
 * 在线语音服务（2026-11-14 从 AI 组独立出来）。
 *
 * 以前「在线」直接用 `settings.ai` 的地址与密钥，等于把朗读绑死在 DeepSeek
 * 上：AI 组换个代理，朗读跟着换；想用别家的语音也没地方填。现在自带
 * 地址 / 模型 / 密钥，和 AI 组分道走——两件事的账号未必是同一个。
 */
export interface OnlineTtsSettings {
  url: string;
  model: string;
  apiKey: string;
  format: TtsFormat;
}

export interface TtsRoute {
  engine: TtsEngine;
  online: OnlineTtsSettings;
  local: LocalTtsSettings;
}

export interface TtsDeps {
  fetchImpl?: typeof fetch;
  request?: LocalRequester;
  timeoutMs?: number;
}

export interface TtsResult {
  buf: ArrayBuffer;
  mime: string;
}

/**
 * 缓存键里的音色标签。
 *
 * 三种形状：
 *   · 本机：`local:<格式>:<音色>`，换格式（mp3→wav）之后不会拿旧字节去拼新文件；
 *   · 在线 · 官方：保持原样 `<音色>`。老用户花钱生成的缓存不能作废；
 *   · 在线 · 兼容服务：`online:<格式>:<模型>:<音色>`。音色属于模型，
 *     模型换了音频就不该复用（用户 2026-11-14 的原话）。
 */
export function ttsCacheTag(route: Pick<TtsRoute, 'engine' | 'online' | 'local'>, voice: string): string {
  const v = String(voice ?? '');
  if (route.engine === 'local') return `local:${route.local.format}:${v}`;
  if (route.engine === 'online') {
    if (ttsProtocolOf(route.online.url) === 'deepseek') return v;
    const model = String(route.online.model ?? '').trim();
    return `online:${route.online.format}:${model}:${v}`;
  }
  return v;
}

/** 播放时要告诉 `<audio>` 这是什么格式。官方语音只会给 wav。 */
export function ttsMimeOf(route: Pick<TtsRoute, 'engine' | 'online' | 'local'>): string {
  if (route.engine === 'local') return LOCAL_MIME[route.local.format];
  if (route.engine === 'online' && ttsProtocolOf(route.online.url) === 'openai') {
    return LOCAL_MIME[route.online.format];
  }
  return 'audio/wav';
}

/** 在线引擎是不是走 DeepSeek 官方接口 */
export function ttsOnlineIsDeepseek(route: Pick<TtsRoute, 'online'>): boolean {
  return ttsProtocolOf(route.online.url) === 'deepseek';
}

/**
 * 这个引擎配好了没有（决定点朗读是「开始念」还是「先去设置」）。
 *
 * 在线 · 官方：要有密钥（地址空也能用，落回官方默认）；
 * 在线 · 兼容：要有地址，密钥不强制（局域网/内网网关常常不要）。
 */
export function ttsEngineReady(route: TtsRoute): boolean {
  if (route.engine === 'local') return !!String(route.local.url ?? '').trim();
  if (route.engine === 'online') {
    if (ttsProtocolOf(route.online.url) === 'deepseek') return !!String(route.online.apiKey ?? '').trim();
    return !!String(route.online.url ?? '').trim();
  }
  return true;
}

/** 本地引擎免费：预生成不该问钱，也不该记花费 */
export function isFreeEngine(engine: TtsEngine): boolean {
  return engine === 'local';
}

/** 音色偏好的三份值（阅读页与设置页读的是同一套） */
export interface TtsVoicePrefs {
  ttsVoice: string;
  ttsVoiceLocal: string;
  ttsVoiceOnline: string;
}

/**
 * 当前该用哪把嗓子。
 *
 * 在线 · 官方：只有 stella / tide，空值兜底成老默认 stella；
 * 在线 · 兼容：用户从服务列表里选的那个名字（空 = 服务默认）；
 * 本地：服务里那个名字；系统语音不走音色。
 */
export function ttsVoiceFor(route: TtsRoute, p: TtsVoicePrefs): string {
  if (route.engine === 'local') return p.ttsVoiceLocal;
  if (route.engine === 'online') {
    if (ttsProtocolOf(route.online.url) === 'deepseek') return p.ttsVoiceOnline || p.ttsVoice || 'stella';
    return p.ttsVoiceOnline;
  }
  return p.ttsVoice;
}

/** 在线 · 兼容服务走 OpenAI 那套，和本地共用一个请求函数 */
function onlineBase(route: TtsRoute): string {
  return String(route.online.url ?? '').trim() || DEEPSEEK_TTS_BASE;
}

/**
 * 合成一句。`engine === 'system'` 不该走到这里（系统语音不走网络），
 * 真的走到了就报 config，别悄悄换成在线服务花用户的钱。
 */
export async function synthesizeFor(
  route: TtsRoute,
  text: string,
  voice: string,
  signal: AbortSignal | undefined,
  deps: TtsDeps,
): Promise<TtsResult> {
  if (route.engine === 'local') {
    if (!deps.request) throw new Error('local TTS request channel missing');
    const buf = await synthesizeLocal({
      baseUrl: route.local.url,
      apiKey: route.local.apiKey,
      model: route.local.model,
      text,
      voice,
      format: route.local.format,
      request: deps.request,
      signal,
      ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
    });
    return { buf, mime: LOCAL_MIME[route.local.format] };
  }
  if (route.engine === 'online') {
    if (ttsProtocolOf(route.online.url) === 'deepseek') {
      const buf = await synthesizeSpeech({
        baseUrl: onlineBase(route),
        apiKey: route.online.apiKey,
        text,
        voice,
        signal,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
      });
      return { buf, mime: 'audio/wav' };
    }
    if (!deps.request) throw new Error('online TTS request channel missing');
    const buf = await synthesizeLocal({
      baseUrl: route.online.url,
      apiKey: route.online.apiKey,
      model: route.online.model,
      text,
      voice,
      format: route.online.format,
      request: deps.request,
      signal,
      ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
    });
    return { buf, mime: LOCAL_MIME[route.online.format] };
  }
  throw new Error('system speech does not go through the network');
}

/* ============================================================
 * bz-reader · 语音引擎门面（2026-11-14）
 *
 * 朗读有四条出音频的路（正文播放、整章预生成、整页导出、设置页试听），
 * 以前它们各自直接调 DeepSeek。加本地 TTS 之后，「用哪个引擎」这件事
 * 必须只在一处判断——散在四处的话，迟早有一处忘了改，用户就会听到
 * 上一台引擎的声音。
 * ============================================================ */

import { synthesizeSpeech, type TtsVoice } from './tts-api';
import { LOCAL_MIME, synthesizeLocal, type LocalRequester, type TtsFormat } from './tts-local';

export type TtsEngine = 'deepseek' | 'system' | 'local';

export interface LocalTtsSettings {
  /** 服务根地址，例如 http://127.0.0.1:8880 */
  url: string;
  model: string;
  /** 多数本地服务不需要；有的加了反向代理才要 */
  apiKey: string;
  format: TtsFormat;
}

export interface TtsRoute {
  engine: TtsEngine;
  ai: { baseUrl: string; apiKey: string };
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
 * DeepSeek 保持原样（`stella`）：老用户已经花钱生成的缓存不能作废。
 * 本地加 `local:<格式>:<音色>`：两套引擎互不串音，换格式（mp3→wav）之后
 * 也不会拿旧格式的字节去拼新文件。
 */
export function ttsCacheTag(engine: TtsEngine, voice: string, format?: TtsFormat): string {
  if (engine !== 'local') return voice;
  return format ? `local:${format}:${voice}` : `local:${voice}`;
}

/** 播放时要告诉 `<audio>` 这是什么格式。DeepSeek 只会给 wav。 */
export function ttsMimeOf(engine: TtsEngine, format: TtsFormat): string {
  return engine === 'local' ? LOCAL_MIME[format] : 'audio/wav';
}

/** 这个引擎配好了没有（决定点朗读是「开始念」还是「先去设置」） */
export function ttsEngineReady(route: TtsRoute): boolean {
  if (route.engine === 'local') return !!String(route.local.url ?? '').trim();
  if (route.engine === 'deepseek') return !!String(route.ai.apiKey ?? '').trim();
  return true;
}

/** 本地引擎免费：预生成不该问钱，也不该记花费 */
export function isFreeEngine(engine: TtsEngine): boolean {
  return engine === 'local';
}

/**
 * 合成一句。`engine === 'system'` 不该走到这里（系统语音不走网络），
 * 真的走到了就报 config，别悄悄换成 DeepSeek 花用户的钱。
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
  if (route.engine === 'deepseek') {
    const buf = await synthesizeSpeech({
      baseUrl: route.ai.baseUrl,
      apiKey: route.ai.apiKey,
      text,
      voice: voice as TtsVoice,
      signal,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
    });
    return { buf, mime: 'audio/wav' };
  }
  throw new Error('system speech does not go through the network');
}

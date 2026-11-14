/* ============================================================
 * bz-reader · 在线语音的两种接口（core/tts-protocol.ts）
 *
 * 「在线」不再等于 DeepSeek：用户填什么地址都能用。但两家的请求形状不同——
 *   · DeepSeek 官方：`POST {base}/v1/tools/tts`，body 是 text/voice_id，
 *     只有两把嗓子（stella / tide），只会回 wav；
 *   · 其它服务：OpenAI 兼容的 `POST {base}/v1/audio/speech`，带 model，
 *     格式可选，音色由服务自己列。
 *
 * 界面上不出现「协议」这一项：地址是 api.deepseek.com 就走官方那套，
 * 其余一律按 OpenAI 兼容。判定只此一处，免得设置页、播放、预生成各判一遍。
 * 空地址 = 还没填，按官方默认处理（老用户升级后不填地址也能出声）。
 * ============================================================ */

/** DeepSeek 官方地址：空地址时的默认落点 */
export const DEEPSEEK_TTS_BASE = 'https://api.deepseek.com';

export type TtsProtocol = 'deepseek' | 'openai';

/**
 * 地址 → 接口协议。
 *
 * 只认主机名，不认路径：用户可能写 `api.deepseek.com`、
 * `https://api.deepseek.com/v1`、代理到别处的同域地址。写坏的字符串按
 * 「不是官方」处理，让 OpenAI 兼容那条路去报错，别悄悄把请求发去 DeepSeek。
 */
export function ttsProtocolOf(url: string | null | undefined): TtsProtocol {
  const raw = String(url ?? '').trim();
  if (!raw) return 'deepseek';
  let host = raw.toLowerCase();
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    host = parsed.hostname.toLowerCase();
  } catch {
    /* 不是合法 URL：退回按字符串判，命中不了官方域名就当兼容服务 */
  }
  return host === 'api.deepseek.com' || host.endsWith('.deepseek.com') ? 'deepseek' : 'openai';
}

export function isDeepseekTtsUrl(url: string | null | undefined): boolean {
  return ttsProtocolOf(url) === 'deepseek';
}

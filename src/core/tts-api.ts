/* ============================================================
 * bz-reader · DeepSeek 语音合成（core/tts-api.ts）
 *
 * 只做一件事：把一段文字换成一段 wav 字节。播放、缓存、角色编排都不在
 * 这里——那几层换掉实现时（例如以后换服务商）不该动这个文件。
 *
 * 2026-11-13 实测：`Origin: app://obsidian.md` 被服务端原样放行，所以
 * 插件里可以直接 fetch，AbortSignal 与超时都能用（requestUrl 不支持取消）。
 * ============================================================ */

/**
 * DeepSeek 的两把嗓子。
 *
 * 2026-11-14 本地 TTS 接进来之后，音色不再只有这两个：本地服务动辄几十个
 * 音色名（`zf_xiaobei` / `af_heart` …）。所以对外用 `TtsVoice`，这一个
 * 联合类型只用来给 DeepSeek 留自动补全。
 */
export type DeepseekVoice = 'stella' | 'tide';

/** 任意引擎的音色名。`string & {}` 保留字面量补全，又接受任意字符串。 */
export type TtsVoice = DeepseekVoice | (string & {});

/** 音色 id；显示名在设置页走 t()，这里不放中文（硬编码文案检查） */
export const TTS_VOICE_IDS: readonly DeepseekVoice[] = ['stella', 'tide'];

export function isDeepseekVoice(v: unknown): v is DeepseekVoice {
  return v === 'stella' || v === 'tide';
}

export type TtsErrorCode =
  | 'unauthorized'
  | 'rejected'
  /**
   * 配置不对：地址为空、端点 404、音色名服务不认（2026-11-14 本地服务）。
   *
   * 和 `rejected` 分开：那条说的是「这段文字被审核拒了，跳过它继续念」，
   * 这条要停下来让人去改设置——继续念只会一路失败。
   */
  | 'config'
  | 'rate'
  | 'busy'
  | 'network'
  | 'timeout'
  | 'http'
  | 'empty'
  | 'aborted';

export class TtsError extends Error {
  readonly code: TtsErrorCode;
  readonly status: number;
  constructor(code: TtsErrorCode, status: number, message: string) {
    super(message);
    this.name = 'TtsError';
    this.code = code;
    this.status = status;
  }
}

/** 合成一段最多等多久。整段 wav 要等服务端生成完，比聊天接口给得宽。 */
export const TTS_TIMEOUT_MS = 60_000;

const DEFAULT_BASE = 'https://api.deepseek.com';

/**
 * AI 设置里的根地址 → TTS 端点。
 *
 * 用户填的可能是 `https://api.deepseek.com`、`.../v1`，也可能是自建代理。
 * 规则只有两条：已经以 `/v1` 结尾就只补 `/tools/tts`，否则补 `/v1/tools/tts`。
 * 已经填到 `/tools/tts` 的原样用（代理路径不规则的自己填全）。
 */
export function ttsEndpoint(baseUrl: string | null | undefined): string {
  const raw = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!raw) return `${DEFAULT_BASE}/v1/tools/tts`;
  if (/\/tools\/tts$/i.test(raw)) return raw;
  if (/\/v1$/i.test(raw)) return `${raw}/tools/tts`;
  return `${raw}/v1/tools/tts`;
}

export interface TtsBody {
  text: string;
  voice_id: TtsVoice;
  format: 'wav';
  filter_markdown: boolean;
}

export function ttsBody(text: string, voice: TtsVoice): TtsBody {
  return { text, voice_id: voice, format: 'wav', filter_markdown: false };
}

/** HTTP 状态码 + 响应体 → 给人看的错误分类（文案在视图层翻） */
export function ttsErrorCode(status: number, _body: string): TtsErrorCode {
  if (status === 400) return 'rejected';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate';
  if (status === 503 || status === 504) return 'busy';
  return 'http';
}

export interface SynthesizeInput {
  baseUrl?: string | null;
  apiKey: string;
  text: string;
  voice: TtsVoice;
  signal?: AbortSignal;
  /** 测试注入；默认用 window.fetch */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * 合成一段文字，返回 wav 字节。
 *
 * 失败一律抛 `TtsError`：调用方按 code 决定「跳过 / 重试 / 提示」，
 * 不要从 message 里猜。
 */
export async function synthesizeSpeech(input: SynthesizeInput): Promise<ArrayBuffer> {
  const text = String(input.text ?? '').trim();
  if (!text) throw new TtsError('empty', 0, 'No readable text');
  if (!input.apiKey.trim()) throw new TtsError('unauthorized', 401, 'No API key configured');

  const fetchImpl = input.fetchImpl ?? window.fetch.bind(window);
  const timeoutMs = Math.max(5_000, input.timeoutMs ?? TTS_TIMEOUT_MS);
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = (): void => ctrl.abort();
  input.signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetchImpl(ttsEndpoint(input.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey.trim()}`,
      },
      body: JSON.stringify(ttsBody(text, input.voice)),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (input.signal?.aborted) throw new TtsError('aborted', 0, 'Cancelled');
    if (timedOut || (e as Error)?.name === 'AbortError') {
      throw new TtsError('timeout', 0, `Speech API timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new TtsError('network', 0, `Cannot reach the speech API: ${(e as Error)?.message || 'network error'}`);
  } finally {
    window.clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }

  if (!res.ok) {
    /* 400 的响应体里往往有一句人话（审核命中 / 没有可读文本），
       留着给界面上报错；其余状态码只需要分类。 */
    const body = await res.text().catch(() => '');
    throw new TtsError(ttsErrorCode(res.status, body), res.status, body.trim() || `Speech API returned ${res.status}`);
  }

  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new TtsError('empty', res.status, 'Speech API returned empty audio');
  return buf;
}

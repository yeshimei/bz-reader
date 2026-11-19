/* ============================================================
 * bz-reader · 请求协议适配（data/ai-protocol.ts）
 *
 * 自定义通道支持两套报文：OpenAI 兼容 /chat/completions 与 Anthropic
 * Messages /messages。差异全收在这几个纯函数里（URL、鉴权头、报文、
 * 正文提取、SSE 增量），超时 / 中止 / 流式读取沿用 data/ai 的既有实现，
 * 不复制那几十行状态机。
 * ============================================================ */
import { t } from '../i18n';
import type { AIProtocol } from './ai-providers';
import { drainSse } from './ai-sse';

export interface ChatRequestConfig {
  endpoint: string;
  apiKey: string;
  protocol: AIProtocol;
  model: string;
  maxTokens?: number;
  thinkingBody?: Record<string, unknown> | null;
}

export interface ChatRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ChatRequestBodyOptions {
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
}

/** Anthropic 只接受这几个可选参数（其余字段服务端会以 400 拒绝） */
const ANTHROPIC_PASSTHROUGH = ['temperature', 'top_p', 'top_k'] as const;

/** unknown → 记录（只认非数组的对象）；外部 JSON 都从这里收窄 */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 中立 messages → Anthropic Messages 报文：system 抽到顶层、role 收敛 */
function toAnthropicBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { model: body.model, stream: !!body.stream };
  if (typeof body.max_tokens === 'number') out.max_tokens = body.max_tokens;
  const sys: string[] = [];
  const list: Array<{ role: string; content: unknown }> = [];
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  for (const raw of msgs) {
    const msg = asRecord(raw);
    if (!msg) continue;
    if (msg.role === 'system') {
      if (typeof msg.content === 'string' && msg.content) sys.push(msg.content);
      continue;
    }
    list.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    });
  }
  out.messages = list.length ? list : [{ role: 'user', content: '' }];
  if (sys.length) out.system = sys.join('\n\n');
  for (const k of ANTHROPIC_PASSTHROUGH) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

/** 构造一条对话请求（不含超时与 signal，那些由调用层管） */
export function buildChatRequest(
  config: ChatRequestConfig,
  messages: ReadonlyArray<{ role: string; content: unknown }>,
  opts: ChatRequestBodyOptions = {},
): ChatRequest {
  const anthropic = config.protocol === 'anthropic';
  const maxTokens = opts.maxTokens ?? config.maxTokens;
  const base: Record<string, unknown> = {
    model: config.model,
    temperature: opts.temperature ?? 0.3,
    messages,
  };
  if (opts.stream) base.stream = true;
  if (maxTokens) base.max_tokens = maxTokens;
  /* 思考参数只有 OpenAI 兼容面认；Anthropic 的 extended thinking 要与
     max_tokens 联动折算，本版不注入。 */
  if (!anthropic && config.thinkingBody) Object.assign(base, config.thinkingBody);

  const endpoint = String(config.endpoint || '').replace(/\/+$/, '');
  return anthropic
    ? {
        url: `${endpoint}/messages`,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: toAnthropicBody(base),
      }
    : {
        url: `${endpoint}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: base,
      };
}

/** 从一条完整回复里取正文（兼容层可能回数组分段） */
export function chatTextOf(protocol: AIProtocol, data: unknown): string {
  const obj = asRecord(data);
  if (protocol === 'anthropic') {
    const arr = Array.isArray(obj?.content) ? obj.content : [];
    let out = '';
    for (const raw of arr) {
      const part = asRecord(raw);
      if (part?.type === 'text' && typeof part.text === 'string') out += part.text;
    }
    return out.trim();
  }
  const choices = Array.isArray(obj?.choices) ? obj.choices : [];
  const message = asRecord(asRecord(choices[0])?.message);
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    let out = '';
    for (const raw of content) {
      const part = asRecord(raw);
      if (part && typeof part.text === 'string') out += part.text;
    }
    return out.trim();
  }
  return '';
}

/** 一条 SSE 帧的切分结果 */
export interface ProtocolDrain {
  deltas: string[];
  done: boolean;
  rest: string;
  error?: string;
}

/**
 * 按协议切一帧。OpenAI 走 data/ai-sse 的既有实现（[DONE] 哨兵）；Anthropic
 * 是事件型 SSE（content_block_delta 出字、message_stop 结束、error 报错）。
 */
export function drainChatSse(protocol: AIProtocol, buffer: string): ProtocolDrain {
  if (protocol === 'openai') {
    const out = drainSse(buffer);
    return { deltas: out.deltas, done: out.done, rest: out.rest };
  }
  const text = String(buffer ?? '').replace(/\r\n/g, '\n');
  const deltas: string[] = [];
  let done = false;
  let error: string | undefined;
  let rest = text;
  for (;;) {
    const cut = rest.indexOf('\n\n');
    if (cut < 0) break;
    const frame = rest.slice(0, cut);
    rest = rest.slice(cut + 2);
    let event = '';
    let payload = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) payload += line.slice(5).trim();
    }
    if (!payload) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload) as unknown;
    } catch {
      continue; // 心跳 / 截断帧：丢掉比整条回答判失败有用
    }
    const chunk = asRecord(parsed);
    if (!chunk) continue;
    if (event === 'error' || chunk.type === 'error') {
      const errMsg = asRecord(chunk.error)?.message;
      error = typeof errMsg === 'string' ? errMsg : t('notice.ai.unknownError');
      continue;
    }
    if (event === 'message_stop' || chunk.type === 'message_stop') {
      done = true;
      continue;
    }
    const delta = asRecord(chunk.delta);
    if (
      (event === 'content_block_delta' || chunk.type === 'content_block_delta') &&
      delta?.type === 'text_delta' &&
      typeof delta.text === 'string'
    ) {
      deltas.push(delta.text);
    }
  }
  return { deltas, done, rest, error };
}

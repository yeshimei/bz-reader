/* ============================================================
 * bz-reader · AI 调用层（data/ai.ts）
 *
 * 只做一件事：把 OpenAI 兼容接口的一问一答包成 `aiAsk(input)`。
 *
 * 流式是**可选**的（2026-11-16 起问答走流式）：调用方给 `onDelta` 就开流，
 * 不给就还是原来的一次性读完——识别、补元数据这类短任务不需要边出边画，
 * 多一层状态反而容易出错。切帧在 data/ai-sse，这里只管发请求与收字。
 *
 * 无 key 不静默失败：ready() 为 false 时上层给出配置引导，
 * 用户应该被带到设置页，而不是看着按钮点了没反应。
 * ============================================================ */
import type { ReaderSettings } from './settings';
import { AI_EVIDENCE_LIMIT } from './ai-budget';
import { buildEnrichMessages } from './book-enrich';
import { buildGuideMessages } from './chapter-guide';
import { debugEvent } from './debug-log';
import { buildChatRequest, chatTextOf, drainChatSse } from './ai-protocol';
import { aiReadyOf, resolveAiConfig, type AIProtocol } from './ai-providers';
import { ensureSharedAi } from './ai-share';

export type AiTask =
  | 'summarize'
  | 'explain'
  | 'translate'
  | 'ask'
  | 'follow'
  | 'enrich'
  | 'guide';

/**
 * 追问时原文最多带多少字。
 *
 * 2000 字约 1.3k token：足够模型看清这一段的上下文，又不至于每次追问
 * 都把一整章塞进去。划词通常几十到几百字，这个上限只在选中整页时才碰到。
 */
export const FOLLOW_QUOTE_LIMIT = 2000;

/** 追问时同书其他段落的上限：够接上前因后果，又不至于把「问这一小段」变成「问全书」 */
export const FOLLOW_EVIDENCE_LIMIT = 1200;

/**
 * 「当前这一屏」带多少正文。
 *
 * 6000 字约 4k token：够模型看懂这一页在讲什么，又不至于每次提问都
 * 烧掉一大截额度。epub 的一「屏」通常 800–1200 字，留了五倍余量。
 *
 * 注意：这是**没有检索依据**时的兜底口径（取末尾，因为用户读到哪儿哪儿重要）。
 * 全书依据走 `AI_EVIDENCE_LIMIT`，并且取开头（检索已按相关度排好序）。
 */
export const ASK_CONTEXT_LIMIT = 6000;

/** 多轮只带最近 6 条（3 轮）：再往前的内容与当前问题关系已经很小 */
export const ASK_HISTORY_MAX = 6;

export interface AiTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiAskInput {
  task: AiTask;
  /** 划选的原文，或用户提的问题 */
  text: string;
  /** 书名（问答的 system 里用来指代「这本书」） */
  title?: string;
  /** 作者（只有补元数据用：书名 + 作者 + 片段） */
  author?: string;
  /** 当前章节名 */
  chapter?: string;
  /** 补元数据时：现有书架分类名册，归类优先复用其中的名字 */
  shelfNames?: readonly string[];
  /** 当前这一屏的正文（只有 ask 用；不传就明说没有正文） */
  context?: string;
  /**
   * 同书其他相关段落（只有 follow 用）。
   *
   * 追问原来只带读者眼前那一段：问「他后来为什么变了」，模型只看得到
   * 这一屏，只能靠猜。补一次书内检索，把前后文接上——但仍然是「问这一小段」，
   * 不塞整本书，篇幅按 FOLLOW_EVIDENCE_LIMIT 收口。
   */
  evidence?: string;
  /** 之前的问答，按时间正序 */
  history?: AiTurn[];
  /**
   * 已经拼好的这一问（侧栏 A 版的【上下文】+【问题】）。
   *
   * 用户插了划线 / 正文 / 截图 / 笔记时，由 shell/ai-context.ts 统一拼；
   * 有它就原样作为最后一条 user，不再套一层【问题】，避免出现两个标题。
   */
  userPrompt?: string;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function isMostlyChinese(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk / Math.max(1, text.length) > 0.15;
}

/**
 * 正文压缩到上限以内。
 *
 * 取**末尾**而不是开头：用户是「读到这儿」才问的，问题指向的通常是
 * 刚刚读完的这几段。保留开头等于把最相关的部分先扔了。
 */
export function clipContext(text: string, limit = ASK_CONTEXT_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return '…' + flat.slice(flat.length - limit);
}

/**
 * 检索依据压缩到上限以内：**留开头**。
 *
 * 依据是按相关度排好序的，最相关的那块在最前；切末尾等于先把最相关的
 * 扔掉、留下最不相关的。这与「当前屏」的 `clipContext` 是两个方向，
 * 不能共用一个函数——以前共用，全书依据的头（含全书总述）就是这样没的。
 */
export function clipHead(text: string, limit = AI_EVIDENCE_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, Math.max(0, limit - 1))}…`;
}

/** 摘录 / 解释 / 翻译的老口径，一字不改（回归测试锁着） */
function buildPrompt(task: Exclude<AiTask, 'ask' | 'follow' | 'enrich' | 'guide'>, text: string): string {
  if (task === 'summarize') {
    return `请把下面这段文字压缩成不超过 100 字的摘要，直接给摘要正文，不要任何开场白或前缀：\n\n${text}`;
  }
  if (task === 'explain') {
    return `请解释下面这段划线内容里的关键名词或概念（用中文，不超过 120 字，直接给解释正文）。如果整段没有专门名词，就概括它在说什么：\n\n${text}`;
  }
  // 翻译方向按内容定：中文书翻出去，外文书翻回来，不问第二遍
  const dir = isMostlyChinese(text) ? 'en' : 'zh';
  return dir === 'en'
    ? `Translate the following text into natural English. Reply with the translation only:\n\n${text}`
    : `把下面的文字翻译成流畅的中文，只给译文，不要注释：\n\n${text}`;
}

/**
 * 追问：围绕划词的那一段继续聊。
 *
 * 与 ask 的区别是依据的来源——ask 允许用「书里的块」冒充依据并严格要求
 * 「书里没有就说没有」，follow 的原文就是用户眼前这一段，允许模型补充
 * 书外知识，但必须说明哪些是补充。少了这条说明，用户会把模型的发挥
 * 当成书里的观点。
 *
 * 原文放 system 而不是 user：它在整场对话里是常量，逐轮重发只会多烧
 * token；模型仍能从 system 里看到「我们在聊哪一段」。
 */
function buildFollowMessages(input: AiAskInput): AiMessage[] {
  const quote = clipContext(input.context ?? '', FOLLOW_QUOTE_LIMIT);
  const extra = clipHead(String(input.evidence ?? '').trim(), FOLLOW_EVIDENCE_LIMIT);
  /* 2026-11-11 真机反馈：追问的回答动辄一整屏，手机上一段分析要翻两屏才看完。
     追问是「接着聊」，不是「再写一篇」——所以把长度写成硬约束，并明确
     「读者要求展开」才放长，免得模型把简练当成不许解释。
     2026-11-16：带上同书其他段落时补一条约束——别处的说法不能安到眼前这段上。 */
  const system = quote
    ? `你是读者的共读助手。下面这段是读者正在读的原文。回答读者关于它的问题；可以用书外的知识补充，但要说明哪些是补充。用中文，先给结论，不寒暄。回答要短：通常三到五句、100 字以内，不复述原文，不要长清单；只有读者明确要求「详细说说」时才展开。${
        extra
          ? '另外还给了一些同书其他段落（标了章名）：可以据此说明前因后果，引用时点明章名，不要把别处的说法安到这段原文上。'
          : ''
      }`
    : '你是读者的共读助手。这次没有原文，只能凭问题本身作答，回答前先说明这一点。用中文，三到五句以内，不寒暄。';

  const messages: AiMessage[] = [{ role: 'system', content: system }];
  if (quote) messages.push({ role: 'system', content: `【原文】\n${quote}` });
  /* 同书其他段落（2026-11-16）：检索到的前后文，带章名。
     与【原文】分开两段，模型才不会把别处的话当成读者眼前这一句。 */
  if (extra) messages.push({ role: 'system', content: `【同书其他段落】\n${extra}` });
  for (const turn of (input.history ?? []).slice(-ASK_HISTORY_MAX)) {
    if (turn.content.trim()) messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: `【问题】\n${input.text}` });
  return messages;
}

/**
 * 拼出要发给模型的 messages。
 *
 * ask 与其余三个任务的区别不只是 prompt：它带 system（角色与边界）、
 * 带正文、带多轮历史。以前「问这本书」直接复用 explain 的 prompt，
 * 用户问「讲了什么」会被当成一段要解释的名词。
 */
export function buildMessages(input: AiAskInput): AiMessage[] {
  if (input.task === 'follow') return buildFollowMessages(input);
  if (input.task === 'enrich') {
    /* 补元数据：书名 + 作者 + 画像里的一段样本。格式约定在 book-enrich 里，
       这里只把三个字段递过去（两边各守一半，测试也各测一半）。 */
    return buildEnrichMessages({
      title: input.title ?? '',
      author: input.author,
      sample: input.context,
      shelfNames: input.shelfNames,
    });
  }
  if (input.task === 'guide') {
    /* 本章导读：章名 + 书名 + （可选）这一章的摘要。prompt 在 chapter-guide 里，
       与补元数据同一套分工（数据层守格式，调用层只递字段）。 */
    return buildGuideMessages({
      chapter: input.chapter ?? '',
      book: input.title,
      digest: input.context,
    });
  }
  if (input.task !== 'ask') {
    return [{ role: 'user', content: buildPrompt(input.task, input.text) }];
  }

  const book = input.title?.trim() || '这本书';
  const chapter = input.chapter?.trim();
  /* 依据是检索结果，已按相关度排序：留开头，别用「当前屏」的取末尾口径 */
  const ctx = clipHead(input.context ?? '');
  /* 依据里带【全书目录】= 这次走的是「目录打底 + 整章读」那条路（data/book-map）。
     这时「没读到」和「书里没有」是两件事：不分开说，模型会拿目录之外的
     印象补一段，读者也看不出哪句是猜的。 */
  const mapped = /【全书目录】/.test(ctx);

  const system = ctx
    ? `你是《${book}》的共读助手。只根据下面提供的依据回答；依据里没有的，直接说「书里没有提到」，不要用书外的知识补充。用中文，先给结论再给依据，不要寒暄。${
        chapter ? `当前章节：${chapter}。` : ''
      }引用原文时用「」把原句括起来并注明章节，原句必须从依据里逐字复制、不超过 40 字；没有原句支撑的结论，不要写成书里的观点。${
        mapped
          ? '这次依据以【全书目录】打底：先按目录定位，再读【重点章节】的原文。只能说到目录与重点章节覆盖的范围；没读到的章说「这一章本次没有展开」，不要说「书里没有」。'
          : ''
      }`
    : `你是《${book}》的共读助手。但这次没有取到可用的依据，只能凭问题本身作答，回答前先说明这一点。用中文，简洁。`;

  const messages: AiMessage[] = [{ role: 'system', content: system }];
  for (const turn of (input.history ?? []).slice(-ASK_HISTORY_MAX)) {
    if (turn.content.trim()) messages.push({ role: turn.role, content: turn.content });
  }
  const user = input.userPrompt?.trim()
    ? input.userPrompt
    : `【问题】\n${input.text}`;
  messages.push({
    role: 'user',
    content: ctx ? `【依据】\n${ctx}\n\n${user}` : user,
  });
  return messages;
}

export interface AiResult {
  text: string;
}

/* ─────────── 嵌入到哪去了 ───────────
 *
 * 2026-11-07：书的向量改由第二大脑（bz）算，这里不再有 /embeddings 这条路。
 * 借能力的入口是 data/bz-bridge 的 bzEmbedder（门面 + 模型名），建索引在
 * data/portrait-build，检索在 data/book-ai。
 *
 * 删掉的不只是几个函数：自建嵌入要用户自己填模型名，填得和 bz 不一致时
 * 两边向量不在一个空间，检索会**静默**给错结果。这条路留着就是留个坑。
 */

/** 一次 AI 请求最多等多久。接口地址填错 / 代理挂掉时，不设上限就是一直转圈。 */
export const AI_TIMEOUT_MS = 60_000;

/**
 * 全书 / 多书问答的超时。
 *
 * 这两档一次要带 6–8 块原文（约 6000–8000 字）当依据。真机实测：
 * 本地 14B（q4，12GB 显存）带 4800 字要 77 秒，带 7000 字超过 180 秒还在算——
 * 慢模型上宁可多等，也不要把正确答案掐成一句「接口没有响应」。
 *
 * 这只是上限：云端模型十几秒就返回，不会等满；等不下去的人有取消按钮。
 * 划词解释 / 翻译 / 摘要的输入很短，仍用 60 秒，不该让挂掉的接口拖五分钟。
 */
export const AI_ASK_TIMEOUT_MS = 300_000;

/** 这个任务该等多久（纯函数，测试直接锁） */
export function askTimeoutMs(task: AiTask): number {
  return task === 'ask' ? AI_ASK_TIMEOUT_MS : AI_TIMEOUT_MS;
}

export interface AiAskOptions {
  /** 外部取消（弹层里的「取消请求」）。超时与取消是两条路，提示要分开 */
  signal?: AbortSignal;
  /**
   * 边收边给。**给了就开流**，不给还是原来的一次读完。
   *
   * 回调只负责把字送出去，节流与重绘归界面：这里可能一秒来几十帧，
   * 每帧都重画侧栏会卡。抛错会被当成请求失败，所以回调本身不要抛。
   */
  onDelta?: (piece: string) => void;
}

/**
 * 调一次 `/chat/completions` 的三件套。
 *
 * 抽成形状而不是直接读 `settings.ai`：扫描页识别的视觉通道有自己的
 * 地址 / 密钥 / 模型（2026-11-15 用户要求，和朗读一样互相独立），
 * 但它走的是同一个 OpenAI 兼容请求，不该再抄一份。
 */
export interface ChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 请求协议（缺省 openai）；anthropic 走 /messages 与 x-api-key */
  protocol?: AIProtocol;
  /** 注册表按思考档位解析出的请求体片段（面板独裁，调用方不再另算） */
  thinkingBody?: Record<string, unknown> | null;
  /** 注册表按「覆盖 > 模型档 > 默认值」解析出的 max_tokens */
  maxTokens?: number;
}

/** 调一次 /chat/completions 的通用选项。扫描页识别（视觉 OCR）也走这条路 */
export interface AiChatOptions extends AiAskOptions {
  /** 采样温度；默认 0.3（识别这类任务调用方会给更低的） */
  temperature?: number;
  /** 输出上限；不传就交给服务商的默认值 */
  maxTokens?: number;
  /**
   * 思考模式开关。
   *
   * 2026-11-15 实测：DeepSeek 默认会先思考再回答，识别一页书时 4000 的
   * 输出额度会被思考吃光，正文是空的、`finish_reason` 是 `length`。
   * 只有官方端点认这个字段，别家兼容层传了可能 400，所以按域名判断。
   */
  thinking?: 'enabled' | 'disabled';
  /** 覆盖默认超时（识别一页比问答慢） */
  timeoutMs?: number;
  /** 错误消息里的名字：`AI` / `OCR`，默认 AI */
  label?: string;
}

/**
 * 这个地址是不是 DeepSeek 官方端点。
 *
 * 只看主机名：用户可能填 `https://api.deepseek.com`、`.../v1`，也可能是
 * 代理到别处的同域地址。别的域名一律不认，避免把 `thinking` 这种字段
 * 发给不认识它的兼容层。
 */
export function isDeepSeekChat(baseUrl: string): boolean {
  try {
    const host = new URL(String(baseUrl ?? '')).hostname.toLowerCase();
    return host === 'deepseek.com' || host.endsWith('.deepseek.com');
  } catch {
    return false;
  }
}

/**
 * 读完一条 SSE 流，边读边把增量交出去。
 *
 * 返回**整条正文**（收尾后拼好的那份），调用方据此做引文校验与落库。
 * 返回 `null` 表示「这不是一条流」：上游忽略了 `stream`，回了整份 JSON，
 * 这一路的 body 一个字节都没读，交给下面照常解析。
 *
 * 字节解码要用 `TextDecoder(..., {stream: true})`：一帧可能刚好切在
 * 汉字的三个字节中间，逐帧 `toString()` 会把字解成乱码。
 */
async function readChatStream(
  res: Response,
  onDelta: (piece: string) => void,
  bump: () => void,
  protocol: AIProtocol,
): Promise<string | null> {
  const type = String(res.headers.get('content-type') || '').toLowerCase();
  /* 明确是 JSON 就不是流。没给 content-type 的当流处理——很多本地服务
     不设这个头，按 JSON 处理会直接 fail 在 `res.json()`。 */
  if (type.includes('json') && !type.includes('event-stream')) return null;

  const reader = res.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      /* 只要连接还在吐字节就重排超时：思考型模型（deepseek 的
         reasoning_content）会先连发几十帧「想」，正文一个字都还没有；
         按「到字」计时会把正在正常思考的请求误杀。 */
      bump();
      const out = drainChatSse(protocol, buffer);
      buffer = out.rest;
      if (out.error) throw new Error(out.error);
      for (const piece of out.deltas) {
        text += piece;
        onDelta(piece);
      }
      if (out.done) break;
    }
    /* 收尾：解码器里可能还压着半个字符，末尾也可能少一个空行 */
    const trailing = buffer + decoder.decode();
    if (trailing.trim()) {
      const tail = drainChatSse(protocol, `${trailing}\n\n`);
      if (tail.error) throw new Error(tail.error);
      for (const piece of tail.deltas) {
        text += piece;
        onDelta(piece);
      }
    }
  } finally {
    /* 不想再读了就掐掉连接：留着会让服务端把剩下的 token 算完 */
    void reader.cancel().catch(() => undefined);
  }
  return text;
}

/**
 * 调 OpenAI 兼容的 `/chat/completions`，返回第一条消息的文字。
 *
 * `messages` 的 content 由调用方决定：普通问答是字符串，视觉识别是
 * `[{type:'text'},{type:'image_url',image_url:{url}}]` 数组——OpenAI、
 * 智谱、Gemini 兼容层都认这个形状，所以不必给「多模态」另开一条请求链路。
 * 失败抛 Error，消息给人看。
 */
export async function postChat(
  config: ChatConfig,
  messages: ReadonlyArray<{ role: string; content: unknown }>,
  opts: AiChatOptions = {},
): Promise<string> {
  const { baseUrl, apiKey, model } = config;
  const label = opts.label || 'AI';
  const timeout = Math.max(1, Number(opts.timeoutMs) || AI_TIMEOUT_MS);
  /* 超时（P2-12）+ 外部取消：没有超时的时候，接口地址填错、代理挂掉，
     界面就一直「正在请求…」；没有取消，用户只能关掉整个弹层干等。
     流式时这条计时改成**两次到字之间的最长间隔**（每来一帧就重排）：
     整条回答可能要几分钟，但停在一个字上不动才是真卡住。 */
  let timedOut = false;
  const ctrl = new AbortController();
  let timer = window.setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeout);
  const bump = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeout);
  };
  const onAbort = (): void => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const streaming = typeof opts.onDelta === 'function';
  const protocol = config.protocol ?? 'openai';
  /* 面板档位优先；OCR 等老调用点直给 opts.thinking 时只对 DeepSeek 官方端点生效
     （兼容层传它可能被 400 拒绝）。 */
  const thinkingBody =
    config.thinkingBody ?? (opts.thinking && isDeepSeekChat(baseUrl) ? { thinking: { type: opts.thinking } } : null);
  const req = buildChatRequest(
    { endpoint: baseUrl, apiKey, model, protocol, thinkingBody, maxTokens: config.maxTokens },
    messages,
    { stream: streaming, temperature: opts.temperature, maxTokens: opts.maxTokens ?? config.maxTokens },
  );
  let res: Response;
  try {
    /* 用 window.fetch 而不是 requestUrl：后者不接受 AbortSignal，超时与
       「取消请求」都会失效；这个端点由用户自己配置，不需要 Obsidian 代发 CORS。 */
    res = await window.fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new Error('已取消');
    const name = (e as Error)?.name || '';
    if (timedOut || name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(`${label} 接口 ${timeout / 1000} 秒没有响应，检查地址与网络后重试`);
    }
    throw new Error(`连不上 ${label} 接口：${(e as Error)?.message || '网络错误'}`);
  } finally {
    window.clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
  if (!res.ok) {
    // 401/403 多半是 Key；404 多半是 baseUrl 少了 /v1 或多了路径——都直接告诉用户
    const hint =
      res.status === 401 || res.status === 403
        ? '（检查 API Key）'
        : res.status === 404
          ? '（检查接口地址，一般要以 /v1 结尾）'
          : '';
    throw new Error(`${label} 接口返回 ${res.status}${hint}`);
  }
  /* 流式：拿到 body 才走；上游忽略 stream 回了整份 JSON 时返回 null，
     下面照常解析——不能因为「不回流」就让整次提问失败。 */
  if (streaming && res.body) {
    let streamed: string | null;
    try {
      streamed = await readChatStream(res, opts.onDelta!, bump, protocol);
    } catch (e) {
      if (opts.signal?.aborted) throw new Error('已取消');
      if (timedOut) {
        throw new Error(`${label} 接口 ${timeout / 1000} 秒没有响应，检查地址与网络后重试`);
      }
      throw new Error(`${label} 接口中断：${(e as Error)?.message || '网络错误'}`);
    }
    if (streamed !== null) {
      if (!streamed) {
        throw new Error(emptyChatMessage(undefined, '', model, label));
      }
      debugEvent('aichat', { model, finish: 'stream', shape: 'stream', chars: streamed.length });
      return streamed;
    }
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: string }>;
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(`${label} 接口报错：${data.error.message}`);
  const choice = data.choices?.[0];
  const text = chatTextOf(protocol, data);
  /* 识别失败时最缺的是「为什么」：模型名、结束原因、正文是什么形状。
     只记这三样，正文与图片一个字都不进日志。 */
  debugEvent('aichat', {
    model,
    finish: choice?.finish_reason ?? '',
    shape: Array.isArray(choice?.message?.content) ? 'array' : typeof choice?.message?.content,
    chars: text.length,
  });
  if (!text) throw new Error(emptyChatMessage(choice?.finish_reason, choice?.message?.reasoning_content, model, label));
  return text;
}

/** 调一次 /chat/completions（读本插件「AI 助手」那一套配置）。 */
export async function aiPostChat(
  settings: ReaderSettings,
  messages: ReadonlyArray<{ role: string; content: unknown }>,
  opts: AiChatOptions = {},
): Promise<string> {
  /* 共享 AI 配置（2026-11-19）：自己没配、开关开着，就借用 bz Review 那份。
     这里是唯一出口，所有 AI 功能（问答 / 挑重点 / 制卡）都自动拿到它。 */
  let ai = settings.ai;
  if (!aiReadyOf(ai) && settings.aiShare !== false) {
    ai = (await ensureSharedAi()) ?? ai;
  }
  if (!aiReadyOf(ai)) {
    throw new Error('还没配置 AI 接口：到 书架 · 设置 的「AI 助手」里填好地址、模型与密钥');
  }
  /* 注册表单一事实源：服务商决定端点 / 密钥 / 协议 / 上限 / 思考档位。
     OCR 那条独立通道直接调 postChat，不经过这里。 */
  const c = resolveAiConfig(ai);
  return postChat(
    {
      baseUrl: c.endpoint,
      apiKey: c.apiKey,
      model: c.model,
      protocol: c.protocol,
      maxTokens: c.maxTokens,
      thinkingBody: c.thinkingBody,
    },
    messages,
    opts,
  );
}

/**
 * 从一条回复里取正文。
 *
 * OpenAI 自己回的是字符串，兼容层不一定：多模态那条路上有的服务回
 * `[{type:'text',text:'…'}]` 分段。以前只认字符串，数组一律当「没有返回
 * 内容」——识别扫描页时用户看到的是一句没有任何信息量的失败。
 */
export function chatText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const part of content) {
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      out += (part as { text: string }).text;
    }
  }
  return out.trim();
}

/**
 * 「接口通了、正文是空的」这句话该怎么说。
 *
 * 四种原因对用户是四件事：换模型、调输出上限、重试、去看服务端日志。共用
 * 一句「没有返回内容」等于什么都没说——2026-11-15 扫描页识别就卡在这。
 */
export function emptyChatMessage(
  finish: string | undefined,
  reasoning: unknown,
  model: string,
  label = 'AI',
): string {
  const head = `${label} 没有返回内容`;
  const who = model ? `（当前模型：${model}）` : '';
  const thought = typeof reasoning === 'string' && reasoning.trim();
  if (finish === 'length') {
    return `${head}：输出被长度上限截断（这一页可能行太多，或模型先思考用完了额度）${who}`;
  }
  if (thought) return `${head}：模型只给了思考过程、没给正文，换一个能看图的模型${who}`;
  return `${head}：多半这个模型不支持看图，换一个多模态模型（如 deepseek-flash / gpt-4o / qwen-vl）${who}`;
}

/** 调 OpenAI 兼容的 /chat/completions。失败抛 Error，消息给人看。 */
export async function aiAsk(
  settings: ReaderSettings,
  input: AiAskInput,
  opts: AiAskOptions = {},
): Promise<AiResult> {
  const messages = buildMessages(input);
  return { text: await aiPostChat(settings, messages, { ...opts, timeoutMs: askTimeoutMs(input.task) }) };
}

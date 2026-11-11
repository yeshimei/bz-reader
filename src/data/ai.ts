/* ============================================================
 * bz-reader · AI 调用层（data/ai.ts）
 *
 * 只做一件事：把 OpenAI 兼容接口的一问一答包成 `aiAsk(input)`。
 * 不做流式——结果是一次性读完的一段话，流式的实现复杂度换不来体验，
 * 「正在请求 AI…」一行字 + 一次等待就够了。
 *
 * 无 key 不静默失败：ready() 为 false 时上层给出配置引导，
 * 用户应该被带到设置页，而不是看着按钮点了没反应。
 * ============================================================ */
import { resolveAi, aiReady, type ReaderSettings } from './settings';
import { buildEnrichMessages } from './book-enrich';
import { buildGuideMessages } from './chapter-guide';
import { buildRouteMessages, type RouteBook } from './topic-route';

export type AiTask =
  | 'summarize'
  | 'explain'
  | 'translate'
  | 'ask'
  | 'follow'
  | 'shelf'
  | 'enrich'
  | 'guide'
  | 'route';

/**
 * 追问时原文最多带多少字。
 *
 * 2000 字约 1.3k token：足够模型看清这一段的上下文，又不至于每次追问
 * 都把一整章塞进去。划词通常几十到几百字，这个上限只在选中整页时才碰到。
 */
export const FOLLOW_QUOTE_LIMIT = 2000;

/**
 * 问答带多少正文。
 *
 * 6000 字约 4k token：够模型看懂这一页在讲什么，又不至于每次提问都
 * 烧掉一大截额度。epub 的一「屏」通常 800–1200 字，留了五倍余量。
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
  /** 当前这一屏的正文（只有 ask 用；不传就明说没有正文） */
  context?: string;
  /** 之前的问答，按时间正序 */
  history?: AiTurn[];
  /** 主题书单的候选（只有 route 用）：书 + 命中的章节 + 相关度 */
  books?: RouteBook[];
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

/** 摘录 / 解释 / 翻译的老口径，一字不改（回归测试锁着） */
function buildPrompt(task: Exclude<AiTask, 'ask' | 'follow' | 'shelf' | 'enrich' | 'guide' | 'route'>, text: string): string {
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
  /* 2026-11-11 真机反馈：追问的回答动辄一整屏，手机上一段分析要翻两屏才看完。
     追问是「接着聊」，不是「再写一篇」——所以把长度写成硬约束，并明确
     「读者要求展开」才放长，免得模型把简练当成不许解释。 */
  const system = quote
    ? '你是读者的共读助手。下面这段是读者正在读的原文。回答读者关于它的问题；可以用书外的知识补充，但要说明哪些是补充。用中文，先给结论，不寒暄。回答要短：通常三到五句、100 字以内，不复述原文，不要长清单；只有读者明确要求「详细说说」时才展开。'
    : '你是读者的共读助手。这次没有原文，只能凭问题本身作答，回答前先说明这一点。用中文，三到五句以内，不寒暄。';

  const messages: AiMessage[] = [{ role: 'system', content: system }];
  if (quote) messages.push({ role: 'system', content: `【原文】\n${quote}` });
  for (const turn of (input.history ?? []).slice(-ASK_HISTORY_MAX)) {
    if (turn.content.trim()) messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: `【问题】\n${input.text}` });
  return messages;
}

/**
 * 问这摞书（shelf，2026-11-10）。
 *
 * 与 ask 的差别只在依据：ask 的依据来自一本书，shelf 的依据来自几本，
 * 每条都带着【书名 · 章节】。system 里必须把「说清是哪本书说的」写死——
 * 不写的话模型会把三本书的观点揉成一段无主语的总结，用户没法核对。
 *
 * 与 ask 一样不接书外知识：依据里没有的就说没有。想聊书外的东西，
 * 用户会去划词卡里追问。
 */
function buildShelfMessages(input: AiAskInput): AiMessage[] {
  const ctx = clipContext(input.context ?? '');
  const system = ctx
    ? '你是这几本书的共读助手。依据里每一段都标了出处（书名 · 章节）。回答时要说清是哪本书的说法；依据里没有的，直接说「这几本书里没有提到」，不要用书外的知识补充。用中文，先给结论再给依据，不要寒暄。'
    : '你是这几本书的共读助手。但这次没有取到可用的依据，只能凭问题本身作答，回答前先说明这一点。用中文，简洁。';
  const messages: AiMessage[] = [{ role: 'system', content: system }];
  for (const turn of (input.history ?? []).slice(-ASK_HISTORY_MAX)) {
    if (turn.content.trim()) messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({
    role: 'user',
    content: ctx ? `【依据】\n${ctx}\n\n【问题】\n${input.text}` : `【问题】\n${input.text}`,
  });
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
  if (input.task === 'route') return buildRouteMessages({ topic: input.text, books: input.books ?? [] });
  if (input.task === 'shelf') return buildShelfMessages(input);
  if (input.task !== 'ask') {
    return [{ role: 'user', content: buildPrompt(input.task, input.text) }];
  }

  const book = input.title?.trim() || '这本书';
  const chapter = input.chapter?.trim();
  const ctx = clipContext(input.context ?? '');

  const system = ctx
    ? `你是《${book}》的共读助手。只根据下面提供的依据回答；依据里没有的，直接说「书里没有提到」，不要用书外的知识补充。用中文，先给结论再给依据，不要寒暄。${
        chapter ? `当前章节：${chapter}。` : ''
      }`
    : `你是《${book}》的共读助手。但这次没有取到可用的依据，只能凭问题本身作答，回答前先说明这一点。用中文，简洁。`;

  const messages: AiMessage[] = [{ role: 'system', content: system }];
  for (const turn of (input.history ?? []).slice(-ASK_HISTORY_MAX)) {
    if (turn.content.trim()) messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({
    role: 'user',
    content: ctx ? `【依据】\n${ctx}\n\n【问题】\n${input.text}` : `【问题】\n${input.text}`,
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

export interface AiAskOptions {
  /** 外部取消（弹层里的「取消请求」）。超时与取消是两条路，提示要分开 */
  signal?: AbortSignal;
}

/** 调 OpenAI 兼容的 /chat/completions。失败抛 Error，消息给人看。 */
export async function aiAsk(
  settings: ReaderSettings,
  input: AiAskInput,
  opts: AiAskOptions = {},
): Promise<AiResult> {
  /* 地址、密钥、模型从「当前选中的服务商」解析出来：模型留空走该家默认，
     密钥留空只在 Ollama / 自定义这类不需要鉴权的通道才放行（aiReady 判）。 */
  const { baseUrl, apiKey, model } = resolveAi(settings);
  if (!aiReady(settings)) {
    throw new Error('还没配置 AI 接口：到 书架 · 设置 的「AI 助手」里选好服务商，填上密钥');
  }
  const messages = buildMessages(input);
  /* 超时（P2-12）+ 外部取消：没有超时的时候，接口地址填错、代理挂掉，
     界面就一直「正在请求…」；没有取消，用户只能关掉整个弹层干等。 */
  let timedOut = false;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, AI_TIMEOUT_MS);
  const onAbort = (): void => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  let res: Response;
  /* 无鉴权的本地服务（Ollama、自建网关）不带 Authorization：空 Bearer 头
     有些服务端会当成「给了错的凭据」直接 401，比不带还糟。 */
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  try {
    /* 用 window.fetch 而不是 requestUrl：后者不接受 AbortSignal，超时与
       「取消请求」都会失效；这个端点由用户自己配置，不需要 Obsidian 代发 CORS。 */
    res = await window.fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new Error('已取消');
    const name = (e as Error)?.name || '';
    if (timedOut || name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(`AI 接口 ${AI_TIMEOUT_MS / 1000} 秒没有响应，检查地址与网络后重试`);
    }
    throw new Error(`连不上 AI 接口：${(e as Error)?.message || '网络错误'}`);
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
    throw new Error(`AI 接口返回 ${res.status}${hint}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(`AI 接口报错：${data.error.message}`);
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI 没有返回内容');
  return { text: content.trim() };
}

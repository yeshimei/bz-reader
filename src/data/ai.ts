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
import type { ReaderSettings } from './settings';

export type AiTask = 'summarize' | 'explain' | 'translate' | 'ask';

export const AI_TASK_LABELS: Record<AiTask, string> = {
  summarize: '摘要',
  explain: '释',
  translate: '译',
  ask: '问',
};

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
  /** 当前章节名 */
  chapter?: string;
  /** 当前这一屏的正文（只有 ask 用；不传就明说没有正文） */
  context?: string;
  /** 之前的问答，按时间正序 */
  history?: AiTurn[];
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
function buildPrompt(task: Exclude<AiTask, 'ask'>, text: string): string {
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
 * 拼出要发给模型的 messages。
 *
 * ask 与其余三个任务的区别不只是 prompt：它带 system（角色与边界）、
 * 带正文、带多轮历史。以前「问这本书」直接复用 explain 的 prompt，
 * 用户问「讲了什么」会被当成一段要解释的名词。
 */
export function buildMessages(input: AiAskInput): AiMessage[] {
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

/* ─────────── 嵌入（书的向量由这里算，不再借 bz） ─────────── */

/**
 * 一批发多少块。
 *
 * 与建画像的批（portrait-build 的 8 块）对齐：一批就是一次请求，
 * 太大接口按数组长度吃内存、失败时整批白跑；太小则请求数翻倍。
 */
export const EMBED_BATCH = 8;

/** 一次嵌入请求最多等多久：嵌入比对话慢，但也不该无限等 */
export const EMBED_TIMEOUT_MS = 120_000;

export interface EmbedRequest {
  url: string;
  body: { model: string; input: string[] };
}

/** 请求长什么样（单独抽出来是为了能被测试钉住，不用起网络） */
export function buildEmbedRequest(settings: ReaderSettings, texts: string[]): EmbedRequest {
  const { baseUrl, embedModel } = settings.ai;
  return { url: `${baseUrl}/embeddings`, body: { model: embedModel, input: texts } };
}

/**
 * 解析嵌入返回。
 *
 * 三条会悄悄出错、界面上看不出来的事，一律当错误：
 *   1. **条数不对**：少一条就是少一块的依据，硬配下去向量与块从此错位；
 *   2. **空向量**：不是「相似度为 0」，是这块根本没有向量；
 *   3. **index 缺失**：接口不保证顺序，有 index 就按它归位。
 */
export function parseEmbeddings(raw: unknown, expect: number): number[][] {
  const data = raw as {
    data?: Array<{ index?: number; embedding?: unknown }>;
    error?: { message?: string };
  };
  if (data?.error?.message) throw new Error(`嵌入接口报错：${data.error.message}`);
  const rows = Array.isArray(data?.data) ? data.data : [];
  if (rows.length !== expect) {
    throw new Error(`嵌入接口返回的条数不对：要 ${expect} 条，拿到 ${rows.length} 条`);
  }
  const out: number[][] = new Array(expect);
  rows.forEach((row, fallbackIndex) => {
    const at = typeof row?.index === 'number' ? row.index : fallbackIndex;
    const vec = Array.isArray(row?.embedding) ? row.embedding.map((n) => Number(n)) : [];
    if (!vec.length || vec.some((n) => !Number.isFinite(n))) {
      throw new Error('嵌入接口返回了空向量');
    }
    if (at >= 0 && at < expect) out[at] = vec;
  });
  /* index 越界 / 重复会让某些槽位是空的：这也是「条数不对」的一种 */
  if (out.some((v) => !v)) throw new Error(`嵌入接口返回的条数不对：要 ${expect} 条，归位后有空缺`);
  return out;
}

export interface EmbedOptions {
  signal?: AbortSignal;
  /** 测试注入：默认 window.fetch */
  fetch?: typeof fetch;
}

/**
 * 把若干段文字算成向量（按 EMBED_BATCH 切批）。
 *
 * 失败直接抛给人看的消息：调用方（建画像 / 提问）会把它当「这一块没拿到」
 * 或「这次问不了」处理，不会静默算出一堆 0 向量。
 */
export async function aiEmbed(settings: ReaderSettings, texts: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  const { baseUrl, apiKey, embedModel } = settings.ai;
  if (!baseUrl || !apiKey || !embedModel) {
    throw new Error('还没配置嵌入模型：到 书架 · 设置 的「AI 助手」里填好服务商、密钥与嵌入模型');
  }
  const list = (texts ?? []).map((t) => String(t ?? ''));
  if (!list.length) return [];
  const doFetch = opts.fetch ?? window.fetch.bind(window);
  const out: number[][] = [];
  for (let i = 0; i < list.length; i += EMBED_BATCH) {
    const batch = list.slice(i, i + EMBED_BATCH);
    const req = buildEmbedRequest(settings, batch);
    let res: Response;
    try {
      res = await doFetch(req.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(req.body),
        signal: opts.signal,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw new Error('已取消');
      throw new Error(`连不上嵌入接口：${(e as Error)?.message || '网络错误'}`);
    }
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? '（检查 API Key）'
          : res.status === 404
            ? '（检查接口地址与嵌入模型名，一般以 /v1 结尾）'
            : '';
      throw new Error(`嵌入接口返回 ${res.status}${hint}`);
    }
    out.push(...parseEmbeddings(await res.json(), batch.length));
  }
  return out;
}

/** 一个问题 → 一个向量 */
export async function aiEmbedQuery(settings: ReaderSettings, text: string, opts: EmbedOptions = {}): Promise<number[]> {
  const [vec] = await aiEmbed(settings, [String(text ?? '')], opts);
  if (!vec?.length) throw new Error('嵌入接口没有返回查询向量');
  return vec;
}

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
  const { baseUrl, apiKey, model } = settings.ai;
  if (!baseUrl || !apiKey || !model) {
    throw new Error('还没配置 AI 接口：到 书架 · 设置 的「AI 助手」里填好服务商、模型与密钥');
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
  try {
    /* 用 window.fetch 而不是 requestUrl：后者不接受 AbortSignal，超时与
       「取消请求」都会失效；这个端点由用户自己配置，不需要 Obsidian 代发 CORS。 */
    res = await window.fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
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

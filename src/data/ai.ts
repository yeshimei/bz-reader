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
    ? `你是《${book}》的共读助手。只根据下面提供的正文回答；正文里没有的，直接说「这一页没提到」，不要用书外的知识补充。用中文，先给结论再给依据，不要寒暄。${
        chapter ? `当前章节：${chapter}。` : ''
      }`
    : `你是《${book}》的共读助手。但这一页没有正文可取，只能凭问题本身作答，回答前先说明这一点。用中文，简洁。`;

  const messages: AiMessage[] = [{ role: 'system', content: system }];
  for (const turn of (input.history ?? []).slice(-ASK_HISTORY_MAX)) {
    if (turn.content.trim()) messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({
    role: 'user',
    content: ctx ? `【正文】\n${ctx}\n\n【问题】\n${input.text}` : `【问题】\n${input.text}`,
  });
  return messages;
}

export interface AiResult {
  text: string;
}

/** 调 OpenAI 兼容的 /chat/completions。失败抛 Error，消息给人看。 */
export async function aiAsk(settings: ReaderSettings, input: AiAskInput): Promise<AiResult> {
  const { baseUrl, apiKey, model } = settings.ai;
  if (!baseUrl || !apiKey || !model) {
    throw new Error('还没配置 AI 接口：到 书架 · 设置 的「AI 助手」里填好服务商、模型与密钥');
  }
  const messages = buildMessages(input);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
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
    });
  } catch (e) {
    throw new Error(`连不上 AI 接口：${(e as Error)?.message || '网络错误'}`);
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

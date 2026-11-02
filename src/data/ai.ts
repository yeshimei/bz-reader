/* ============================================================
 * bz-reader · AI 调用层（data/ai.ts）
 *
 * 只做一件事：把 OpenAI 兼容接口的一问一答包成 `aiAsk(task, text)`。
 * 不做流式——结果是一次性读完的一段话，流式的实现复杂度换不来体验，
 * 「正在请求 AI…」一行字 + 一次等待就够了。
 *
 * 无 key 不静默失败：ready() 为 false 时上层给出配置引导，
 * 用户应该被带到设置页，而不是看着按钮点了没反应。
 * ============================================================ */
import type { ReaderSettings } from './settings';

export type AiTask = 'summarize' | 'explain' | 'translate';

export const AI_TASK_LABELS: Record<AiTask, string> = {
  summarize: '摘要',
  explain: '释',
  translate: '译',
};

function isMostlyChinese(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk / Math.max(1, text.length) > 0.15;
}

function buildPrompt(task: AiTask, text: string): string {
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

export interface AiResult {
  text: string;
}

/** 调 OpenAI 兼容的 /chat/completions。失败抛 Error，消息给人看。 */
export async function aiAsk(settings: ReaderSettings, task: AiTask, text: string): Promise<AiResult> {
  const { baseUrl, apiKey, model } = settings.ai;
  if (!baseUrl || !apiKey || !model) throw new Error('还没配置 AI 接口：到 设置 → bz 阅读 → AI 填好地址、Key 和模型');
  const prompt = buildPrompt(task, text);
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
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (e) {
    throw new Error(`连不上 AI 接口：${(e as Error)?.message || '网络错误'}`);
  }
  if (!res.ok) {
    // 401/403 多半是 Key；404 多半是 baseUrl 少了 /v1 或多了路径——都直接告诉用户
    const hint = res.status === 401 || res.status === 403 ? '（检查 API Key）' : res.status === 404 ? '（检查接口地址，一般要以 /v1 结尾）' : '';
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

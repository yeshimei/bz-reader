/**
 * 模型 token 档位（从 bz 主仓移植的纯数据表）
 *
 * 注册表里的 defaultMaxTokens 是 per-provider 静态常量，但同一家端点下能换
 * 任意模型（OpenRouter / Ollama / 自定义尤甚），静态值必然对不上「当前这个
 * 模型」。本表按模型名解析官方最大输出，供设置面板和请求解析共用——单一
 * 事实源，禁留第二套判定。
 *
 * 解析优先级：面板 per-provider 覆盖 > 本表命中 > 注册表默认。
 * contextWindow 是参考数据（界面没有「上下文窗口」这一项），请求链只消费
 * maxOutput。上限只是封顶、不是目标消耗，但不得超过模型真实上限：未收录
 * 的模型回退注册表保守默认，不猜大数。
 */

/** 模型档位（token 数）：官方最大输出 / 官方上下文窗口 */
export interface ModelLimits {
  maxOutput: number;
  contextWindow: number;
}

/** 表条目：id + 常见别名（同一模型的不同写法） */
interface ModelLimitEntry extends ModelLimits {
  id: string;
  aliases?: string[];
}

/** 只收录有据可查的模型；无依据的留给注册表保守默认 */
export const MODEL_LIMITS: ModelLimitEntry[] = [
  // DeepSeek 官方（上下文 1M / 最大输出 384K，在售模型同档）
  {
    id: 'deepseek-flash',
    aliases: ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-flash-latest', 'deepseek-v4.1-flash'],
    maxOutput: 393216,
    contextWindow: 1048576,
  },
  {
    id: 'deepseek-v4-pro',
    aliases: ['deepseek-pro', 'deepseek-pro-latest'],
    maxOutput: 393216,
    contextWindow: 1048576,
  },
  // 阿里云百炼 Qwen
  { id: 'qwen3.7-plus', aliases: ['qwen-plus'], maxOutput: 131072, contextWindow: 1000000 },
  { id: 'qwen3.7-max', aliases: ['qwen-max'], maxOutput: 65536, contextWindow: 1000000 },
  { id: 'qwen3.7-flash', aliases: ['qwen-flash', 'qwen-turbo'], maxOutput: 16384, contextWindow: 1000000 },
  // 智谱 GLM-5.3 系（最大输出 131072 / 默认 65536 / 上下文 1M）
  { id: 'glm-5.3-flash', aliases: ['glm-5.3-flashx', 'glm-5.3'], maxOutput: 131072, contextWindow: 1000000 },
  // 沿用注册表既有口径的条目
  { id: 'claude-sonnet-4-5', aliases: ['claude-sonnet-4.5'], maxOutput: 64000, contextWindow: 200000 },
  { id: 'gpt-4o-mini', maxOutput: 16384, contextWindow: 128000 },
  { id: 'gemini-2.0-flash', maxOutput: 8192, contextWindow: 1048576 },
  { id: 'kimi-k2-0711-preview', aliases: ['kimi-k2'], maxOutput: 131072, contextWindow: 131072 },
  { id: 'glm-4-flash', maxOutput: 8192, contextWindow: 131072 },
];

/**
 * 归一化模型名：小写、去空白、去 `:tag`、去 vendor 前缀。
 * 服务商 /models 返回的 id 写法差异在此抹平，匹配只认归一化后的键。
 */
export function normalizeModelId(model: string): string {
  return String(model || '')
    .trim()
    .toLowerCase()
    .split(':')[0]
    .split('/')
    .pop()!
    .trim();
}

/**
 * 按模型名解析官方档位：精确命中（含别名）优先，其次取「最长命中键」的
 * 包含匹配（带日期后缀的快照名能落到基础条目上）。未收录返回 null。
 */
export function resolveModelLimits(model?: string): ModelLimits | null {
  const key = normalizeModelId(model || '');
  if (!key) return null;
  let best: { entry: ModelLimitEntry; len: number } | null = null;
  for (const entry of MODEL_LIMITS) {
    for (const k of [entry.id, ...(entry.aliases || [])]) {
      if (key === k) return { maxOutput: entry.maxOutput, contextWindow: entry.contextWindow };
      if (key.includes(k) && (!best || k.length > best.len)) best = { entry, len: k.length };
    }
  }
  return best ? { maxOutput: best.entry.maxOutput, contextWindow: best.entry.contextWindow } : null;
}

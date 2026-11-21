/* ============================================================
 * bz-reader · AI 服务商注册表（data/ai-providers.ts）
 *
 * 从 bz 主仓移植的**纯本地数据**（不 import 另一个仓的文件，三仓独立打包）：
 * 18 家服务商的端点 / 默认模型 / max_tokens 护栏 / 思考档位，都在这里一份。
 *
 * 老三家常驻 deepseek（缺省）/ zhipu-plan（智谱 Coding）/ ollama（本地）；
 * 国内常用 zhipu / qwen / kimi / siliconflow / volcengine / stepfun；
 * 海外常用 openai / anthropic / google / xai / mistral / groq / openrouter；
 * 本地 lmstudio；custom 兜底（OpenAI 兼容 / Anthropic 两套协议由设置切换）。
 * 插件没列出的服务商都从自定义接，不必为加一家改代码。
 *
 * 密钥口径与 bz 不同（reader 没有 deepseekApiKey 等老键）：
 *   · custom 复用设置里的旧三件套 baseUrl / apiKey / model（老配置零迁移）；
 *   · 其余各家统一走 aiApiKeys[id] / modelOverrides[id] 等 per-provider 表。
 *
 * 请求解析 resolveAiConfig 是纯函数：设置 + provider id → 一组请求参数，
 * 供 AI 调用层与设置页共用；上限取「面板覆盖 > 模型官方档 > 注册表默认」。
 * ============================================================ */
import { resolveModelLimits } from '../core/model-limits';
import type { MsgKey } from '../i18n';

/** 思考档位一项：面板档位 → 请求体片段（body = null 表示不注入任何思考参数） */
export interface AIThinkingLevel {
  /** 档位值（存 settings.ai.thinkingOverrides） */
  value: string;
  /** 设置面板展示名（i18n key） */
  labelKey: MsgKey;
  /** 该档位注入的请求体键值；null = 不注入 */
  body: Record<string, unknown> | null;
}

/** provider 的思考档位表：选项与请求注入同源 */
export interface AIThinkingSpec {
  levels: AIThinkingLevel[];
}

/** 请求协议：openai = /chat/completions；anthropic = /messages */
export type AIProtocol = 'openai' | 'anthropic';

export interface AIProviderDescriptor {
  /** 注册表键（settings.ai.provider 取值） */
  id: string;
  /** 设置页下拉展示名（i18n key） */
  labelKey: MsgKey;
  /** 请求协议（缺省 = openai） */
  protocol?: AIProtocol;
  /** 默认 API endpoint */
  endpoint: string;
  /** 默认模型（空 = 由用户填 / 调用方给） */
  model: string;
  /** 注册表默认 max_tokens（兜底档） */
  defaultMaxTokens: number;
  /** 该通道官方最大输出硬护栏；缺省 = 无官方上限可依（本地 / 聚合网关） */
  maxOutputCap?: number;
  /** 设置页密钥行标题（i18n key） */
  apiKeyLabelKey: MsgKey;
  /** 密钥行说明（i18n key） */
  apiKeyDescKey?: MsgKey;
  /** 思考档位表（缺省 = 不注入任何思考参数） */
  thinking?: AIThinkingSpec;
}

/** AI 设置的鸭子类型：解析层只读这些字段，settings.ts 的 AiSettings 满足它 */
export interface AiSettingsLike {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  apiKeys?: Record<string, string>;
  customProtocol?: string;
  modelOverrides?: Record<string, string>;
  maxTokensOverrides?: Record<string, number>;
  thinkingOverrides?: Record<string, string>;
}

/** 缺省服务商（注册表首位；设置未显式时用它） */
export const DEFAULT_AI_PROVIDER = 'deepseek';

/** 保守默认档：只有聚合数据、没法核实的家默认走它，避免整条请求被服务端拒掉 */
const SAFE_DEFAULT_MAX_TOKENS = 32768;

/* 存档 / 注入共用的档位动词表（逐家档位表由此取项） */
const THINK_AUTO: AIThinkingLevel = { value: 'auto', labelKey: 'ai.think.auto', body: null };
const THINK_OFF: AIThinkingLevel = { value: 'off', labelKey: 'ai.think.off', body: null };
const THINK_LOW: AIThinkingLevel = { value: 'low', labelKey: 'ai.think.low', body: null };
const THINK_MEDIUM: AIThinkingLevel = { value: 'medium', labelKey: 'ai.think.medium', body: null };
const THINK_HIGH: AIThinkingLevel = { value: 'high', labelKey: 'ai.think.high', body: null };
const THINK_MAX: AIThinkingLevel = { value: 'max', labelKey: 'ai.think.max', body: null };

/**
 * 在册提供商（18 家）。端点与默认模型取自 models.dev（MIT），
 * 思考档位逐家不同（参数名与支持的档不是全局属性）。
 */
export const AI_PROVIDER_REGISTRY: AIProviderDescriptor[] = [
  {
    id: 'deepseek',
    labelKey: 'ai.p.deepseek.label',
    endpoint: 'https://api.deepseek.com',
    /* 默认模型必须给：reader 不像 bz 有调用方兜底，`aiReadyOf` 要求 model 非空，
       留空会让「只填密钥」的默认服务商判成未配置，AI 功能整组不可用。 */
    model: 'deepseek-chat',
    defaultMaxTokens: 393216,
    maxOutputCap: 393216,
    apiKeyLabelKey: 'ai.p.deepseek.keyLabel',
    apiKeyDescKey: 'ai.p.deepseek.keyDesc',
    thinking: {
      levels: [
        THINK_AUTO,
        { ...THINK_OFF, body: { thinking: { type: 'disabled' } } },
        { ...THINK_LOW, body: { thinking: { type: 'enabled' }, reasoning_effort: 'low' } },
        { ...THINK_HIGH, body: { thinking: { type: 'enabled' }, reasoning_effort: 'high' } },
        { ...THINK_MAX, body: { thinking: { type: 'enabled' }, reasoning_effort: 'max' } },
      ],
    },
  },
  {
    // Coding 套餐额度只在 coding 专用端点生效；走标准 paas/v4 会报余额不足
    id: 'zhipu-plan',
    labelKey: 'ai.p.zhipu-plan.label',
    endpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-5.3-flash',
    defaultMaxTokens: 131072,
    maxOutputCap: 131072,
    apiKeyLabelKey: 'ai.p.zhipu-plan.keyLabel',
    apiKeyDescKey: 'ai.p.zhipu-plan.keyDesc',
    // glm-5.3 系强制思考（发 disabled 无效），故只给强度档
    thinking: {
      levels: [
        THINK_AUTO,
        { ...THINK_LOW, body: { reasoning_effort: 'low' } },
        { ...THINK_HIGH, body: { reasoning_effort: 'high' } },
        { ...THINK_MAX, body: { reasoning_effort: 'max' } },
      ],
    },
  },
  {
    id: 'ollama',
    labelKey: 'ai.p.ollama.label',
    endpoint: 'http://localhost:11434/v1',
    model: 'llama3.1',
    defaultMaxTokens: 8192,
    // 有意不设 maxOutputCap：本地模型上限因所装模型而异、无官方档位可依
    apiKeyLabelKey: 'ai.p.ollama.keyLabel',
    apiKeyDescKey: 'ai.p.ollama.keyDesc',
    thinking: {
      levels: [
        THINK_AUTO,
        { ...THINK_OFF, body: { reasoning_effort: 'none' } },
        { ...THINK_LOW, body: { reasoning_effort: 'low' } },
        { ...THINK_MEDIUM, body: { reasoning_effort: 'medium' } },
        { ...THINK_HIGH, body: { reasoning_effort: 'high' } },
      ],
    },
  },

  // ==================== 国内常用 ====================
  {
    id: 'zhipu',
    labelKey: 'ai.p.zhipu.label',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-flash',
    defaultMaxTokens: 131072,
    maxOutputCap: 131072,
    apiKeyLabelKey: 'ai.p.zhipu.keyLabel',
    apiKeyDescKey: 'ai.p.zhipu.keyDesc',
  },
  {
    id: 'qwen',
    labelKey: 'ai.p.qwen.label',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-flash',
    defaultMaxTokens: 131072,
    maxOutputCap: 131072,
    apiKeyLabelKey: 'ai.p.qwen.keyLabel',
    apiKeyDescKey: 'ai.p.qwen.keyDesc',
  },
  {
    id: 'kimi',
    labelKey: 'ai.p.kimi.label',
    endpoint: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3',
    defaultMaxTokens: SAFE_DEFAULT_MAX_TOKENS,
    maxOutputCap: 1048576,
    apiKeyLabelKey: 'ai.p.kimi.keyLabel',
    apiKeyDescKey: 'ai.p.kimi.keyDesc',
  },
  {
    id: 'siliconflow',
    labelKey: 'ai.p.siliconflow.label',
    endpoint: 'https://api.siliconflow.cn/v1',
    model: 'zai-org/GLM-5.3-Flash',
    // 聚合式服务：模型名带厂商前缀，选模型时照抄完整 id
    defaultMaxTokens: 131072,
    maxOutputCap: 131072,
    apiKeyLabelKey: 'ai.p.siliconflow.keyLabel',
    apiKeyDescKey: 'ai.p.siliconflow.keyDesc',
  },
  {
    id: 'volcengine',
    labelKey: 'ai.p.volcengine.label',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-pro-260628',
    defaultMaxTokens: SAFE_DEFAULT_MAX_TOKENS,
    maxOutputCap: 256000,
    apiKeyLabelKey: 'ai.p.volcengine.keyLabel',
    apiKeyDescKey: 'ai.p.volcengine.keyDesc',
  },
  {
    id: 'stepfun',
    labelKey: 'ai.p.stepfun.label',
    endpoint: 'https://api.stepfun.com/v1',
    model: 'step-3.7-flash',
    defaultMaxTokens: SAFE_DEFAULT_MAX_TOKENS,
    maxOutputCap: 256000,
    apiKeyLabelKey: 'ai.p.stepfun.keyLabel',
    apiKeyDescKey: 'ai.p.stepfun.keyDesc',
  },

  // ==================== 海外常用 ====================
  {
    id: 'openai',
    labelKey: 'ai.p.openai.label',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-6-luna',
    defaultMaxTokens: 128000,
    maxOutputCap: 128000,
    apiKeyLabelKey: 'ai.p.openai.keyLabel',
    apiKeyDescKey: 'ai.p.openai.keyDesc',
  },
  {
    // 唯一走 Anthropic Messages 协议的常驻通道
    id: 'anthropic',
    labelKey: 'ai.p.anthropic.label',
    protocol: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-haiku-5-5',
    defaultMaxTokens: 128000,
    maxOutputCap: 128000,
    apiKeyLabelKey: 'ai.p.anthropic.keyLabel',
    apiKeyDescKey: 'ai.p.anthropic.keyDesc',
  },
  {
    id: 'google',
    labelKey: 'ai.p.google.label',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    defaultMaxTokens: 65536,
    maxOutputCap: 65536,
    apiKeyLabelKey: 'ai.p.google.keyLabel',
    apiKeyDescKey: 'ai.p.google.keyDesc',
  },
  {
    id: 'xai',
    labelKey: 'ai.p.xai.label',
    endpoint: 'https://api.x.ai/v1',
    model: 'grok-4.7',
    defaultMaxTokens: SAFE_DEFAULT_MAX_TOKENS,
    maxOutputCap: 500000,
    apiKeyLabelKey: 'ai.p.xai.keyLabel',
    apiKeyDescKey: 'ai.p.xai.keyDesc',
  },
  {
    id: 'mistral',
    labelKey: 'ai.p.mistral.label',
    endpoint: 'https://api.mistral.ai/v1',
    model: 'mistral-large-4',
    defaultMaxTokens: SAFE_DEFAULT_MAX_TOKENS,
    maxOutputCap: 262144,
    apiKeyLabelKey: 'ai.p.mistral.keyLabel',
    apiKeyDescKey: 'ai.p.mistral.keyDesc',
  },
  {
    id: 'groq',
    labelKey: 'ai.p.groq.label',
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'qwen/qwen3.8-27b',
    defaultMaxTokens: 16384,
    maxOutputCap: 16384,
    apiKeyLabelKey: 'ai.p.groq.keyLabel',
    apiKeyDescKey: 'ai.p.groq.keyDesc',
  },
  {
    id: 'openrouter',
    labelKey: 'ai.p.openrouter.label',
    endpoint: 'https://openrouter.ai/api/v1',
    // 聚合网关：模型名必须由用户自己选（「获取模型名」拉全量列表）
    model: '',
    defaultMaxTokens: 8192,
    // 模型任意，上限是模型属性，无法用单一常量围栏
    apiKeyLabelKey: 'ai.p.openrouter.keyLabel',
    apiKeyDescKey: 'ai.p.openrouter.keyDesc',
  },

  // ==================== 本地 / 兜底 ====================
  {
    id: 'lmstudio',
    labelKey: 'ai.p.lmstudio.label',
    endpoint: 'http://127.0.0.1:1234/v1',
    model: '',
    defaultMaxTokens: 8192,
    apiKeyLabelKey: 'ai.p.lmstudio.keyLabel',
    apiKeyDescKey: 'ai.p.lmstudio.keyDesc',
  },
  {
    id: 'custom',
    labelKey: 'ai.p.custom.label',
    // 协议由 resolveAiConfig 按 settings.ai.customProtocol 动态解析（这里只作缺省）
    protocol: 'openai',
    endpoint: '',
    model: '',
    defaultMaxTokens: 8192,
    apiKeyLabelKey: 'ai.p.custom.keyLabel',
    apiKeyDescKey: 'ai.p.custom.keyDesc',
    // 不设 thinking：不认识的服务商冒进发思考参数有 400 风险
  },
];

/** 取注册表描述（未知名回退缺省服务商，保证设置页与解析一致） */
export function getProviderDescriptor(id?: string): AIProviderDescriptor {
  return (
    AI_PROVIDER_REGISTRY.find((p) => p.id === id) ||
    AI_PROVIDER_REGISTRY.find((p) => p.id === DEFAULT_AI_PROVIDER) ||
    AI_PROVIDER_REGISTRY[0]
  );
}

/** 该 provider 的档位表（设置面板选项与请求注入同源） */
export function thinkingLevelsOf(providerId?: string): AIThinkingLevel[] {
  return getProviderDescriptor(providerId).thinking?.levels ?? [];
}

/**
 * 输出上限护栏基准：先按当前生效模型（面板覆盖 > 注册表默认）查 model-limits
 * 的官方最大输出；查不到再取注册表 maxOutputCap；两者皆无 → undefined，
 * 表示该通道无官方上限可依、不设围栏。
 */
export function maxOutputCapOf(providerId?: string, modelName?: string): number | undefined {
  const desc = getProviderDescriptor(providerId);
  const hit = resolveModelLimits(modelName || desc.model || '');
  return hit ? hit.maxOutput : desc.maxOutputCap;
}

/**
 * 当前 provider + 档位值 → 应注入的请求体键值对；null = 不注入。
 * auto / 空 / 档位不在该 provider 表内一律不注入——「不认识的档位宁可不动」
 * 优先于「尽力翻译」。
 */
export function thinkingBodyFor(providerId: string | undefined, level: string | undefined): Record<string, unknown> | null {
  if (!providerId || !level || level === 'auto') return null;
  const hit = thinkingLevelsOf(providerId).find((l) => l.value === level);
  return hit?.body ?? null;
}

/** 本地服务免鉴权：空密钥放行 */
export function isNoAuthProvider(id: string): boolean {
  return id === 'ollama' || id === 'lmstudio';
}

/** 解析请求协议：注册表声明优先；自定义按设置动态取 */
export function protocolOf(desc: AIProviderDescriptor, s: AiSettingsLike): AIProtocol {
  if (desc.id === 'custom') {
    return String(s.customProtocol || '').toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
  }
  return desc.protocol === 'anthropic' ? 'anthropic' : 'openai';
}

/** 解析出的请求参数（供调用层与设置页共用） */
export interface ResolvedAiConfig {
  id: string;
  protocol: AIProtocol;
  /** 去掉尾部斜杠的接口根地址 */
  endpoint: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  thinkingBody: Record<string, unknown> | null;
}

/**
 * 从设置解析某家的请求参数。
 *   · custom 读旧三件套 baseUrl / apiKey / model（老配置零迁移）；
 *   · 其余各家密钥 / 模型 / 上限 / 思考档位按 provider id 分表存。
 * 缺项不在这里抛错（保持纯函数），由 aiReady 与调用层给人话提示。
 */
export function resolveAiConfig(s: AiSettingsLike, providerId?: string): ResolvedAiConfig {
  const rawProvider = String(s.provider || '').trim();
  /* 老三件套（没有 provider，却填了地址 / 密钥 / 模型）当自定义处理——
     与 normalizeSettings 同口径，未经归一化的直接构造对象也能正确解析。 */
  const legacyTriple =
    !rawProvider &&
    (!!String(s.baseUrl || '').trim() || !!String(s.apiKey || '').trim() || !!String(s.model || '').trim());
  const id = providerId || (legacyTriple ? 'custom' : rawProvider || DEFAULT_AI_PROVIDER);
  const desc = getProviderDescriptor(id);
  const custom = desc.id === 'custom';
  const endpoint = String(custom ? s.baseUrl || '' : desc.endpoint).trim().replace(/\/+$/, '');
  const apiKey = String(custom ? s.apiKey || '' : s.apiKeys?.[desc.id] ?? '').trim();
  const model = String(custom ? s.model || '' : s.modelOverrides?.[desc.id] || desc.model || '').trim();

  // 上限：面板覆盖 > 模型官方档 / 注册表护栏 > 注册表兜底档；覆盖值受护栏封顶
  const cap = maxOutputCapOf(desc.id, model);
  const requested = Number(s.maxTokensOverrides?.[desc.id]);
  const maxTokens =
    requested > 0
      ? cap === undefined
        ? requested
        : Math.min(requested, cap)
      : cap ?? desc.defaultMaxTokens;

  return {
    id: desc.id,
    protocol: protocolOf(desc, s),
    endpoint,
    apiKey,
    model,
    maxTokens,
    thinkingBody: thinkingBodyFor(desc.id, s.thinkingOverrides?.[desc.id]),
  };
}

/**
 * 「这套 AI 配置能真的发请求吗」——地址 / 模型齐，密钥有（本地服务免鉴权）。
 *
 * 2026-11-19 从 settings.aiReady 抽成纯判据：跨插件共享要先判定**借来的**
 * 配置可不可用，传入的必须是那一份而不是当前设置。
 */
export function aiReadyOf(s: AiSettingsLike | null | undefined): boolean {
  if (!s) return false;
  const c = resolveAiConfig(s);
  return !!c.endpoint && !!c.model && (!!c.apiKey || isNoAuthProvider(c.id));
}

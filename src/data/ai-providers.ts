/* ============================================================
 * bz-reader · AI 服务商表（data/ai-providers.ts）
 *
 * 2026-11-11：AI 组从「地址 / 模型 / 密钥」三个自由输入框改成「选服务商 →
 * 填密钥 → 选模型」。这张表是唯一事实源：设置页铺哪几个按钮、地址填什么、
 * 模型留空时用哪个、要不要密钥、模型列表走哪种接口，全从这里读。
 *
 * 为什么只有三家 + 自定义：三家是插件能替你保证「选完只填密钥就能用」的
 * 通道——地址与默认模型都替用户写好；其余服务商一律走「自定义」自己填地址，
 * 不用为了加一家就改一次代码（bz 那边同口径，只是它多了套餐/计费的分支）。
 *
 * 地址与默认模型照 bz 的注册表抄（core/ai.ts）：DeepSeek 393K 输出上限、
 * 智谱走 Coding 套餐端点、Ollama 本地无鉴权——两个插件用同一家同一个模型名，
 * 用户切过来不会发现「同一个服务商在两边的模型名不一样」。
 * ============================================================ */
import { t, type MsgKey } from '../i18n';

export type AiProviderId = 'deepseek' | 'zhipu-plan' | 'ollama' | 'custom';

/** 模型列表接口形态：OpenAI 兼容的 /models，或 Ollama 根路径的 /api/tags */
export type AiModelsApi = 'openai' | 'ollama';

export interface AiProviderSpec {
  id: AiProviderId;
  /** 固定接口地址（不带结尾斜杠）；空串 = 用设置里的自定义地址 */
  endpoint: string;
  /** 默认模型；空串 = 没有默认，必须自己填 */
  model: string;
  /** 密钥是否必填：Ollama 本地与无鉴权的自建服务都不需要 */
  keyRequired: boolean;
  /** 「获取模型」拉列表走哪种接口 */
  listApi: AiModelsApi;
}

/**
 * 在册服务商（顺序 = 设置页按钮顺序）。
 *
 * 刻意不把 OpenAI / OpenRouter / 硅基流动也塞进来：它们的模型名与地址变动频繁，
 * 写死在插件里就得跟着改，而「自定义」本来就是为这件事准备的——用户在服务商
 * 官网抄一个地址、填一个模型名，一样能用。
 */
export const AI_PROVIDERS: readonly AiProviderSpec[] = [
  {
    id: 'deepseek',
    endpoint: 'https://api.deepseek.com',
    /* 与 bz 的调用方默认一致；用户想用 v4-pro 就在模型框里改 */
    model: 'deepseek-v4-flash',
    keyRequired: true,
    listApi: 'openai',
  },
  {
    id: 'zhipu-plan',
    endpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-5.3-flash',
    keyRequired: true,
    listApi: 'openai',
  },
  {
    id: 'ollama',
    endpoint: 'http://localhost:11434/v1',
    model: 'llama3.1',
    keyRequired: false,
    listApi: 'ollama',
  },
  {
    /* 地址、模型都由用户填：注册表给不出默认，也不猜 */
    id: 'custom',
    endpoint: '',
    model: '',
    keyRequired: false,
    listApi: 'openai',
  },
];

/** 缺省服务商（新装默认 DeepSeek：只填一个密钥就能用，是三家最短的路） */
export const DEFAULT_AI_PROVIDER: AiProviderId = 'deepseek';

const LABEL_KEY: Record<AiProviderId, MsgKey> = {
  deepseek: 'settings.ai.prov.deepseek',
  'zhipu-plan': 'settings.ai.prov.zhipuPlan',
  ollama: 'settings.ai.prov.ollama',
  custom: 'settings.ai.prov.custom',
};

export function isAiProviderId(v: unknown): v is AiProviderId {
  return typeof v === 'string' && AI_PROVIDERS.some((p) => p.id === v);
}

/** 取服务商描述；认不出的 id（手改的 data.json、旧版本残留）回落缺省，永不返回 undefined */
export function aiProviderSpec(id?: string | null): AiProviderSpec {
  return AI_PROVIDERS.find((p) => p.id === id) || AI_PROVIDERS[0];
}

/** 服务商在界面上的名字（品牌名各语言同形，只有「自定义」要翻） */
export function aiProviderLabel(id?: string | null): string {
  return t(LABEL_KEY[aiProviderSpec(id).id]);
}

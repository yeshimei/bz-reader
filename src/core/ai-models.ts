/* ============================================================
 * bz-reader · 服务商模型列表拉取（core/ai-models.ts）
 *
 * 「获取模型名」按钮的纯数据层：OpenAI 兼容 GET {endpoint}/models，
 * Ollama GET {base}/api/tags（无鉴权）。fetch 优先，失败回退 requestUrl
 * （无 CORS 限制）。不触 DOM、不弹通知：报错文案抛给设置页按钮统一提示。
 *
 * 设置不做模块级单例注入——reader 没有 settings-provider，直接把 settings.ai
 * 作为参数传进来，纯函数更好测，也不怕切换服务商读到旧状态。
 * ============================================================ */
import { requestUrl } from 'obsidian';
import { t } from '../i18n';
import {
  getProviderDescriptor,
  isNoAuthProvider,
  protocolOf,
  type AIProviderDescriptor,
  type AiSettingsLike,
} from '../data/ai-providers';

/** OpenAI 兼容 /models 拉取超时（ms）：设置页交互场景 */
export const MODELS_TIMEOUT_MS = 8000;
/** Ollama /api/tags 拉取超时（ms）：本地服务默认 30s */
export const OLLAMA_TIMEOUT_MS = 30000;
/** Ollama 服务根地址（注册表 endpoint 是 /v1 兼容面，列表端点挂在根） */
const OLLAMA_BASE_URL = 'http://localhost:11434';

/** 模型选项（选择器展示面：名称 + 来源说明） */
export interface ModelOption {
  id: string;
  detail?: string;
}

/** 最小响应面：测试桩无需完整 Response */
interface JsonResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

/** fetch 初始化参数（只用到这三个字段，显式类型避免 any） */
interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** 拉取通道注入（测试桩；缺省用插件运行时真实实现） */
export interface ModelsFetchDeps {
  fetchFn?: (url: string, init?: FetchInit) => Promise<JsonResponse>;
  requestUrlFn?: (opts: {
    url: string;
    method: string;
    headers: Record<string, string>;
    throw?: boolean;
  }) => Promise<{ status: number; text: string }>;
}

/** unknown → 记录（只认非数组的对象）；所有外部 JSON 都从这里开始收窄 */
function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 从一组条目里取 id / name 字符串（畸形项跳过） */
function idsOf(list: unknown, key: 'id' | 'name'): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    const v = asRecord(raw)?.[key];
    if (typeof v === 'string' && v) out.push(v);
  }
  return out;
}

/** Ollama /api/tags 响应 → 模型 id 列表 */
function ollamaModelIds(data: unknown): string[] {
  const ids = idsOf(asRecord(data)?.models, 'name');
  if (ids.length) return ids;
  throw new Error(t('notice.ai.noModels'));
}

/** OpenAI 兼容 /models 响应 → 模型 id 列表（兼容 data[].id 与 data.models[].name） */
function openaiModelIds(data: unknown): string[] {
  const obj = asRecord(data);
  const ids = [...idsOf(obj?.data, 'id'), ...idsOf(obj?.models, 'name')];
  if (ids.length) return ids;
  throw new Error(t('notice.ai.noModels'));
}

/** 响应 → 模型 id 列表；空列表统一抛错（由调用方提示） */
export function parseModelList(desc: AIProviderDescriptor, data: unknown): string[] {
  return desc.id === 'ollama' ? ollamaModelIds(data) : openaiModelIds(data);
}

/** 缺省 fetch：window.fetch（弹窗窗口兼容），返回最小响应面 */
function defaultFetch(url: string, init?: FetchInit): Promise<JsonResponse> {
  return window.fetch(url, init as RequestInit).then((resp) => ({
    ok: resp.ok,
    status: resp.status,
    json: async (): Promise<unknown> => (await resp.json()) as unknown,
  }));
}

/** JSON 拉取（fetch 优先 → requestUrl 回退 → 超时/状态码报错） */
async function fetchModelsJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  label: string,
  deps: ModelsFetchDeps,
): Promise<unknown> {
  const fetchFn = deps.fetchFn || defaultFetch;
  const requestUrlFn = deps.requestUrlFn || requestUrl;

  let attempt: { resp: JsonResponse };
  {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      attempt = { resp: await fetchFn(url, { method: 'GET', headers, signal: controller.signal }) };
    } catch {
      if (controller.signal.aborted) {
        throw new Error(t('notice.ai.modelsTimeout', { name: label, sec: String(Math.round(timeoutMs / 1000)) }));
      }
      const r = await requestUrlFn({ url, method: 'GET', headers, throw: false });
      attempt = {
        resp: {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async (): Promise<unknown> => JSON.parse(r.text) as unknown,
        },
      };
    } finally {
      window.clearTimeout(timer);
    }
  }

  const { resp } = attempt;
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(t('notice.ai.modelsDenied', { name: label, status: String(resp.status) }));
    }
    if (resp.status === 404) throw new Error(t('notice.ai.models404', { name: label }));
    const err = asRecord(await resp.json());
    const msg = asRecord(err?.error)?.message;
    if (typeof msg === 'string') throw new Error(msg);
    throw new Error(`API ${resp.status}`);
  }
  return resp.json();
}

/** 拉取某服务商的模型列表（id 去重保序）。settings 为设置里的 ai 对象。 */
export async function fetchProviderModels(
  providerId: string,
  settings: AiSettingsLike = {},
  deps: ModelsFetchDeps = {},
): Promise<ModelOption[]> {
  const desc = getProviderDescriptor(providerId);
  const endpoint =
    desc.id === 'ollama'
      ? OLLAMA_BASE_URL
      : String(desc.id === 'custom' ? settings.baseUrl || '' : desc.endpoint)
          .trim()
          .replace(/\/+$/, '');
  if (!endpoint) throw new Error(t('notice.ai.noEndpoint'));

  const key =
    desc.id === 'custom'
      ? String(settings.apiKey || '').trim()
      : isNoAuthProvider(desc.id)
        ? ''
        : String(settings.apiKeys?.[desc.id] ?? '').trim();
  if (!key && !isNoAuthProvider(desc.id)) {
    throw new Error(t('notice.ai.noKey', { name: t(desc.labelKey), label: t(desc.apiKeyLabelKey) }));
  }

  const url = desc.id === 'ollama' ? `${endpoint}/api/tags` : `${endpoint}/models`;
  const headers: Record<string, string> = {};
  if (key && protocolOf(desc, settings) === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  const timeoutMs = desc.id === 'ollama' ? OLLAMA_TIMEOUT_MS : MODELS_TIMEOUT_MS;

  const data = await fetchModelsJson(url, headers, timeoutMs, t(desc.labelKey), deps);
  const ids = parseModelList(desc, data);
  const seen = new Set<string>();
  return ids
    .filter((m) => (seen.has(m) ? false : (seen.add(m), true)))
    .map((m) => ({ id: m, detail: t(desc.labelKey) }));
}

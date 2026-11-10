/* ============================================================
 * bz-reader · AI 模型列表拉取（data/ai-models.ts）
 *
 * 「获取模型」按钮背后的纯数据层：向当前服务商要一份模型名清单，摊给弹窗
 * 让用户挑。不碰 DOM、不弹通知——报错文案抛给调用方，由设置页统一提示。
 *
 * 两种接口形态（与 data/ai-providers 的 listApi 对齐）：
 *   · OpenAI 兼容：GET {地址}/models，Bearer 鉴权，取 data[].id；
 *   · Ollama：GET {根}/api/tags，无鉴权，取 models[].name。
 * 拉不到不是死路：设置页的模型框始终能手填——有的服务商根本没有这个接口。
 * ============================================================ */
import type { AiModelsApi } from './ai-providers';

/** 拉取超时（秒级交互：8 秒没应答就当对方不支持/网络断了，别让按钮一直转） */
export const MODELS_TIMEOUT_MS = 8000;

/** 一次拉取的目标（由 resolveAi + 服务商表拼出来） */
export interface ModelsTarget {
  listApi: AiModelsApi;
  baseUrl: string;
  apiKey: string;
}

/** 网络通道注入（测试桩；缺省用全局 fetch） */
export interface ModelsFetchDeps {
  /** 最小响应面：ok/status/json（测试桩无需完整 Response） */
  fetchFn?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  timeoutMs?: number;
}

/**
 * 列表端点。
 *
 * Ollama 的 /api/tags 挂在服务根地址上，不在 /v1 兼容面下面；注册表里的地址
 * 是 /v1 那一份（对话用），这里要把后缀去掉。只认结尾的 /v1——用户自己填
 * 自定义地址时带了别的路径，原样保留，不替人猜。
 */
export function modelsUrlOf(api: AiModelsApi, baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (api === 'ollama') return `${base.replace(/\/v1$/i, '')}/api/tags`;
  return `${base}/models`;
}

/** 从服务商返回的 JSON 里取模型名：去重、保序、跳过畸形项 */
export function parseModelList(api: AiModelsApi, data: unknown): string[] {
  const ids: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) ids.push(v.trim());
  };
  if (api === 'ollama') {
    const list = (data as { models?: unknown })?.models;
    if (Array.isArray(list)) {
      for (const m of list) {
        const rec = m as { name?: unknown; model?: unknown };
        push(rec?.name ?? rec?.model);
      }
    }
  } else {
    const rec = data as { data?: unknown; models?: unknown };
    if (Array.isArray(rec?.data)) {
      for (const m of rec.data) push((m as { id?: unknown })?.id);
    } else if (Array.isArray(rec?.models)) {
      for (const m of rec.models) push((m as { name?: unknown })?.name);
    }
  }
  const seen = new Set<string>();
  const out = ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  if (!out.length) throw new Error('这个服务商没有返回可用的模型');
  return out;
}

/**
 * 拉当前服务商的模型列表（名字去重保序）。
 *
 * 失败一律抛人话：缺地址让人去填、401/403 是密钥、404 是这家没有列表接口、
 * 超时是网络。调用方把这些直接给用户看，不吞成「获取失败」。
 */
export async function fetchProviderModels(target: ModelsTarget, deps: ModelsFetchDeps = {}): Promise<string[]> {
  const baseUrl = target.baseUrl.trim();
  if (!baseUrl) throw new Error('还没填接口地址：到 书架 · 设置 的「AI 助手」里填上服务商地址');
  const url = modelsUrlOf(target.listApi, baseUrl);
  const timeoutMs = deps.timeoutMs ?? MODELS_TIMEOUT_MS;
  const fetchFn = deps.fetchFn || ((u: string, init?: RequestInit) => window.fetch(u, init));

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`;

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  let res: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    res = await fetchFn(url, { method: 'GET', headers, signal: ctrl.signal });
  } catch (e) {
    const name = (e as Error)?.name || '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new Error(`服务商 ${timeoutMs / 1000} 秒没有响应，检查地址与网络后重试`);
    }
    throw new Error(`连不上服务商：${(e as Error)?.message || '网络错误'}`);
  } finally {
    window.clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`服务商拒绝访问（${res.status}）：检查密钥是否填对`);
    }
    if (res.status === 404) {
      throw new Error('这个服务商不支持模型列表接口（404），可以直接手填模型名');
    }
    let msg = `服务商返回 ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: unknown } };
      if (typeof body?.error?.message === 'string' && body.error.message) msg = body.error.message;
    } catch {
      /* 保留状态码 */
    }
    throw new Error(msg);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('服务商返回的不是 JSON，可能地址填错了');
  }
  return parseModelList(target.listApi, data);
}

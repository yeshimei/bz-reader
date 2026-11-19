/* ============================================================
 * bz-reader · 跨插件共享 AI 配置（data/ai-share.ts）
 *
 * 2026-11-19 用户口径：两个插件（bz Reader / bz Review）各自都有一套 AI
 * 配置，但用户通常只在一边填过。开一个「共享」开关后，自己没配就借用
 * 对方的——任一边配好，另一边就能用。
 *
 * 三条硬口径：
 *   1. **只读**：借来的配置只活在内存里，不写回自己的设置，也不改对方
 *      的文件；用户关掉开关就立刻回到「各用各的」。
 *   2. **只借能用的**：对方填了服务商却没填密钥这类半成品一律不借，
 *      否则会出现「共享开着、按钮还是点不动」的假象。
 *   3. **读不到就安静放弃**：对方没装 / 文件还在写 / JSON 坏了，都当
 *      没有共享配置处理，绝不把一次加入复习卡崩在跨插件读盘上。
 * ============================================================ */
import type { App } from 'obsidian';
import { tryGetApp } from '../core/app';
import { aiReadyOf } from './ai-providers';
import type { AiSettings } from './settings';

/** bz Review 的插件 id（目录名可以改，id 不会） */
export const SHARE_PLUGIN_ID = 'bz-review';

/** 借来的配置多久重新读一次（用户刚在另一边填完，不该等太久） */
const TTL_MS = 5000;

let cached: AiSettings | null = null;
let cachedAt = 0;
let inFlight: Promise<AiSettings | null> | null = null;

/** 测试用：直接塞一份「对方配置」，不碰文件系统 */
export function __setSharedAiForTests(ai: AiSettings | null): void {
  cached = ai;
  cachedAt = Date.now();
  inFlight = null;
}

/** 测试用：清空缓存 */
export function __resetSharedAiForTests(): void {
  cached = null;
  cachedAt = 0;
  inFlight = null;
}

/** 当前缓存里的「对方配置」（同步，供 aiReady 这类同步判据用） */
export function sharedAi(): AiSettings | null {
  return cached;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const s = str(val);
    if (k && s) out[k] = s;
  }
  return out;
}

function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(val);
    if (k && Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

/**
 * 把 bz Review 的 data.json 映射成本插件认的 AiSettings。
 *
 * 两边服务商注册表的 id 是同一套（deepseek / zhipu / custom …），所以可以
 * 原样搬 id；只是字段名不同，外加 Review 还留着三个老的单独密钥槽位，
 * 有值就并进 apiKeys。纯函数，不认识的东西一律丢掉。
 */
export function borrowAiFromReview(raw: unknown): AiSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const apiKeys = strMap(r.aiApiKeys);
  const legacyDeepseek = str(r.deepseekApiKey);
  const legacyZhipuPlan = str(r.zhipuPlanApiKey);
  const legacyOllama = str(r.ollamaApiKey);
  if (legacyDeepseek && !apiKeys.deepseek) apiKeys.deepseek = legacyDeepseek;
  if (legacyZhipuPlan && !apiKeys['zhipu-plan']) apiKeys['zhipu-plan'] = legacyZhipuPlan;
  if (legacyOllama && !apiKeys.ollama) apiKeys.ollama = legacyOllama;

  const modelOverrides = strMap(r.aiModelOverrides);
  const endpoint = str(r.aiCustomEndpoint);
  const customKey = str(r.aiCustomApiKey);
  const rawProvider = str(r.aiProvider);
  /* 没有服务商却填了自定义地址：与 Review 侧同口径，当自定义通道用 */
  const provider = rawProvider || (endpoint ? 'custom' : '');
  if (!provider) return null;

  const customProtocol = str(r.aiCustomProtocol) === 'anthropic' ? 'anthropic' : 'openai';

  return {
    provider,
    baseUrl: endpoint,
    apiKey: customKey,
    model: str(modelOverrides.custom),
    apiKeys,
    customProtocol,
    modelOverrides,
    maxTokensOverrides: numMap(r.aiMaxTokensOverrides),
    thinkingOverrides: strMap(r.aiThinkingOverrides),
  };
}

/** 插件真实目录名（用户可以在 .obsidian/plugins 里改目录，id 不会变） */
function pluginDirOf(app: App, id: string): string {
  const manifests = (app as unknown as {
    plugins?: { manifests?: Record<string, { dir?: string }> };
  })?.plugins?.manifests;
  const dir = manifests?.[id]?.dir;
  return String(dir || id);
}

/**
 * 读一次对方的 data.json 并缓存。
 *
 * 返回 null 有五种可能：开关没开（调用方先判）/ 对方没装 / 读不到 /
 * JSON 坏了 / 对方的配置本身不完整。对调用方来说这些是同一种结果：
 * 没有可借的配置。
 */
export async function ensureSharedAi(app?: App | null, force = false): Promise<AiSettings | null> {
  const now = Date.now();
  if (!force && now - cachedAt < TTL_MS) return cached;
  if (inFlight) return inFlight;

  const host = app ?? tryGetApp();
  if (!host) {
    cached = null;
    cachedAt = now;
    return null;
  }

  const path = `${host.vault.configDir}/plugins/${pluginDirOf(host, SHARE_PLUGIN_ID)}/data.json`;
  inFlight = (async () => {
    let next: AiSettings | null = null;
    try {
      const text = await host.vault.adapter.read(path);
      const mapped = borrowAiFromReview(JSON.parse(text) as unknown);
      /* 半成品不借：共享开着却因为对方缺密钥点不动按钮，比不共享更让人困惑 */
      next = mapped && aiReadyOf(mapped) ? mapped : null;
    } catch {
      next = null;
    }
    cached = next;
    cachedAt = Date.now();
    inFlight = null;
    return next;
  })();
  return inFlight;
}

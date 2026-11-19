/* ============================================================
 * bz-reader · AI 设置输入路径（data/ai-setting-path.ts）
 *
 * 设置页每个输入框挂 data-k，dispatchInput 把它交给这里落盘。注册表移植后
 * 密钥 / 模型 / token / 思考档位按服务商分表，custom 复用旧三件套——路径
 * 解析单独抽成纯函数，避免动作层写一堆分支，测试也能直接钉。
 * ============================================================ */
import type { AiSettings } from './settings';

const TABLE_FIELDS = ['apiKeys', 'modelOverrides', 'maxTokensOverrides', 'thinkingOverrides'] as const;

/**
 * 把一条 `ai.*` 路径写进设置，返回新的 ai 对象；不认识的路径返回 null
 * （调用方据此决定要不要落盘）。
 * 空值 = 清除这一项的覆盖，回落注册表默认。
 */
export function applyAiSettingPath(ai: AiSettings, k: string, value: string): AiSettings | null {
  if (k === 'ai.baseUrl' || k === 'ai.apiKey' || k === 'ai.model' || k === 'ai.provider') {
    return { ...ai, [k.slice(3)]: value.trim() };
  }
  if (k === 'ai.customProtocol') {
    return { ...ai, customProtocol: value === 'anthropic' ? 'anthropic' : 'openai' };
  }

  for (const field of TABLE_FIELDS) {
    const prefix = `ai.${field}.`;
    if (!k.startsWith(prefix)) continue;
    const id = k.slice(prefix.length);
    if (!id) return null;

    if (field === 'maxTokensOverrides') {
      const n = Number(value);
      const next = { ...ai.maxTokensOverrides };
      if (Number.isFinite(n) && n > 0) next[id] = n;
      else delete next[id];
      return { ...ai, maxTokensOverrides: next };
    }

    const next = { ...ai[field] };
    const v = value.trim();
    if (v) next[id] = v;
    else delete next[id];
    return { ...ai, [field]: next };
  }
  return null;
}

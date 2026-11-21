/**
 * AI 服务商注册表（tests/ai-providers.test.ts）
 *
 * 从 bz 主仓移植的纯数据层：18 家服务商 + 思考档位 + max_tokens 护栏，
 * 全部收在 reader 自己的 src/data/ai-providers.ts（不 import 另一个仓）。
 * 这里钉用户可见的契约：有哪些家、各家档位、解析出的请求参数。
 */
import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDER_REGISTRY,
  DEFAULT_AI_PROVIDER,
  getProviderDescriptor,
  maxOutputCapOf,
  resolveAiConfig,
  thinkingBodyFor,
  thinkingLevelsOf,
  type AiSettingsLike,
} from '../src/data/ai-providers';

const ids = AI_PROVIDER_REGISTRY.map((p) => p.id);

describe('服务商注册表', () => {
  it('恰好 18 家，覆盖老三家 / 国内 / 海外 / 本地 / 自定义', () => {
    expect(AI_PROVIDER_REGISTRY).toHaveLength(18);
    expect(ids).toEqual([
      'deepseek', 'zhipu-plan', 'ollama',
      'zhipu', 'qwen', 'kimi', 'siliconflow', 'volcengine', 'stepfun',
      'openai', 'anthropic', 'google', 'xai', 'mistral', 'groq', 'openrouter',
      'lmstudio', 'custom',
    ]);
  });

  it('缺省是 deepseek；未知 id 回落缺省，不抛错', () => {
    expect(DEFAULT_AI_PROVIDER).toBe('deepseek');
    expect(getProviderDescriptor('no-such').id).toBe('deepseek');
    expect(getProviderDescriptor(undefined).id).toBe('deepseek');
  });

  it('只有 Claude 常驻通道走 anthropic 协议', () => {
    expect(getProviderDescriptor('anthropic').protocol).toBe('anthropic');
    expect(getProviderDescriptor('deepseek').protocol).toBeUndefined();
    expect(getProviderDescriptor('custom').protocol).toBe('openai');
  });
});

describe('思考档位（逐家不同，来自注册表单一事实源）', () => {
  it('deepseek 有「关闭」没有「中」', () => {
    const values = thinkingLevelsOf('deepseek').map((l) => l.value);
    expect(values).toEqual(['auto', 'off', 'low', 'high', 'max']);
  });

  it('智谱 Plan 强制思考，没有关闭档', () => {
    expect(thinkingLevelsOf('zhipu-plan').map((l) => l.value)).not.toContain('off');
  });

  it('Ollama 有「中」没有「最高」', () => {
    const values = thinkingLevelsOf('ollama').map((l) => l.value);
    expect(values).toContain('medium');
    expect(values).not.toContain('max');
  });

  it('自定义没有固定口径，不列档位', () => {
    expect(thinkingLevelsOf('custom')).toEqual([]);
  });

  it('档位值 → 请求体：deepseek 开关 + 强度', () => {
    expect(thinkingBodyFor('deepseek', 'off')).toEqual({ thinking: { type: 'disabled' } });
    expect(thinkingBodyFor('deepseek', 'high')).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
    expect(thinkingBodyFor('ollama', 'medium')).toEqual({ reasoning_effort: 'medium' });
    expect(thinkingBodyFor('zhipu-plan', 'low')).toEqual({ reasoning_effort: 'low' });
  });

  it('auto / 未知档 / 无 provider 身份都不注入', () => {
    expect(thinkingBodyFor('deepseek', 'auto')).toBeNull();
    expect(thinkingBodyFor('zhipu-plan', 'off')).toBeNull();
    expect(thinkingBodyFor(undefined, 'low')).toBeNull();
  });
});

describe('输出上限护栏', () => {
  it('按当前模型名查官方档，查不到回退该家护栏', () => {
    expect(maxOutputCapOf('openai', 'gpt-4o-mini')).toBe(16384);
    expect(maxOutputCapOf('deepseek', 'deepseek-flash')).toBe(393216);
    expect(maxOutputCapOf('zhipu', 'glm-5.3-flash')).toBe(131072);
  });

  it('本地 / 自定义没有官方上限，返回 undefined（尊重面板设置）', () => {
    expect(maxOutputCapOf('ollama', 'llama3.1')).toBeUndefined();
    expect(maxOutputCapOf('custom', 'whatever')).toBeUndefined();
  });
});

describe('请求参数解析 resolveAiConfig', () => {
  const base = (): AiSettingsLike => ({
    provider: 'deepseek',
    baseUrl: '',
    apiKey: '',
    model: '',
    apiKeys: {},
    customProtocol: 'openai',
    modelOverrides: {},
    maxTokensOverrides: {},
    thinkingOverrides: {},
  });

  it('缺省 deepseek：官方端点、密钥来自 apiKeys 表、上限取护栏', () => {
    const s = base();
    s.apiKeys = { deepseek: 'sk-ds' };
    const c = resolveAiConfig(s);
    expect(c.id).toBe('deepseek');
    expect(c.endpoint).toBe('https://api.deepseek.com');
    expect(c.apiKey).toBe('sk-ds');
    /* 默认模型必须有值：reader 不像 bz 有调用方兜底，留空会让只填密钥的
       默认服务商被判「未配置」，AI 整组不可用（2026-11-21 修）。 */
    expect(c.model).toBe('deepseek-chat');
    expect(c.maxTokens).toBe(393216);
    expect(c.protocol).toBe('openai');
  });

  it('自定义读取旧三件套地址 / 密钥 / 模型，协议随设置切换', () => {
    const s = base();
    s.provider = 'custom';
    s.baseUrl = 'https://proxy.example.com/v1/';
    s.apiKey = 'sk-x';
    s.model = 'my-model';
    s.customProtocol = 'anthropic';
    const c = resolveAiConfig(s);
    expect(c.endpoint).toBe('https://proxy.example.com/v1');
    expect(c.apiKey).toBe('sk-x');
    expect(c.model).toBe('my-model');
    expect(c.protocol).toBe('anthropic');
    expect(c.maxTokens).toBe(8192); // 自定义无官方上限 → 注册表兜底档
  });

  it('per-provider 覆盖优先，且被模型官方上限封顶', () => {
    const s = base();
    s.provider = 'openai';
    s.apiKeys = { openai: 'sk-o' };
    s.modelOverrides = { openai: 'gpt-4o-mini' };
    s.maxTokensOverrides = { openai: 99999 };
    const c = resolveAiConfig(s);
    expect(c.model).toBe('gpt-4o-mini');
    expect(c.maxTokens).toBe(16384);
  });

  it('无官方上限的通道尊重面板设置值', () => {
    const s = base();
    s.provider = 'custom';
    s.baseUrl = 'https://x/v1';
    s.apiKey = 'sk-x';
    s.model = 'm';
    s.maxTokensOverrides = { custom: 50000 };
    expect(resolveAiConfig(s).maxTokens).toBe(50000);
  });

  it('思考档位按当前 provider 注入请求体', () => {
    const s = base();
    s.thinkingOverrides = { deepseek: 'low' };
    expect(resolveAiConfig(s).thinkingBody).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    });
  });

  it('override 参数可临时指定别家，不改设置', () => {
    const s = base();
    s.apiKeys = { anthropic: 'sk-claude' };
    const c = resolveAiConfig(s, 'anthropic');
    expect(c.protocol).toBe('anthropic');
    expect(c.endpoint).toBe('https://api.anthropic.com/v1');
    expect(c.apiKey).toBe('sk-claude');
  });
});

/**
 * 模型 token 档位（tests/model-limits.test.ts）
 *
 * 从 bz 主仓搬来的 11 条官方档位：按模型名解析最大输出，供 max_tokens
 * 护栏与设置面板共用。只测纯函数，不碰网络。
 */
import { describe, expect, it } from 'vitest';
import { MODEL_LIMITS, normalizeModelId, resolveModelLimits } from '../src/core/model-limits';

describe('模型名归一化', () => {
  it('去 vendor 前缀、去 :tag、去空白、小写', () => {
    expect(normalizeModelId('  zai-org/GLM-5.3-Flash:free  ')).toBe('glm-5.3-flash');
    expect(normalizeModelId('deepseek-ai/DeepSeek-V3')).toBe('deepseek-v3');
    expect(normalizeModelId('')).toBe('');
  });
});

describe('档位表', () => {
  it('11 条在册条目', () => {
    expect(MODEL_LIMITS.length).toBe(11);
  });

  it('精确命中含别名', () => {
    expect(resolveModelLimits('deepseek-v4-flash')).toEqual({ maxOutput: 393216, contextWindow: 1048576 });
    expect(resolveModelLimits('kimi-k2')).toEqual({ maxOutput: 131072, contextWindow: 131072 });
  });

  it('带日期后缀的快照名落到最长命中键', () => {
    expect(resolveModelLimits('glm-5.3-flash-2026-09')?.maxOutput).toBe(131072);
  });

  it('未收录返回 null，不编兜底值', () => {
    expect(resolveModelLimits('unlisted-model-xyz')).toBeNull();
    expect(resolveModelLimits('')).toBeNull();
  });
});

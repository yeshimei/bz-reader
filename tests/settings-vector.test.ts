/**
 * 设置里不该再有的两项（tests/settings-vector.test.ts）
 *
 * 2026-11-07：向量改由第二大脑提供，本插件不再自己选嵌入模型；「连接至 BZ
 * AI 知识库」改成自动识别（检测到 bz 就连），也不该再有开关。
 *
 * 钉住的是**旧数据能安静地降级**：老用户的 data.json 里还留着这两个字段，
 * 读的时候必须丢掉，而不是带着它们继续跑（带 embedModel 会让人以为这里还
 * 能选模型；带 aiKnowledge 会出现「明明没开关却有个 true」）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, aiReady, normalizeSettings } from '../src/data/settings';

describe('设置项', () => {
  it('默认值里没有嵌入模型，也没有知识库开关', () => {
    expect(Object.keys(DEFAULT_SETTINGS.ai).sort()).toEqual(['apiKey', 'baseUrl', 'model']);
    expect('aiKnowledge' in DEFAULT_SETTINGS).toBe(false);
  });

  it('老 data.json 里的 embedModel / aiKnowledge 读进来就没了', () => {
    const s = normalizeSettings({
      ai: { baseUrl: 'https://api.x/v1', apiKey: 'k', model: 'chat-x', embedModel: 'text-embedding-3-small' },
      aiKnowledge: true,
    });
    expect('embedModel' in s.ai).toBe(false);
    expect('aiKnowledge' in s).toBe(false);
  });

  it('对话模型三样齐了就算可用（向量不再参与判断）', () => {
    expect(aiReady(normalizeSettings({ ai: { baseUrl: 'https://api.x/v1', apiKey: 'k', model: 'chat-x' } }))).toBe(true);
    expect(aiReady(normalizeSettings({ ai: { baseUrl: 'https://api.x/v1', apiKey: 'k', model: '' } }))).toBe(false);
  });
});

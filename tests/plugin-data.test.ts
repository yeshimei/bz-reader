import { describe, expect, it } from 'vitest';
import { normalizePluginData } from '../src/data/plugin-data';
import { DEFAULT_SETTINGS } from '../src/data/settings';

describe('data.json 收口径', () => {
  it('null / 不是对象 → 全默认值', () => {
    for (const raw of [null, undefined, 42, 'nope', []]) {
      const d = normalizePluginData(raw);
      expect(d.settings).toEqual(DEFAULT_SETTINGS);
      expect(d.dataDir).toBe('bz 阅读');
      expect(d.entitlement).toBeNull();
    }
  });

  it('settings 缺字段时补齐，设置页不会因为读 ai.baseUrl 白屏', () => {
    const d = normalizePluginData({ settings: { exportDir: '我的书摘' } });
    expect(d.settings.exportDir).toBe('我的书摘');
    expect(d.settings.ai.baseUrl).toBe('');
    expect(d.settings.ai.apiKey).toBe('');
  });

  it('dataDir 拒绝上跳与隐藏目录，正常目录原样保留', () => {
    expect(normalizePluginData({ dataDir: '../外面' }).dataDir).toBe('bz 阅读');
    expect(normalizePluginData({ dataDir: '.obsidian/x' }).dataDir).toBe('bz 阅读');
    expect(normalizePluginData({ dataDir: '我的书库' }).dataDir).toBe('我的书库');
    expect(normalizePluginData({ dataDir: '/书库/子目录/' }).dataDir).toBe('书库/子目录');
  });

  it('settings 里不再有 license（授权只有一个真相）', () => {
    const d = normalizePluginData({ settings: { license: 'BZR1.x.y' } });
    expect('license' in d.settings).toBe(false);
  });

  it('entitlement 原样透传，不在这里解释形状', () => {
    const snap = { installId: 'i1', license: 'BZR1.a.b' };
    expect(normalizePluginData({ entitlement: snap }).entitlement).toEqual(snap);
  });
});

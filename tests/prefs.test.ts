import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_PREFS,
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  MARGIN_RANGE,
  LEGACY_THEMES,
  normalizePrefs,
} from '../src/data/prefs';

describe('normalizePrefs', () => {
  it('空输入给出默认值', () => {
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({})).toEqual(DEFAULT_PREFS);
  });

  it('字号被夹在合法区间并取整', () => {
    expect(normalizePrefs({ fontSize: 999 }).fontSize).toBe(FONT_SIZE_RANGE.max);
    expect(normalizePrefs({ fontSize: -5 }).fontSize).toBe(FONT_SIZE_RANGE.min);
    expect(normalizePrefs({ fontSize: 18.7 }).fontSize).toBe(19);
  });

  it('行高与页边距同样被夹住', () => {
    expect(normalizePrefs({ lineHeight: 0 }).lineHeight).toBe(LINE_HEIGHT_RANGE.min);
    expect(normalizePrefs({ lineHeight: 9 }).lineHeight).toBe(LINE_HEIGHT_RANGE.max);
    expect(normalizePrefs({ margin: 1 }).margin).toBe(MARGIN_RANGE.min);
    expect(normalizePrefs({ margin: 999 }).margin).toBe(MARGIN_RANGE.max);
  });

  it('枚举值非法时回落到默认值', () => {
    const p = normalizePrefs({ accent: 'rainbow', fontFamily: 'comic', layout: 'diagonal' });
    expect(p.accent).toBe(DEFAULT_PREFS.accent);
    expect(p.fontFamily).toBe(DEFAULT_PREFS.fontFamily);
    expect(p.layout).toBe(DEFAULT_PREFS.layout);
  });

  it('旧主题名（已撤掉的五套皮肤）不会被当成脏数据', () => {
    /* ReaderPrefs 已经没有 theme 字段了，所谓迁移其实是「不认识的值一律回落到
       默认」。这里断言真实行为：带旧 theme 的旧配置仍能正常归一化，其余字段不丢。 */
    for (const legacy of LEGACY_THEMES) {
      const p = normalizePrefs({ theme: legacy, fontSize: 22 } as unknown as Record<string, unknown>);
      expect(p.fontSize).toBe(22);
      expect(p.accent).toBe(DEFAULT_PREFS.accent);
      expect(Object.keys(p)).not.toContain('theme');
    }
  });

  it('不修改传入对象', () => {
    const raw = { fontSize: 20 };
    const before = JSON.stringify(raw);
    normalizePrefs(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('翻页 / 滚动模式：只认 paged / scroll，其它退回分页', () => {
    expect(DEFAULT_PREFS.flow).toBe('paged');
    expect(normalizePrefs({ flow: 'scroll' }).flow).toBe('scroll');
    expect(normalizePrefs({ flow: 'paged' }).flow).toBe('paged');
    expect(normalizePrefs({ flow: 'nope' }).flow).toBe('paged');
  });
});

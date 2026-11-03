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

  it('旧主题名被迁移到新配色', () => {
    const legacy = [...LEGACY_THEMES][0];
    if (legacy) {
      const p = normalizePrefs({ theme: legacy } as unknown as Record<string, unknown>);
      expect(LEGACY_THEMES.has(String(p.theme))).toBe(false);
    }
  });

  it('不修改传入对象', () => {
    const raw = { fontSize: 20 };
    const before = JSON.stringify(raw);
    normalizePrefs(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

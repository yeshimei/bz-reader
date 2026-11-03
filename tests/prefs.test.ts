import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_PREFS,
  FONT_FAMILIES,
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
});

/**
 * 正文口径（ui-spec「尺寸口径」）：桌面 18px / 行高 2.05 / 单栏 648px。
 * 行高这条踩过：按 0.1 取整会把 2.05 存成 2.1，界面上永远显示不出定稿值。
 */
describe('正文口径', () => {
  it('默认行高就是 2.05', () => {
    expect(DEFAULT_PREFS.lineHeight).toBe(2.05);
    expect(DEFAULT_PREFS.fontSize).toBe(18);
  });

  it('2.05 存取一个来回不被改掉', () => {
    expect(normalizePrefs({ lineHeight: 2.05 }).lineHeight).toBe(2.05);
  });

  it('行高按 0.05 取整（滑块步长同档）', () => {
    expect(LINE_HEIGHT_RANGE.step).toBe(0.05);
    expect(normalizePrefs({ lineHeight: 1.97 }).lineHeight).toBe(1.95);
    expect(normalizePrefs({ lineHeight: 1.98 }).lineHeight).toBe(2);
  });

  it('字体只写两个字：宋体 / 黑体', () => {
    const labels = FONT_FAMILIES.map((f) => f.label);
    expect(labels).toEqual(['跟随书籍', '宋体', '黑体']);
  });
});

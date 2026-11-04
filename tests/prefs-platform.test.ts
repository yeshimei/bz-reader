import { describe, expect, it } from 'vitest';
import { ACCENT_OPTIONS, accentLabel, DEFAULT_PREFS, pickPrefs } from '../src/data/prefs';

/**
 * 桌面与移动各一套偏好：同一份数据文件里两个槽，互不覆盖。
 * 升级前只有一份全局 `prefs`，它只当迁移源。
 */
describe('pickPrefs：按平台取偏好', () => {
  it('桌面读 prefsDesktop，移动读 prefsMobile', () => {
    const data = { prefsDesktop: { fontSize: 20 }, prefsMobile: { fontSize: 15 } };
    expect(pickPrefs(data, false).fontSize).toBe(20);
    expect(pickPrefs(data, true).fontSize).toBe(15);
  });

  it('本平台槽为空时回退旧的全局 prefs（升级不丢设置）', () => {
    const data = { prefs: { fontSize: 18 } };
    expect(pickPrefs(data, false).fontSize).toBe(18);
    expect(pickPrefs(data, true).fontSize).toBe(18);
  });

  it('两个槽互不影响：一个改了另一个仍是原值', () => {
    const data: Record<string, unknown> = {
      prefsDesktop: { ...DEFAULT_PREFS, fontSize: 22 },
      prefsMobile: { ...DEFAULT_PREFS, fontSize: 14 },
    };
    expect(pickPrefs(data, false).fontSize).toBe(22);
    expect(pickPrefs(data, true).fontSize).toBe(14);
    expect(pickPrefs(data, false).fontSize).toBe(22);
  });

  it('坏数据落回默认值', () => {
    expect(pickPrefs({ prefsMobile: { fontSize: 999 } }, true).fontSize).toBe(30);
    expect(pickPrefs(null, false).fontSize).toBe(DEFAULT_PREFS.fontSize);
  });
});

describe('强调色', () => {
  /* 2026-11-05：第一档改回「跟随 Obsidian」。「原生」是内部说法——用户看不出
     它跟设置页里任何一个开关有关，反倒要猜「原生」是谁的。 */
  it('八档，第一档叫「跟随 Obsidian」', () => {
    expect(ACCENT_OPTIONS).toHaveLength(8);
    expect(ACCENT_OPTIONS[0].value).toBe('auto');
    expect(accentLabel('auto')).toBe('跟随 Obsidian');
    expect(ACCENT_OPTIONS.map((a) => accentLabel(a.value))).not.toContain('原生');
  });
});

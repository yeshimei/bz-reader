/**
 * 界面语言偏好（tests/language.test.ts）
 *
 * 两件事在这里定死：
 *   1. `auto` 是**跟随宿主**，手动选择永远优先于宿主——用户特意选了中文，
 *      换台英文 Obsidian 不该把界面翻回去。
 *   2. `auto` 但读不到宿主语言时**退回中文**，不是英文：现网用户全是中文，
 *      探测失败是异常环境，异常时不能把人扔进英文界面。
 */
import { describe, expect, it } from 'vitest';
import { resolveLocale } from '../src/i18n';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/data/settings';

describe('resolveLocale · 手动偏好与宿主语言', () => {
  it('auto 跟随宿主', () => {
    expect(resolveLocale('auto', 'zh-TW')).toBe('zh-TW');
    expect(resolveLocale('auto', 'zh-CN')).toBe('zh');
    expect(resolveLocale('auto', 'en-US')).toBe('en');
    expect(resolveLocale('auto', 'en-GB')).toBe('en');
    expect(resolveLocale('auto', 'ja-JP')).toBe('ja');
    expect(resolveLocale('auto', 'de')).toBe('de');
    expect(resolveLocale('auto', 'pt-BR')).toBe('pt');
  });

  it('auto + 宿主语言没有对应的包 → 英文', () => {
    expect(resolveLocale('auto', 'ko')).toBe('en');
    expect(resolveLocale('auto', 'ar')).toBe('en');
  });

  it('auto + 读不到宿主 → 中文', () => {
    expect(resolveLocale('auto', '')).toBe('zh');
    expect(resolveLocale('auto', null)).toBe('zh');
    expect(resolveLocale('auto', undefined)).toBe('zh');
    expect(resolveLocale('auto', '   ')).toBe('zh');
  });

  it('手动选了就不再看宿主', () => {
    expect(resolveLocale('zh', 'en-US')).toBe('zh');
    expect(resolveLocale('en', 'zh-CN')).toBe('en');
    expect(resolveLocale('ja', 'en-US')).toBe('ja');
    expect(resolveLocale('zh-TW', 'zh-CN')).toBe('zh-TW');
    expect(resolveLocale('en', '')).toBe('en');
  });
});

describe('settings.language', () => {
  it('默认跟随宿主', () => {
    expect(DEFAULT_SETTINGS.language).toBe('auto');
    expect(normalizeSettings(null).language).toBe('auto');
    expect(normalizeSettings({}).language).toBe('auto');
  });

  it('八种语言都认得，其余一律 auto', () => {
    for (const l of ['zh', 'zh-TW', 'en', 'ja', 'de', 'fr', 'es', 'pt']) {
      expect(normalizeSettings({ language: l }).language, l).toBe(l);
    }
    expect(normalizeSettings({ language: 'auto' }).language).toBe('auto');
  });

  it('脏值一律退回 auto：手改 JSON、旧版本没有这个字段、写了个别的语言', () => {
    expect(normalizeSettings({ language: 'klingon' }).language).toBe('auto');
    expect(normalizeSettings({ language: 42 }).language).toBe('auto');
    expect(normalizeSettings({ language: null }).language).toBe('auto');
    expect(normalizeSettings({ language: {} }).language).toBe('auto');
  });
});

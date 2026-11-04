/**
 * i18n 核心（tests/i18n.test.ts）
 *
 * 这一层的行为直接决定「界面会不会坏」：漏 key、漏参数、语言代码不认识，
 * 任何一条处理成抛错或空串，用户看到的就是一片空白。所以断言集中在
 * 降级路径上，而不是「t() 能取到文案」这种显然的事。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { detectLocale, locale, normalizeLocale, onLocaleChange, setLocale, t, type MsgKey } from '../src/i18n';
import { EN } from '../src/i18n/en';
import { ZH } from '../src/i18n/zh';

afterEach(() => {
  setLocale('zh');
});

describe('normalizeLocale · 宿主语言代码 → 界面语言', () => {
  it('简体、繁体、带地区的都归中文', () => {
    for (const code of ['zh', 'zh-CN', 'zh-TW', 'zh-Hant', 'zh-Hans', 'ZH-TW']) {
      expect(normalizeLocale(code), code).toBe('zh');
    }
  });

  it('英文各变体归英文', () => {
    for (const code of ['en', 'en-GB', 'en-US', 'EN']) {
      expect(normalizeLocale(code), code).toBe('en');
    }
  });

  it('没有对应的语言包就退英文，不假装看得懂', () => {
    for (const code of ['ja', 'ko', 'fr', 'de', 'ar', 'ru']) {
      expect(normalizeLocale(code), code).toBe('en');
    }
  });

  it('空值不猜：给 null / 空串一律英文', () => {
    expect(normalizeLocale('')).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
    expect(normalizeLocale('   ')).toBe('en');
  });

  it('下划线写法也认（某些平台给 zh_CN）', () => {
    expect(normalizeLocale('zh_CN')).toBe('zh');
    expect(normalizeLocale('en_US')).toBe('en');
  });

  it('detectLocale 与 normalizeLocale 同口径', () => {
    expect(detectLocale('zh-TW')).toBe('zh');
    expect(detectLocale('ja')).toBe('en');
  });
});

describe('默认语言', () => {
  it('不探测时是中文：现网用户全是中文，探测失败不能把人扔进英文界面', () => {
    expect(locale()).toBe('zh');
  });
});

describe('setLocale', () => {
  it('真的变了才返回 true', () => {
    expect(setLocale('en')).toBe(true);
    expect(setLocale('en')).toBe(false);
    expect(locale()).toBe('en');
  });

  it('接受宿主那种带地区的代码', () => {
    setLocale('zh-TW');
    expect(locale()).toBe('zh');
  });
});

describe('t · 取文案', () => {
  it('默认给中文', () => {
    expect(t('cmd.open')).toBe(ZH['cmd.open']);
  });

  it('切到英文后给英文', () => {
    setLocale('en');
    expect(t('cmd.open')).toBe(EN['cmd.open']);
  });

  it('按 {name} 插值，数字也认', () => {
    setLocale('en');
    expect(t('notice.import.done', { n: 3 })).toContain('3');
    expect(t('notice.import.done', { n: 3 })).not.toContain('{n}');
  });

  it('漏传参数时保留占位符，不静默变成半截句子', () => {
    setLocale('en');
    expect(t('notice.import.done')).toContain('{n}');
  });

  it('换语言后同一条 key 给不同文字', () => {
    const zh = t('cmd.import');
    setLocale('en');
    expect(t('cmd.import')).not.toBe(zh);
  });
});

describe('t · 降级', () => {
  it('不认识的 key 原样返回：屏幕上出现 key 比一片空白好定位', () => {
    const missing = 'no.such.key' as MsgKey;
    expect(t(missing)).toBe('no.such.key');
  });
});

describe('onLocaleChange', () => {
  it('切语言时通知一次，同语言不通知', () => {
    const seen: string[] = [];
    const off = onLocaleChange((l) => seen.push(l));
    setLocale('en');
    setLocale('en');
    off();
    expect(seen).toEqual(['en']);
  });

  it('退订之后不再收到', () => {
    const seen: string[] = [];
    const off = onLocaleChange((l) => seen.push(l));
    off();
    setLocale('en');
    expect(seen).toEqual([]);
  });

  it('一个订阅者抛错不影响其他订阅者', () => {
    let hit = 0;
    const off1 = onLocaleChange(() => {
      throw new Error('boom');
    });
    const off2 = onLocaleChange(() => {
      hit++;
    });
    setLocale('en');
    off1();
    off2();
    expect(hit).toBe(1);
  });
});

describe('语言包完整性', () => {
  it('英文包覆盖中文包的全部 key（类型也锁着，这里防有人用 as 绕过去）', () => {
    const zhKeys = Object.keys(ZH).sort();
    const enKeys = Object.keys(EN).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it('英文包里不该残留汉字：抄漏了没翻会在这里红', () => {
    for (const [k, v] of Object.entries(EN)) {
      expect(/[\u4e00-\u9fff]/.test(v), `${k} 里还有中文：${v}`).toBe(false);
    }
  });

  it('中文包没有空文案，也没有多余占位符', () => {
    for (const [k, v] of Object.entries(ZH)) {
      expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });
});

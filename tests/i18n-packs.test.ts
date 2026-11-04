/**
 * 八种语言包的完整性（tests/i18n-packs.test.ts）
 *
 * 类型层已经用 `Record<MsgKey, string>` 锁住「每种语言都要有这个 key」，
 * 但类型锁不住三件更阴的事：
 *   1. **占位符漏翻**——德语译者把 `{n}` 写成 `｛n｝` 或干脆丢了，界面就会
 *      显示「已导出  条划线」。类型完全看不出来。
 *   2. **抄漏**——补一条日文时顺手把英文原文粘过去，或者留着中文没翻。
 *      这种在中文环境里永远看不见，只有日语用户会看到。
 *   3. **空串**——留个 `''` 占位，类型是 string，界面是一片空白。
 *
 * 所以这三个断言是「语言包能不能上线」的闸门，不是补充测试。
 */
import { describe, expect, it } from 'vitest';
import { LOCALES, LOCALE_NAMES, PACK_OF as PACKS, locale, setLocale, t } from '../src/i18n';
import { ZH } from '../src/i18n/zh';

/** 取出文案里的占位符名，排序后比较——顺序不重要，集合才重要 */
function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

const CJK = /[\u4e00-\u9fff]/;
const KANA = /[\u3040-\u30ff]/;

describe('语言清单', () => {
  it('八种语言，顺序稳定（设置页按这个顺序铺）', () => {
    expect(LOCALES).toEqual(['zh', 'zh-TW', 'en', 'ja', 'de', 'fr', 'es', 'pt']);
  });

  it('每种语言都有自己的名字：德语界面里写 Deutsch，不是「德语」', () => {
    expect(LOCALE_NAMES.de).toBe('Deutsch');
    expect(LOCALE_NAMES.ja).toBe('日本語');
    expect(LOCALE_NAMES['zh-TW']).toBe('繁體中文');
    for (const l of LOCALES) expect(LOCALE_NAMES[l]?.trim().length, l).toBeGreaterThan(0);
  });
});

describe('语言包完整性', () => {
  it('每种语言的 key 集合与中文基准包完全一致', () => {
    const zhKeys = Object.keys(ZH).sort();
    for (const l of LOCALES) {
      expect(Object.keys(PACKS[l]).sort(), l).toEqual(zhKeys);
    }
  });

  it('没有空文案：留个空串在界面上就是一个洞', () => {
    for (const l of LOCALES) {
      for (const [k, v] of Object.entries(PACKS[l])) {
        expect(String(v).trim().length, `${l} ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('占位符与中文完全一致：漏一个 {n} 就是半截句子', () => {
    for (const l of LOCALES) {
      for (const [k, zhText] of Object.entries(ZH)) {
        expect(placeholders(String(PACKS[l][k])), `${l} ${k}`).toEqual(placeholders(zhText));
      }
    }
  });

  it('拉丁语系包里不该残留汉字：抄漏了没翻会在这里红', () => {
    for (const l of ['en', 'de', 'fr', 'es', 'pt'] as const) {
      for (const [k, v] of Object.entries(PACKS[l])) {
        expect(CJK.test(String(v)), `${l} ${k} 里还有中文：${v}`).toBe(false);
      }
    }
  });

  it('日语包确实是日语：一条假名都没有说明是英文原样抄过去的', () => {
    const values = Object.values(PACKS.ja).map(String);
    expect(values.some((v) => KANA.test(v))).toBe(true);
  });

  it('繁中包不是简中包的复制：多数条目写法必须不同', () => {
    /* 「六成不同」不是凑数：这 100 条里有一批专有名词与纯数字句（GitHub、
       Obsidian、`{n} 分钟`），它们简繁同形；如果九成以上都同形，那就是把
       zh.ts 复制了一份改文件名。 */
    const keys = Object.keys(ZH);
    const same = keys.filter((k) => PACKS['zh-TW'][k] === ZH[k]).length;
    expect(same / keys.length, `完全相同 ${same}/${keys.length}`).toBeLessThan(0.4);
  });

  it('繁中包不该出现简体字形：这/没/设/读/页/开/关…这些一个都不该有', () => {
    /* 只挑高频且**简繁必然异形**的字。不列「字」「除」这类同形字——
       拿它们当检测器会把正确的繁体文案判成错。 */
    const simplified = '这没设读页开闭删进时发实见语说请问题们个为与无从归应该处务单双变换选确输网录键链错';
    const hits = Object.entries(PACKS['zh-TW'])
      .filter(([, v]) => [...simplified].some((c) => String(v).includes(c)))
      .map(([k]) => k);
    expect(hits).toEqual([]);
  });
});

describe('t · 八种语言都能取到文案', () => {
  it('同一句命令名在八种语言下互不相同', () => {
    const seen = new Map<string, string>();
    for (const l of LOCALES) {
      setLocale(l);
      const text = t('cmd.open');
      expect(text.trim().length, l).toBeGreaterThan(0);
      seen.set(l, text);
    }
    setLocale('zh');
    /* 中文与繁中有可能撞（简繁同形），其余七种必须各不相同 */
    expect(new Set(seen.values()).size).toBeGreaterThanOrEqual(7);
  });

  it('日语界面下取到的是日语，不是英文兜底', () => {
    setLocale('ja');
    const text = t('notice.copy.ok');
    expect(KANA.test(text), text).toBe(true);
    setLocale('zh');
  });

  it('繁中与简中给的是两份不同的文案（不是同一份包的别名）', () => {
    setLocale('zh');
    const simplified = t('cmd.prefs');
    setLocale('zh-TW');
    const traditional = t('cmd.prefs');
    expect(traditional).not.toBe(simplified);
    setLocale('zh');
  });

  it('locale() 返回带地区的原样代码，不被压成 zh', () => {
    setLocale('zh-TW');
    expect(locale()).toBe('zh-TW');
    setLocale('zh');
    expect(locale()).toBe('zh');
  });
});

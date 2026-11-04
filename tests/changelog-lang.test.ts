/**
 * 更新日志的语言（tests/changelog-lang.test.ts）
 *
 * 更新日志是个**刻意开的例外**：它每次发版手写，八种语言维护一轮就是八倍的
 * 文案工作量，而读日志的人本来就知道自己在看什么。所以只做中文与英文两版：
 *   · zh / zh-TW  → 中文条目（繁中用户读简体条目，读得懂，比读英文好）
 *   · 其余六种语言 → 英文条目（英文是国际兜底，不是「假装看得懂」）
 *
 * 这个例外必须被测试钉住，否则半年后有人「顺手补齐八语日志」会发现
 * 每条日志都要写八遍。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { changelogLang, setLocale } from '../src/i18n';
import { CHANGELOG_RELEASES, type ChangelogRelease } from '../src/shell/changelog';

afterEach(() => setLocale('zh'));

describe('changelogLang', () => {
  it('中文与繁中都用中文条目', () => {
    setLocale('zh');
    expect(changelogLang()).toBe('zh');
    setLocale('zh-TW');
    expect(changelogLang()).toBe('zh');
  });

  it('其余六种语言都用英文条目', () => {
    for (const l of ['en', 'ja', 'de', 'fr', 'es', 'pt'] as const) {
      setLocale(l);
      expect(changelogLang(), l).toBe('en');
    }
  });
});

describe('内置日志数据', () => {
  it('每条日志都给了中文和英文两份，缺一份就是有语言看不到字', () => {
    const missing: string[] = [];
    for (const r of CHANGELOG_RELEASES) {
      for (const sec of ['added', 'improved', 'fixed'] as const) {
        for (const e of r[sec] ?? []) {
          for (const lang of ['zh', 'en'] as const) {
            if (!e.domain[lang]?.trim()) missing.push(`${r.version}/${sec}/domain/${lang}`);
            if (!e.text[lang]?.trim()) missing.push(`${r.version}/${sec}/text/${lang}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('英文那份不该残留汉字', () => {
    const hits: string[] = [];
    for (const r of CHANGELOG_RELEASES) {
      for (const sec of ['added', 'improved', 'fixed'] as const) {
        for (const e of r[sec] ?? []) {
          if (/[\u4e00-\u9fff]/.test(e.text.en)) hits.push(`${r.version} ${e.text.en}`);
          if (/[\u4e00-\u9fff]/.test(e.domain.en)) hits.push(`${r.version} ${e.domain.en}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('域名标签两版都要有（左侧那枚小标签不翻会很扎眼）', () => {
    for (const r of CHANGELOG_RELEASES) {
      for (const sec of ['added', 'improved', 'fixed'] as const) {
        for (const e of r[sec] ?? []) {
          expect(e.domain.zh.trim().length).toBeGreaterThan(0);
          expect(e.domain.en.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});

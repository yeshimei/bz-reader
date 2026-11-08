import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n';
import { cn } from '../src/shell/render/html';

/* ============================================================
 * 章节序号跟着界面语言走（D7）。
 *
 * 全书鸟瞰里那一列序号以前不论什么语言都写「一二三」，英文界面读起来是
 * 「Chapter 一」。中文数字只在 zh / zh-TW 下有意义，其余语言直接给数字。
 * ============================================================ */

afterEach(() => {
  setLocale('zh');
});

describe('章节序号', () => {
  it('中文下仍是中文数字', () => {
    setLocale('zh');
    expect(cn(1)).toBe('一');
    expect(cn(10)).toBe('十');
    expect(cn(11)).toBe('十一');
    expect(cn(23)).toBe('二十三');
  });

  it('繁体中文同样是中文数字', () => {
    setLocale('zh-TW');
    expect(cn(3)).toBe('三');
  });

  it('英文下给阿拉伯数字，不出「一」', () => {
    setLocale('en');
    expect(cn(1)).toBe('1');
    expect(cn(23)).toBe('23');
  });

  it('其它拉丁语系同理', () => {
    for (const l of ['de', 'fr', 'es', 'pt', 'ja'] as const) {
      setLocale(l);
      expect(cn(12), l).toBe('12');
    }
  });

  it('超过 99 一律阿拉伯数字（中文也没有习惯写法）', () => {
    setLocale('zh');
    expect(cn(120)).toBe('120');
  });
});

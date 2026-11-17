/**
 * 字体档「跟随 Obsidian」（tests/font-family-obsidian.test.ts）
 *
 * 书页正文在 iframe 里，宿主的 --font-text 跨不进去。所以这一档不能像
 * 其它档那样只把 CSS 变量写进样式串——必须在生成样式时把宿主当前字体
 * 栈读出来写死进 iframe。测试钉三件事：档位顺序、标签按界面语言走、
 * 注入时真的把字体栈带进书页。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LOCALES, setLocale } from '../src/i18n';
import { DEFAULT_PREFS, FONT_FAMILIES, fontLabel, normalizePrefs } from '../src/data/prefs';
import { buildChapterCSS } from '../src/engine/theme';
import { typographyFormHtml } from '../src/shell/overlay';
import { viewSettings } from '../src/shell/render/settings';
import { DEFAULT_SETTINGS } from '../src/data/settings';
import { installDomStub } from './helpers/dom-stub';

let restore = () => undefined;
beforeAll(() => {
  restore = installDomStub();
});
afterAll(() => restore());
afterEach(() => {
  setLocale('zh');
});

/** 临时替换 getComputedStyle，模拟宿主主题给出的字体栈 */
function withHostFont(value: string, run: () => void): void {
  const g = globalThis as unknown as { getComputedStyle: typeof getComputedStyle };
  const prev = g.getComputedStyle;
  g.getComputedStyle = () =>
    ({
      getPropertyValue: (k: string) => (k === '--font-text' ? value : ''),
      fontFamily: '',
    }) as unknown as CSSStyleDeclaration;
  try {
    run();
  } finally {
    g.getComputedStyle = prev;
  }
}

describe('字体档：跟随 Obsidian', () => {
  it('档位表里有它，且排在「跟随书籍」前面', () => {
    const values = FONT_FAMILIES.map((f) => f.value);
    expect(values).toContain('obsidian');
    expect(values.indexOf('obsidian')).toBeLessThan(values.indexOf('book'));
  });

  it('宿主侧这一档用 Obsidian 的 --font-text', () => {
    const f = FONT_FAMILIES.find((x) => x.value === 'obsidian');
    expect(f?.css).toContain('--font-text');
  });

  it('中文界面显示中文，英文界面显示英文', () => {
    setLocale('zh');
    expect(fontLabel('obsidian')).toBe('跟随 Obsidian');
    setLocale('en');
    expect(fontLabel('obsidian')).toBe('Follow Obsidian');
  });

  it('八种语言各有自己的文案，拉丁语系不出现汉字', () => {
    for (const l of LOCALES) {
      setLocale(l);
      const label = fontLabel('obsidian');
      expect(label.length).toBeGreaterThan(0);
      /* 日语用汉字（合わせる）是文字本身，不是没翻译的中文 */
      if (l !== 'zh' && l !== 'zh-TW' && l !== 'ja') expect(label).not.toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it('默认仍是跟随书籍；normalizePrefs 认得新档，垃圾值仍退回默认', () => {
    expect(DEFAULT_PREFS.fontFamily).toBe('book');
    expect(normalizePrefs({ fontFamily: 'obsidian' }).fontFamily).toBe('obsidian');
    expect(normalizePrefs({ fontFamily: 'not-a-font' }).fontFamily).toBe('book');
  });

  it('注入书页时把宿主当前字体栈写死进去', () => {
    withHostFont('"Segoe UI", "PingFang SC", sans-serif', () => {
      const css = buildChapterCSS({ ...DEFAULT_PREFS, fontFamily: 'obsidian' });
      expect(css).toContain('font-family: "Segoe UI", "PingFang SC", sans-serif !important');
    });
  });

  it('宿主字体串里的分号花括号会被滤掉，不能改写样式', () => {
    withHostFont('"Evil"; } body { color: red', () => {
      const css = buildChapterCSS({ ...DEFAULT_PREFS, fontFamily: 'obsidian' });
      expect(css).not.toContain('} body {');
      expect(css).not.toContain('color: red !important');
    });
  });

  it('其它档不受影响：跟随书籍不注入字体，宋体仍是中文宋体栈', () => {
    const book = buildChapterCSS({ ...DEFAULT_PREFS, fontFamily: 'book' });
    expect(book).not.toContain('font-family:');
    const serif = buildChapterCSS({ ...DEFAULT_PREFS, fontFamily: 'serif' });
    expect(serif).toContain('font-family: "Songti SC"');
  });

  it('设置页和排版浮窗都列出这一档，且都在「跟随书籍」前面', () => {
    const settingsHtml = viewSettings({
      prefs: { ...DEFAULT_PREFS, fontFamily: 'obsidian' },
      settings: DEFAULT_SETTINGS,
      pen: 'amber',
      hotkeys: [],
      relicense: false,
      version: '0.0.0',
    });
    const popupHtml = typographyFormHtml();
    for (const html of [settingsHtml, popupHtml]) {
      const i = html.indexOf('data-v="obsidian"');
      const j = html.indexOf('data-v="book"');
      expect(i).toBeGreaterThan(-1);
      expect(i).toBeLessThan(j);
      expect(html).toContain('跟随 Obsidian');
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installDomStub } from './helpers/dom-stub';
import { EMPTY_DATA, emptyNotes, emptyReading } from '../src/data/schema';
import { accentColor, buildChapterCSS } from '../src/engine/theme';
import { DEFAULT_PREFS, ACCENT_OPTIONS, normalizePrefs } from '../src/data/prefs';

describe('schema 空值工厂', () => {
  it('EMPTY_DATA 是独立对象', () => {
    expect(EMPTY_DATA.books).toEqual([]);
    expect(EMPTY_DATA.version).toBe(1);
  });

  it('emptyReading 每次返回新对象', () => {
    const a = emptyReading();
    const b = emptyReading();
    expect(a).not.toBe(b);
    a.position.percent = 0.5;
    expect(b.position.percent).toBe(0);
  });

  it('emptyNotes 三个容器都在', () => {
    const n = emptyNotes();
    expect(Array.isArray(n.highlights)).toBe(true);
    expect(Array.isArray(n.excerpts)).toBe(true);
    expect(Array.isArray(n.bookmarks)).toBe(true);
  });
});

let restore: () => void = () => undefined;
beforeAll(() => {
  restore = installDomStub();
});
afterAll(() => restore());

describe('accentColor', () => {
  it('每个配色都有值且区分明暗', () => {
    for (const opt of ACCENT_OPTIONS) {
      const light = accentColor(opt.value, false);
      const dark = accentColor(opt.value, true);
      expect(light).toMatch(/^#|rgb|hsl/);
      expect(dark).toMatch(/^#|rgb|hsl/);
    }
  });
});

describe('buildChapterCSS', () => {
  it('把字号、行高、页边距写进 CSS', () => {
    const prefs = normalizePrefs({ fontSize: 21, lineHeight: 2, margin: 40 });
    const css = buildChapterCSS(prefs);
    expect(css).toContain('21px');
    expect(css).toContain('2');
    expect(css).toContain('40px');
    expect(css).toContain('body');
  });

  it('不同字号产出的 CSS 不同（避免缓存串味）', () => {
    const a = buildChapterCSS({ ...DEFAULT_PREFS, fontSize: 16 });
    const b = buildChapterCSS({ ...DEFAULT_PREFS, fontSize: 24 });
    expect(a).not.toBe(b);
  });

  it('竖排时写入 writing-mode', () => {
    const css = buildChapterCSS({ ...DEFAULT_PREFS, layout: 'vertical' });
    expect(css).toContain('vertical');
  });
});

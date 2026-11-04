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

  it('滚动模式：上下边距写进 body 的 padding，且上下一样', () => {
    const css = buildChapterCSS({ ...DEFAULT_PREFS, flow: 'scroll', marginY: 64 });
    expect(css).toMatch(/padding-top:\s*64px/);
    expect(css).toMatch(/padding-bottom:\s*64px/);
  });

  it('分页模式：body 不再留上下 padding（每页留白交给分页器）', () => {
    /* 分页时 body 的 padding 只对章首页生效，章中页顶到边。
       两处都留就会在章首页叠成两倍。 */
    const css = buildChapterCSS({ ...DEFAULT_PREFS, flow: 'paged', marginY: 64 });
    expect(css).toMatch(/padding-top:\s*0px/);
    expect(css).toMatch(/padding-bottom:\s*0px/);
  });

  /**
   * 分页器每页的 padding 是 `var(--_pad-top) ... var(--_pad-bottom)`。
   * 变量必须定义在**书页文档**里：宿主元素上的 CSS 变量跨不进 iframe，
   * 以前写在 host.setCssProps 上，所以调上下边距从来没反应。
   */
  it('把上下边距写进书页文档的 --_pad-top / --_pad-bottom', () => {
    const css = buildChapterCSS({ ...DEFAULT_PREFS, marginY: 64 });
    expect(css).toMatch(/--_pad-top:\s*64px/);
    expect(css).toMatch(/--_pad-bottom:\s*64px/);
  });

  it('--_pad-* 跟着 marginY 走（不是写死的 0/8）', () => {
    const tight = buildChapterCSS({ ...DEFAULT_PREFS, marginY: 12 });
    const loose = buildChapterCSS({ ...DEFAULT_PREFS, marginY: 96 });
    expect(tight).toMatch(/--_pad-top:\s*12px/);
    expect(loose).toMatch(/--_pad-top:\s*96px/);
    expect(loose).toMatch(/--_pad-bottom:\s*96px/);
  });

  it('滚动模式调大调小，padding 跟着变（不是写死的 18/28）', () => {
    const tight = buildChapterCSS({ ...DEFAULT_PREFS, flow: 'scroll', marginY: 4 });
    const loose = buildChapterCSS({ ...DEFAULT_PREFS, flow: 'scroll', marginY: 96 });
    expect(tight).toMatch(/padding-top:\s*4px/);
    expect(loose).toMatch(/padding-top:\s*96px/);
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

  /**
   * 书页背景不是 body 画的：分页器把 body 背景抓走、设成 none，
   * 再在 shadow 的 #background 里按列重铺（paginator.js #replaceBackground）。
   * 它只认 `--theme-bg-color` 这一个变量——不写它，深色主题下书页永远是
   * 打开时那张白纸（真机反馈：深色模式阅读界面未跟随）。
   */
  it('把底色写进 --theme-bg-color（分页器的背景层读它）', () => {
    const css = buildChapterCSS(DEFAULT_PREFS);
    expect(css).toMatch(/--theme-bg-color:\s*#|--theme-bg-color:\s*rgb/);
  });

  it('深色主题：底色是深色，不是白纸', () => {
    document.body.classList.add('theme-dark');
    try {
      const css = buildChapterCSS(DEFAULT_PREFS);
      const m = css.match(/--theme-bg-color:\s*([^;]+)/);
      expect(m?.[1]?.trim()).toBeTruthy();
      expect(m?.[1]?.trim().toLowerCase()).not.toBe('#ffffff');
      expect(css).toContain('background: #1e1e1e !important');
    } finally {
      document.body.classList.remove('theme-dark');
    }
  });
});

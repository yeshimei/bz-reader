import { describe, expect, it } from 'vitest';
import {
  applySpeechHighlight,
  clearSpeechHighlight,
  speechHighlightCss,
  speechHighlightSupported,
} from '../src/engine/speech-highlight';

/* 只测「怎么跟 realm 打交道」，不碰真实排版：假的 document 足够。
   真机上的坐标系由浏览器负责，这里没有可断言的东西。 */

interface FakeOptions {
  highlight?: boolean;
  registry?: boolean;
  throwOnSet?: boolean;
}

function fakeDoc(opts: FakeOptions = {}) {
  const calls: Array<{ name: string; highlight?: unknown }> = [];
  const deleted: string[] = [];
  const registry = {
    set: (name: string, highlight: unknown) => {
      if (opts.throwOnSet) throw new Error('boom');
      calls.push({ name, highlight });
    },
    delete: (name: string) => {
      deleted.push(name);
    },
  };
  class FakeHighlight {
    ranges: Range[];
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  }
  const win: Record<string, unknown> = {};
  if (opts.registry !== false) win.CSS = { highlights: registry };
  if (opts.highlight !== false) win.Highlight = FakeHighlight;
  return {
    doc: { defaultView: win } as unknown as Document,
    calls,
    deleted,
    FakeHighlight,
  };
}

describe('CSS Custom Highlight 支持判断', () => {
  it('构造器与注册表都在才算支持', () => {
    expect(speechHighlightSupported(fakeDoc().doc)).toBe(true);
  });

  it('缺 Highlight 构造器：不支持（老内核）', () => {
    expect(speechHighlightSupported(fakeDoc({ highlight: false }).doc)).toBe(false);
  });

  it('缺 CSS.highlights：不支持', () => {
    expect(speechHighlightSupported(fakeDoc({ registry: false }).doc)).toBe(false);
  });

  it('没有 window 的文档：不支持，不抛', () => {
    expect(speechHighlightSupported({ defaultView: null } as unknown as Document)).toBe(false);
  });
});

describe('设置与清除', () => {
  it('注册一条，名字固定，Range 原样带进去', () => {
    const { doc, calls, FakeHighlight } = fakeDoc();
    const range = {} as Range;
    expect(applySpeechHighlight(doc, range)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('bzr-speech');
    expect(calls[0].highlight).toBeInstanceOf(FakeHighlight);
    expect((calls[0].highlight as InstanceType<typeof FakeHighlight>).ranges).toEqual([range]);
  });

  it('不支持的环境返回 false，让调用方走兜底', () => {
    const { doc } = fakeDoc({ registry: false });
    expect(applySpeechHighlight(doc, {} as Range)).toBe(false);
  });

  it('注册表抛错也返回 false，不把朗读带崩', () => {
    const { doc } = fakeDoc({ throwOnSet: true });
    expect(applySpeechHighlight(doc, {} as Range)).toBe(false);
  });

  it('清除删的就是那一个名字', () => {
    const { doc, deleted } = fakeDoc();
    clearSpeechHighlight(doc);
    expect(deleted).toEqual(['bzr-speech']);
  });

  it('文档没有注册表时清除是空操作，不抛', () => {
    expect(() => clearSpeechHighlight(fakeDoc({ registry: false }).doc)).not.toThrow();
  });
});

describe('高亮样式', () => {
  it('用强调色兑出一个浅底', () => {
    const css = speechHighlightCss('#9a7434');
    expect(css).toContain('::highlight(bzr-speech)');
    expect(css).toContain('#9a7434');
    expect(css).toContain('background-color');
  });

  it('拿不到强调色时给一个能看的缺省值', () => {
    expect(speechHighlightCss('')).toContain('#9a7434');
  });
});

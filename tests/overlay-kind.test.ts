import { describe, expect, it } from 'vitest';
import { dismissesOnOutside, isFloatOverlay } from '../src/shell/state';

/**
 * 哪些弹层算「浮层」：无遮罩、贴在文字旁。
 * 点划线后的工具条与新想法输入框都必须在列——阅读视图靠这个判断
 * 「这一下点正文是关浮层，不是翻页」。
 *
 * 但「算浮层」不等于「点外面就关」：写想法是**有内容要保护**的输入框，
 * 点外面一律不关，只认取消 / 保存 / Esc。
 */
describe('isFloatOverlay', () => {
  it('划线工具条 / 想法 / 脚注 / 排版都是浮层', () => {
    for (const kind of ['hltools', 'idea', 'footnote', 'typography'] as const) {
      expect(isFloatOverlay(kind)).toBe(true);
    }
  });

  it('搜索 / 解锁 / 详情这类带遮罩的弹层不是浮层', () => {
    for (const kind of ['search', 'unlock', 'detail', 'import'] as const) {
      expect(isFloatOverlay(kind)).toBe(false);
    }
  });

  it('没有弹层时返回 false', () => {
    expect(isFloatOverlay(null)).toBe(false);
    expect(isFloatOverlay(undefined)).toBe(false);
  });
});

describe('dismissesOnOutside', () => {
  it('写想法不因点外面关闭（写了一半丢内容最难接受）', () => {
    expect(dismissesOnOutside('idea')).toBe(false);
  });

  it('其它浮层点外面照旧关闭', () => {
    for (const kind of ['hltools', 'footnote', 'typography'] as const) {
      expect(dismissesOnOutside(kind)).toBe(true);
    }
  });

  it('带遮罩的弹层不归这条管（遮罩自己收）', () => {
    expect(dismissesOnOutside('search')).toBe(false);
  });

  it('没有弹层时返回 false', () => {
    expect(dismissesOnOutside(null)).toBe(false);
  });
});

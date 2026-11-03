import { describe, expect, it } from 'vitest';
import { isFloatOverlay } from '../src/shell/state';

/**
 * 哪些弹层算「浮层」：无遮罩、点外面关闭。
 * 点划线后的工具条与新想法输入框都必须在列——阅读视图靠这个判断
 * 「这一下点正文是关浮层，不是翻页」。
 */
describe('isFloatOverlay', () => {
  it('划线工具条 / 想法 / 脚注 / 排版 / 标注卡都是浮层', () => {
    for (const kind of ['hltools', 'idea', 'footnote', 'typography', 'hlcard'] as const) {
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

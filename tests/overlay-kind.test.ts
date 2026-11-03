import { describe, expect, it } from 'vitest';
import { dismissesOnSelect, dismissesOnTap, isFloatOverlay } from '../src/shell/state';

/**
 * 哪些弹层算「浮层」：无遮罩、贴在文字旁。
 * 点划线后的工具条与新想法输入框都必须在列——阅读视图靠这个判断
 * 「这一下点正文是关浮层，不是翻页」。
 *
 * 「算浮层」之后还要分两种「别处」：点一下、开始新划词。写想法在
 * 「点一下」时也关（先问一句），但划词时不收——用户常要选正文粘进去。
 */
describe('isFloatOverlay', () => {
  it('划线工具条 / 想法 / 脚注 / 排版 / 书摘 / AI 都是浮层', () => {
    for (const kind of ['hltools', 'idea', 'footnote', 'typography', 'quote', 'ai'] as const) {
      expect(isFloatOverlay(kind)).toBe(true);
    }
  });

  /* 真机反馈：书摘卡与 AI 卡是 S10 新加的两张无遮罩浮卡，但没进这张表。
     后果是双向的——桌面点空白处关不掉，手机点正文不但不关，还先翻了一页。 */
  it('书摘与 AI 点外面要能关掉', () => {
    expect(dismissesOnTap('quote')).toBe(true);
    expect(dismissesOnTap('ai')).toBe(true);
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

describe('dismissesOnTap', () => {
  it('写想法也算一次关闭请求（关之前问一句由 closeOverlay 决定）', () => {
    expect(dismissesOnTap('idea')).toBe(true);
  });

  it('其它浮层点外面照旧关闭', () => {
    for (const kind of ['hltools', 'footnote', 'typography', 'quote', 'ai'] as const) {
      expect(dismissesOnTap(kind)).toBe(true);
    }
  });

  it('带遮罩的弹层不归这条管（遮罩自己收）', () => {
    expect(dismissesOnTap('search')).toBe(false);
  });

  it('没有弹层时返回 false', () => {
    expect(dismissesOnTap(null)).toBe(false);
  });
});

describe('dismissesOnSelect', () => {
  it('开始新划词时写想法不收（选正文粘进想法是常用操作）', () => {
    expect(dismissesOnSelect('idea')).toBe(false);
  });

  it('其它浮层照旧收掉', () => {
    for (const kind of ['hltools', 'quote', 'ai', 'footnote'] as const) {
      expect(dismissesOnSelect(kind)).toBe(true);
    }
  });
});

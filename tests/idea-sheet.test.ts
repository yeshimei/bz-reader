import { describe, expect, it } from 'vitest';
import { ideaSheetActsHtml, ideaSheetBodyHtml, ideaSheetHtml } from '../src/shell/idea-sheet';

/**
 * 写想法弹窗：**只有一个输入框和一个保存按钮**。
 *
 * 不重复原文、不放章节、没有取消（点外面就关），已有想法直接预填
 * 进输入框——再点「写想法」就是修改。
 */
const base = { markId: 'm1', bookId: 'b1' };

describe('ideaSheetBodyHtml', () => {
  it('只有一个输入框', () => {
    expect(ideaSheetBodyHtml(base).match(/<textarea/g)?.length).toBe(1);
  });

  it('已有想法预填进输入框（再点写想法 = 修改）', () => {
    const html = ideaSheetBodyHtml({ ...base, value: '我想到了外婆' });
    expect(html).toContain('我想到了外婆');
  });

  it('不展示选中的原文与章节（没有 quote / mini）', () => {
    const html = ideaSheetBodyHtml(base);
    expect(html).not.toContain('bzs-sheet-quote');
    expect(html).not.toContain('这些微小的虫子');
    expect(html).not.toContain('bzs-mini');
  });

  it('输入框内容里的 HTML 被转义', () => {
    const html = ideaSheetBodyHtml({ ...base, value: '<b>x</b>' });
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('ideaSheetActsHtml', () => {
  it('只有一个保存按钮，没有取消', () => {
    const html = ideaSheetActsHtml(base);
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain('保存');
    expect(html).not.toContain('取消');
  });

  it('保存按钮带着标注 id 与书 id（保存链路要用）', () => {
    const html = ideaSheetActsHtml(base);
    expect(html).toContain('data-act="ideasave"');
    expect(html).toContain('data-id="m1"');
    expect(html).toContain('data-book="b1"');
  });
});

describe('ideaSheetHtml', () => {
  it('整卡只有主体与保存行，且带专门的类名', () => {
    const html = ideaSheetHtml(base);
    expect(html).toContain('bzs-sheet');
    expect(html).toContain('bzs-sheet-input');
    expect(html).toContain('bzs-sheet-foot');
  });
});

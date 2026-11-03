import { describe, expect, it } from 'vitest';
import { ideaSheetActsHtml, ideaSheetBodyHtml, ideaSheetHtml } from '../src/shell/idea-sheet';

/**
 * 写想法弹窗：一个输入框 + 取消 / 保存。
 *
 * 取消是为了「写了一半想退出」有明确的出口：以前只能点外面，
 * 而点外面正好是最容易误触的地方（正文、遮罩、另一条划线）。
 * 弹窗本身也不再因为点外面而关闭——内容丢了没处找回。
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
  it('取消在保存前面，一共两个按钮', () => {
    const html = ideaSheetActsHtml(base);
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html.indexOf('取消')).toBeLessThan(html.indexOf('保存'));
  });

  it('取消走 close 动作（不落盘、不删标注）', () => {
    const html = ideaSheetActsHtml(base);
    expect(html).toContain('data-act="close"');
  });

  it('保存按钮带着标注 id 与书 id（保存链路要用）', () => {
    const html = ideaSheetActsHtml(base);
    expect(html).toContain('data-act="ideasave"');
    expect(html).toContain('data-id="m1"');
    expect(html).toContain('data-book="b1"');
  });
});

describe('ideaSheetHtml', () => {
  it('整卡只有主体与动作行，且带专门的类名', () => {
    const html = ideaSheetHtml(base);
    expect(html).toContain('bzs-sheet');
    expect(html).toContain('bzs-sheet-input');
    expect(html).toContain('bzs-sheet-foot');
  });
});

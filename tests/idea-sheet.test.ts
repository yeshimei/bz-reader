import { describe, expect, it } from 'vitest';
import { ideaSheetBodyHtml, ideaSheetHtml, ideaValue } from '../src/shell/idea-sheet';

/**
 * 写想法 = 一条输入框 + 一颗发送键（S10 定稿）。
 *
 * 取消按钮没有出现在卡里：取消在打字之前毫无意义，在打字之后又太容易误点。
 * 退出意图由关闭前的二次确认接住（见 reader-cards 的 ideaConfirmHtml）。
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

  it('输入框是一行起（想法大多是一句话）', () => {
    expect(ideaSheetBodyHtml(base)).toContain('rows="1"');
  });
});

describe('ideaSheetBodyHtml · 发送键', () => {
  it('整卡只有一颗按钮，就是发送', () => {
    const html = ideaSheetBodyHtml(base);
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain('data-act="ideasave"');
  });

  it('发送键带着标注 id 与书 id（保存链路要用）', () => {
    const html = ideaSheetBodyHtml(base);
    expect(html).toContain('data-id="m1"');
    expect(html).toContain('data-book="b1"');
  });

  it('没有「取消」按钮（退出走关闭二次确认）', () => {
    expect(ideaSheetBodyHtml(base)).not.toContain('取消');
  });

  it('发送键有一枚纸飞机图标，不是文字', () => {
    const html = ideaSheetBodyHtml(base);
    expect(html).toContain('<svg');
    expect(html).toContain('class="send"');
  });
});

describe('ideaValue', () => {
  it('没动过输入框：用书里存的那条', () => {
    expect(ideaValue(null, '旧想法')).toBe('旧想法');
  });

  it('动过：用草稿，哪怕被清空（用户就是要清空）', () => {
    expect(ideaValue('', '旧想法')).toBe('');
    expect(ideaValue('新的', '旧想法')).toBe('新的');
  });

  it('两边都没有：空串', () => {
    expect(ideaValue(null, undefined)).toBe('');
    expect(ideaValue(undefined, undefined)).toBe('');
  });
});

describe('ideaSheetHtml', () => {
  it('整卡带专门的类名，外面没有段落外壳', () => {
    const html = ideaSheetHtml(base);
    expect(html).toContain('bzs-idea-card');
    expect(html).not.toContain('bzs-sheet-foot');
  });
});

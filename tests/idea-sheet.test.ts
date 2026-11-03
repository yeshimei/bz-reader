import { describe, expect, it } from 'vitest';
import { ideaSheetActsHtml, ideaSheetBodyHtml, ideaSheetHtml } from '../src/shell/idea-sheet';

const base = { quote: '这些微小的虫子，会让我们的母亲、祖母像恶狗一样易怒。', markId: 'm1', bookId: 'b1' };

describe('ideaSheetBodyHtml', () => {
  it('带上被划的原文', () => {
    expect(ideaSheetBodyHtml(base)).toContain('这些微小的虫子');
  });

  it('超长原文被截断，不把卡片撑爆', () => {
    const long = '字'.repeat(200);
    const html = ideaSheetBodyHtml({ ...base, quote: long });
    expect(html).toContain('…');
    expect(html.length).toBeLessThan(long.length + 400);
  });

  it('只有一个输入框，且带已有想法', () => {
    const html = ideaSheetBodyHtml({ ...base, value: '我想到了外婆' });
    expect(html.match(/<textarea/g)?.length).toBe(1);
    expect(html).toContain('我想到了外婆');
  });

  it('不再出现解释性长文案（章节名 / 会出现在哪里）', () => {
    const html = ideaSheetBodyHtml(base);
    expect(html).not.toContain('想法会跟着划线');
    expect(html).not.toContain('bzs-mini');
  });

  it('原文里的 HTML 被转义', () => {
    const html = ideaSheetBodyHtml({ ...base, quote: '<b>x</b>' });
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('ideaSheetActsHtml', () => {
  it('只有取消与保存两个按钮', () => {
    const html = ideaSheetActsHtml(base);
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html).toContain('取消');
    expect(html).toContain('保存');
  });

  it('保存按钮带着标注 id 与书 id（保存链路要用）', () => {
    const html = ideaSheetActsHtml(base);
    expect(html).toContain('data-act="ideasave"');
    expect(html).toContain('data-id="m1"');
    expect(html).toContain('data-book="b1"');
  });
});

describe('ideaSheetHtml', () => {
  it('按钮自带 flex 容器（壳的 footer 不是 flex，否则会竖排）', () => {
    expect(ideaSheetActsHtml(base)).toContain('bzs-sheet-foot');
  });

  it('整卡包含主体与按钮，且带专门的类名', () => {
    const html = ideaSheetHtml(base);
    expect(html).toContain('bzs-sheet');
    expect(html).toContain('bzs-sheet-quote');
    expect(html).toContain('bzs-sheet-foot');
  });
});

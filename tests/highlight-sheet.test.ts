import { describe, expect, it } from 'vitest';
import { highlightSheetActsHtml, highlightSheetBodyHtml } from '../src/shell/highlight-sheet';

const colors = [
  { value: 'yellow', label: '黄' },
  { value: 'green', label: '绿' },
];
const base = { quote: '她们会愤怒到底，停不下来。', markId: 'm1', bookId: 'b1', color: 'yellow', colors };

describe('划线详情卡 · 主体', () => {
  it('带原文与已有想法', () => {
    const html = highlightSheetBodyHtml({ ...base, comment: '这句好' });
    expect(html).toContain('她们会愤怒到底');
    expect(html).toContain('这句好');
  });

  it('超长原文截断到 120 字', () => {
    const html = highlightSheetBodyHtml({ ...base, quote: '字'.repeat(300) });
    expect(html).toContain('…');
  });

  it('转义 HTML', () => {
    const html = highlightSheetBodyHtml({ ...base, quote: '<i>x</i>' });
    expect(html).toContain('&lt;i&gt;');
    expect(html).not.toContain('<i>x</i>');
  });
});

describe('划线详情卡 · 动作行', () => {
  it('当前颜色带 on 标记', () => {
    const html = highlightSheetActsHtml(base);
    expect(html).toMatch(/class="bzs-pendot on"[^>]*data-v="yellow"/);
  });

  it('每个色点都带改色三件套（act/id/book/v）', () => {
    const html = highlightSheetActsHtml(base);
    expect(html.match(/data-act="hlcolor"/g)?.length).toBe(2);
    expect(html).toContain('data-id="m1"');
    expect(html).toContain('data-book="b1"');
  });

  it('复制与删除都在，且带定位参数', () => {
    const html = highlightSheetActsHtml(base);
    expect(html).toContain('data-act="hlquote"');
    expect(html).toContain('data-act="hldel"');
  });

  it('想法输入框有保存出口（否则移动端写的想法必丢）', () => {
    const html = highlightSheetActsHtml(base);
    expect(html).toContain('data-act="ideasave"');
    expect(html).toContain('data-id="m1"');
    expect(highlightSheetBodyHtml(base)).toContain('data-role="idea"');
  });
});

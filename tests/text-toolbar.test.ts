import { describe, expect, it } from 'vitest';
import { selActions, textToolbarHtml } from '../src/shell/text-toolbar';

/**
 * 点划线后弹出的「文字工具框」。
 *
 * 目标形态：只有一排控件（色点 + 写想法 + 删除），有想法时在下面
 * 原样展示那段想法；**不重复选中的原文，也不放章节 / 日期 / 说明**。
 */
const colors = [
  { value: 'amber', label: '琥珀', css: '#e8b53a' },
  { value: 'vermilion', label: '朱红', css: '#e2571c' },
  { value: 'green', label: '松绿', css: '#4f9a63' },
  { value: 'blue', label: '黛蓝', css: '#4a83d0' },
];
const base = { markId: 'm1', bookId: 'b1', color: 'amber', colors };

describe('textToolbarHtml · 工具条', () => {
  it('每种笔色一个色点，当前色带 on', () => {
    const html = textToolbarHtml(base);
    expect(html.match(/class="bzs-pendot/g)?.length).toBe(colors.length);
    expect(html).toContain('class="bzs-pendot on"');
  });

  it('写想法按钮带着标注 id 与书 id', () => {
    const html = textToolbarHtml(base);
    expect(html).toContain('data-act="hlidea"');
    expect(html).toContain('data-id="m1"');
    expect(html).toContain('data-book="b1"');
    expect(html).toContain('写想法');
  });

  it('删除按钮也在，且带定位参数', () => {
    const html = textToolbarHtml(base);
    expect(html).toContain('data-act="hldel"');
    expect(html).toContain('删除');
  });

  it('不展示选中的原文、章节、日期或解释文案', () => {
    const html = textToolbarHtml(base);
    expect(html).not.toContain('bzs-qcard');
    expect(html).not.toContain('bzs-sheet-quote');
    expect(html).not.toContain('想法会');
    expect(html).not.toContain('换一支笔');
    expect(html.match(/<textarea/g)).toBeNull();
  });

  it('没有想法时不渲染想法区', () => {
    const html = textToolbarHtml(base);
    expect(html).not.toContain('bzs-mark-bubble');
  });

  it('控件排成一条 999 圆角的胶囊，和划词那条同形', () => {
    const html = textToolbarHtml(base);
    expect(html).toContain('class="bzs-hlbar"');
    expect(html).toContain('bzs-hlbar-sep');
    expect(html).not.toContain('bzs-hltools');
  });
});

describe('textToolbarHtml · 想法', () => {
  it('有想法时在工具条上面原样展示', () => {
    const html = textToolbarHtml({ ...base, comment: '这句我想了很久' });
    expect(html).toContain('bzs-mark-bubble');
    expect(html).toContain('这句我想了很久');
  });

  it('想法气泡排在胶囊之前（气泡在上）', () => {
    const html = textToolbarHtml({ ...base, comment: '想法' });
    expect(html.indexOf('bzs-mark-bubble')).toBeLessThan(html.indexOf('bzs-hlbar'));
  });

  it('想法里的 HTML 被转义', () => {
    const html = textToolbarHtml({ ...base, comment: '<b>x</b>' });
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('只有空白想法时不渲染想法区', () => {
    const html = textToolbarHtml({ ...base, comment: '   ' });
    expect(html).not.toContain('bzs-mark-bubble');
  });
});

/**
 * 划词胶囊（S10 定稿）：色点在左，
 * 右边依次是 想法 / 书摘 / AI / 复制；AI 文案就两个字，
 * 「AI 解释」会把胶囊撑宽一截，而它旁边就是「书摘」。
 */
describe('selActions · 划词胶囊动作', () => {
  it('顺序是 想法 / 书摘 / AI / 复制', () => {
    expect(selActions(true).map((a) => a.act)).toEqual(['selidea', 'selquote', 'selai', 'selcopy']);
  });

  it('AI 文案只有两个字', () => {
    const ai = selActions(true).find((a) => a.act === 'selai');
    expect(ai?.label).toBe('AI');
  });

  it('没有 AI 权限时整颗不出现（不做灰锁）', () => {
    expect(selActions(false).map((a) => a.act)).toEqual(['selidea', 'selquote', 'selcopy']);
  });
});

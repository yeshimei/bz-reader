import { describe, expect, it } from 'vitest';
import { selActions, textToolbarHtml } from '../src/shell/text-toolbar';

/**
 * 点划线后弹出的「文字工具框」。
 *
 * 目标形态（题跋）：有想法时，想法排在按钮行**上方**——先读批注、再决定操作；
 * 想法用一枚「想」字小印起头，按钮行压一条发丝线。
 * **不重复选中的原文，也不放章节 / 日期 / 说明**。
 * 「双链」「复制」「书摘」都排在删除前面——删除是这一排唯一的破坏性动作，
 * 不该夹在两个复制按钮中间。
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

  it('书摘、双链、复制依次排在删除前面', () => {
    const html = textToolbarHtml(base);
    const at = (s: string): number => html.indexOf(s);
    expect(at('写想法')).toBeGreaterThan(-1);
    expect(at('写想法')).toBeLessThan(at('书摘'));
    expect(at('书摘')).toBeLessThan(at('双链'));
    expect(at('双链')).toBeLessThan(at('复制'));
    expect(at('复制')).toBeLessThan(at('删除'));
  });

  it('书摘 / 双链 / 复制都带着标注 id 与书 id', () => {
    const html = textToolbarHtml(base);
    for (const act of ['hlquote', 'copylink', 'hlcopy']) {
      const tag = html.match(new RegExp(`<button[^>]*data-act="${act}"[^>]*>`))?.[0] ?? '';
      expect(tag, act).toContain('data-id="m1"');
      expect(tag, act).toContain('data-book="b1"');
    }
  });

  it('删除仍是最后那个 danger 按钮', () => {
    const html = textToolbarHtml(base);
    const buttons = [...html.matchAll(/<button[^>]*data-act="([^"]+)"[^>]*>([^<]*)<\/button>/g)];
    expect(buttons.at(-1)?.[1]).toBe('hldel');
    expect(buttons.at(-1)?.[0]).toContain('class="bzs-sbtn danger"');
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
  it('有想法时跟在工具条下方（先操作，再读批注）', () => {
    const html = textToolbarHtml({ ...base, comment: '这句我想了很久' });
    expect(html).toContain('bzs-mark-bubble');
    expect(html).toContain('这句我想了很久');
    expect(html.indexOf('bzs-hlbar')).toBeLessThan(html.indexOf('bzs-mark-bubble'));
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

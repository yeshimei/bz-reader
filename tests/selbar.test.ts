import { describe, expect, it } from 'vitest';
import { selbarActions } from '../src/shell/selbar';

/**
 * 划词条上的按钮顺序。
 *
 * 文字工具条最后是「双链 → 复制」：先拿双链（粘进笔记有反链），
 * 再考虑纯文本复制。AI 只在高级版构建里出现，不能占位成灰按钮。
 */
describe('selbarActions · 划词条按钮', () => {
  it('想法、书摘、双链、复制依次出现', () => {
    const acts = selbarActions({ ai: false }).map((a) => a.act);
    expect(acts).toEqual(['selidea', 'selquote', 'selbilink', 'selcopy']);
  });

  it('支持 AI 时 AI 解释排在书摘之后、双链之前', () => {
    const acts = selbarActions({ ai: true }).map((a) => a.act);
    expect(acts).toEqual(['selidea', 'selquote', 'selai', 'selbilink', 'selcopy']);
  });

  it('双链按钮的文案就是「双链」，复制是「复制」', () => {
    const byAct = new Map(selbarActions({ ai: false }).map((a) => [a.act, a.label]));
    expect(byAct.get('selbilink')).toBe('双链');
    expect(byAct.get('selcopy')).toBe('复制');
  });
});

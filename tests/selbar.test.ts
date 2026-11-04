import { describe, expect, it } from 'vitest';
import { selbarActions } from '../src/shell/selbar';

/**
 * 划词条上的按钮顺序。
 *
 * 入口平权：基础版也保留「AI 解释」与「双链」，点了由 requireCap 弹
 * 高级版对照页——不再按版本把按钮藏掉。藏掉等于用户永远不知道有这个能力。
 */
describe('selbarActions · 划词条按钮', () => {
  it('想法、书摘、AI 解释、双链、复制依次出现', () => {
    expect(selbarActions().map((a) => a.act)).toEqual([
      'selidea',
      'selquote',
      'selai',
      'selbilink',
      'selcopy',
    ]);
  });

  it('AI 解释排在书摘之后、双链之前', () => {
    const acts = selbarActions().map((a) => a.act);
    expect(acts.indexOf('selai')).toBeGreaterThan(acts.indexOf('selquote'));
    expect(acts.indexOf('selai')).toBeLessThan(acts.indexOf('selbilink'));
  });

  it('双链按钮的文案是「双链」，复制是「复制」', () => {
    const byAct = new Map(selbarActions().map((a) => [a.act, a.label]));
    expect(byAct.get('selbilink')).toBe('双链');
    expect(byAct.get('selai')).toBe('AI 解释');
    expect(byAct.get('selcopy')).toBe('复制');
  });
});

import { describe, expect, it } from 'vitest';
import { contentInset } from '../src/engine/content-inset';

/** 真机（390×844 DPR3，app.emulateMobile）量到的一组数 */
const REAL = {
  rootWidth: 390.4,
  columnWidth: 363.075,
  htmlPadLeft: 13.66,
  bodyWidth: 335.75,
  bodyPadLeft: 8,
  bodyPadRight: 8,
};

describe('contentInset', () => {
  it('第一页：iframe 被右推 13.54，两角要补上这一截', () => {
    const r = contentInset({ ...REAL, frameLeft: 13.54 });
    expect(r.left).toBe(35);
    expect(r.right).toBe(35);
  });

  it('翻到第 52 页：iframe 平移成 -18503，余数仍是 13.5', () => {
    const r = contentInset({ ...REAL, frameLeft: -18503.26 });
    expect(r.left).toBe(35);
    expect(r.right).toBe(35);
  });

  it('翻到第 93 页也一样（平移是整列步长，余数不变）', () => {
    const a = contentInset({ ...REAL, frameLeft: -33000.5 });
    const b = contentInset({ ...REAL, frameLeft: -33000.5 - 363.075 * 7 });
    expect(a).toEqual(b);
  });

  it('拿不到列宽（滚动模式）时退化成 padding 相加', () => {
    const r = contentInset({
      rootWidth: 360,
      frameLeft: 0,
      columnWidth: 0,
      htmlPadLeft: 0,
      bodyWidth: 360,
      bodyPadLeft: 24,
      bodyPadRight: 24,
    });
    expect(r.left).toBe(24);
    expect(r.right).toBe(24);
  });

  it('正文比阅读区还宽时不返回负数', () => {
    const r = contentInset({
      rootWidth: 100,
      frameLeft: 0,
      columnWidth: 0,
      htmlPadLeft: 0,
      bodyWidth: 300,
      bodyPadLeft: 0,
      bodyPadRight: 0,
    });
    expect(r.right).toBe(0);
  });
});

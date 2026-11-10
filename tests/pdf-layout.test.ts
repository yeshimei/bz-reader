import { describe, expect, it } from 'vitest';
import { pageAtRow, pageLabel, pageStep, rowStartIndex, screenRange, turnPage } from '../src/engine/pdf/layout';
import { boxSizeFor } from '../src/engine/pdf/view';

describe('pdf layout · 行首与页码', () => {
  it('单栏时 offsetTop 严格递增，查到哪页就是哪页', () => {
    const offsets = [0, 800, 1600, 2400];
    expect(pageAtRow(offsets, 0)).toBe(1);
    expect(pageAtRow(offsets, 799)).toBe(1);
    expect(pageAtRow(offsets, 1600)).toBe(3);
    expect(pageAtRow(offsets, 99999)).toBe(4);
  });

  it('双页并排时同行两页 offsetTop 相同，页码要报行首那页', () => {
    /* 1 | 2-3 | 4-5：第 1 页占一行，之后两页一行 */
    const offsets = [0, 800, 800, 1600, 1600, 2400];
    expect(pageAtRow(offsets, 810)).toBe(2);
    expect(pageAtRow(offsets, 1600)).toBe(4);
    expect(pageAtRow(offsets, 1700)).toBe(4);
  });

  it('同行 offsetTop 差 1px（边框/取整）仍算同一行', () => {
    const offsets = [0, 800, 801, 1600];
    expect(pageAtRow(offsets, 900)).toBe(2);
    expect(rowStartIndex(offsets, 2)).toBe(1);
  });

  it('空数组兜底返回第 1 页，不抛错', () => {
    expect(pageAtRow([], 100)).toBe(1);
    expect(rowStartIndex([], 5)).toBe(0);
  });

  it('screenRange：单栏一页，双页给区间，封面只有自己', () => {
    expect(screenRange(7, 100, false)).toEqual({ from: 7, to: 7 });
    expect(screenRange(7, 100, true)).toEqual({ from: 6, to: 7 });
    expect(screenRange(1, 100, true)).toEqual({ from: 1, to: 1 });
    expect(screenRange(100, 100, true)).toEqual({ from: 100, to: 100 });
  });

  it('pageLabel 用数字区间，不依赖语言', () => {
    expect(pageLabel(7, 278, false)).toBe('7 / 278');
    expect(pageLabel(7, 278, true)).toBe('6–7 / 278');
    expect(pageLabel(1, 24, true)).toBe('1 / 24');
  });

  it('pageStep 只区分单栏与双页', () => {
    expect(pageStep(true)).toBe(2);
    expect(pageStep(false)).toBe(1);
  });
});

describe('pdf layout · 按屏翻页', () => {
  it('单栏就是前后一页，到头夹紧', () => {
    expect(turnPage(3, 10, 1, false)).toBe(4);
    expect(turnPage(3, 10, -1, false)).toBe(2);
    expect(turnPage(10, 10, 1, false)).toBe(10);
    expect(turnPage(1, 10, -1, false)).toBe(1);
  });

  it('双页：封面单独一行，1 → 2 只走一页', () => {
    expect(turnPage(1, 24, 1, true)).toBe(2);
  });

  it('双页往后：2 → 4、3 → 4、4 → 6、5 → 6', () => {
    expect(turnPage(2, 24, 1, true)).toBe(4);
    expect(turnPage(3, 24, 1, true)).toBe(4);
    expect(turnPage(4, 24, 1, true)).toBe(6);
    expect(turnPage(5, 24, 1, true)).toBe(6);
  });

  it('双页往前：2 → 1、3 → 2、4 → 2、5 → 4', () => {
    expect(turnPage(2, 24, -1, true)).toBe(1);
    expect(turnPage(3, 24, -1, true)).toBe(2);
    expect(turnPage(4, 24, -1, true)).toBe(2);
    expect(turnPage(5, 24, -1, true)).toBe(4);
  });

  it('双页到末尾夹紧，不会翻出页外', () => {
    expect(turnPage(23, 24, 1, true)).toBe(24);
    expect(turnPage(24, 24, 1, true)).toBe(24);
  });

  it('总页数 1 时怎么翻都是第 1 页', () => {
    expect(turnPage(1, 1, 1, true)).toBe(1);
    expect(turnPage(1, 1, -1, false)).toBe(1);
  });
});

describe('pdf layout · 旋转后的页框尺寸（问题 #2）', () => {
  const RAW = { width: 600, height: 800 };

  it('0 / 180 度不变', () => {
    expect(boxSizeFor(RAW, 0)).toEqual({ width: 600, height: 800 });
    expect(boxSizeFor(RAW, 180)).toEqual({ width: 600, height: 800 });
  });

  it('90 / 270 度交换宽高', () => {
    expect(boxSizeFor(RAW, 90)).toEqual({ width: 800, height: 600 });
    expect(boxSizeFor(RAW, 270)).toEqual({ width: 800, height: 600 });
  });

  it('负角度归一到等效正角度：-90 ≡ 270（交换）、-180 ≡ 0（不变）', () => {
    expect(boxSizeFor(RAW, -90)).toEqual({ width: 800, height: 600 });
    expect(boxSizeFor(RAW, -180)).toEqual({ width: 600, height: 800 });
  });

  it('360 及 450 归一到 0 / 90', () => {
    expect(boxSizeFor(RAW, 360)).toEqual({ width: 600, height: 800 });
    expect(boxSizeFor(RAW, 450)).toEqual({ width: 800, height: 600 });
  });

  it('不修改入参（原始尺寸继续由 this.sizes[] 持有）', () => {
    const src = { width: 600, height: 800 };
    boxSizeFor(src, 90);
    expect(src).toEqual({ width: 600, height: 800 });
  });
});

/* 问题 #3：零页 / 残缺到没有页的 PDF 打开是一块空白。
 * 修复在 view.ts 的 mount() 顶部：`if (this.numPages === 0) throw new Error('这本 PDF 没有任何页面')`。
 * 它不是纯函数，且 mount() 会建 DOM、依赖 PdfDocument / pdf.js，node 环境里不好单测；
 * 按 team-lead 约定此处靠真机冒烟：用一本空 PDF（numPages === 0）在 reader-view 里打开，
 * 应看到「打不开」错误页显示「这本 PDF 没有任何页面」，而不是一片空白。 */


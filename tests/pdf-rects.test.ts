import { describe, expect, it } from 'vitest';
import { mergeRects } from '../src/engine/pdf/rects';

describe('PDF 高亮矩形合并', () => {
  it('同一行相接的碎片并成一块', () => {
    const out = mergeRects([
      { left: 0.1, top: 0.2, width: 0.1, height: 0.02 },
      { left: 0.2, top: 0.2, width: 0.15, height: 0.02 },
      { left: 0.35, top: 0.201, width: 0.05, height: 0.02 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.left).toBeCloseTo(0.1);
    expect(out[0]!.top).toBeCloseTo(0.2);
    expect(out[0]!.width).toBeCloseTo(0.3);
    expect(out[0]!.height).toBeCloseTo(0.02);
  });

  it('不同行不合并（跨行会染上整段行距）', () => {
    const out = mergeRects([
      { left: 0.1, top: 0.2, width: 0.6, height: 0.02 },
      { left: 0.1, top: 0.24, width: 0.6, height: 0.02 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.top).toBeCloseTo(0.2);
    expect(out[1]!.top).toBeCloseTo(0.24);
  });

  it('双栏：同一行但隔着栏间距，分成两块', () => {
    const out = mergeRects([
      { left: 0.05, top: 0.3, width: 0.4, height: 0.02 },
      { left: 0.55, top: 0.3, width: 0.4, height: 0.02 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.width).toBeCloseTo(0.4);
    expect(out[1]!.left).toBeCloseTo(0.55);
  });

  it('窄间隙（词与词）仍然合并，不出现一行几十道缝', () => {
    const out = mergeRects([
      { left: 0.1, top: 0.1, width: 0.1, height: 0.02 },
      { left: 0.205, top: 0.1, width: 0.1, height: 0.02 },
      { left: 0.31, top: 0.1, width: 0.1, height: 0.02 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.width).toBeCloseTo(0.31);
  });

  it('乱序输入也能正确合并（按 top/left 排序后处理）', () => {
    const out = mergeRects([
      { left: 0.3, top: 0.2, width: 0.1, height: 0.02 },
      { left: 0.1, top: 0.2, width: 0.1, height: 0.02 },
      { left: 0.2, top: 0.2, width: 0.1, height: 0.02 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.left).toBeCloseTo(0.1);
    expect(out[0]!.width).toBeCloseTo(0.3);
  });

  it('空输入与单个矩形原样返回', () => {
    expect(mergeRects([])).toEqual([]);
    expect(mergeRects([{ left: 0.2, top: 0.3, width: 0.1, height: 0.02 }])).toEqual([
      { left: 0.2, top: 0.3, width: 0.1, height: 0.02 },
    ]);
  });

  it('宽度或高度为 0 的碎片直接丢掉（pdf.js 会给空 span）', () => {
    expect(mergeRects([
      { left: 0.1, top: 0.1, width: 0, height: 0.02 },
      { left: 0.2, top: 0.1, width: 0.1, height: 0 },
    ])).toEqual([]);
  });

  /* 真机数据（When AI builds itself 第 4 页）：pdf.js 给同一行的 span
     两种盒子——高的含升部、矮的只到基线，top 差 0.48%、高度差 0.78%。
     旧实现按 top 分桶（容差 0.4%）把它们判成两行，画出来就是两条叠着的
     半截色块：深一条浅一条，看着像「背景色很乱」。 */
  it('同一行里高度不齐的碎片也要并成一条（按竖直中心判行）', () => {
    const out = mergeRects([
      { left: 0.412983, top: 0.587144, width: 0.0228571, height: 0.0256532 },
      { left: 0.412983, top: 0.591894, width: 0.0228571, height: 0.0178147 },
      { left: 0.0970799, top: 0.623738, width: 0.503403, height: 0.0256532 },
    ]);
    /* 前两条同一行 → 一块；第三条在下一行 → 另起一块 */
    expect(out).toHaveLength(2);
    const [first, second] = out;
    expect(first!.left).toBeCloseTo(0.412983);
    expect(first!.width).toBeCloseTo(0.0228571);
    /* 统一成同一段竖向区间：上沿取最小的，高度取整段 */
    expect(first!.top).toBeCloseTo(0.587144);
    expect(first!.height).toBeCloseTo(0.0256532, 6);
    expect(second!.top).toBeCloseTo(0.623738);
  });

  it('上下不相接的两行不并（行距不能被染上）', () => {
    const out = mergeRects([
      { left: 0.1, top: 0.20, width: 0.5, height: 0.02 },
      { left: 0.1, top: 0.23, width: 0.5, height: 0.02 },
    ]);
    expect(out).toHaveLength(2);
  });

  it('入参不被改动', () => {
    const input = [
      { left: 0.1, top: 0.2, width: 0.1, height: 0.02 },
      { left: 0.2, top: 0.2, width: 0.1, height: 0.02 },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeRects(input);
    expect(input).toEqual(snapshot);
  });
});

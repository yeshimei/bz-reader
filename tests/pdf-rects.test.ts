import { describe, expect, it } from 'vitest';
import { mergeRects, nearestHostRow, previewFrameSettled } from '../src/engine/pdf/rects';

/* 框选松手后那层透明预览要一直留到「划线」：正式颜色矩形出现时它才退场。
   别处加标注、或这块还没划线，都不能把预览框顺手清掉（2026-11-15 用户截图：
   工具条在，却看不见自己刚框了哪一块）。 */
describe('框选预览框的退场时机', () => {
  it('这一块已经落线：预览框让位给颜色矩形', () => {
    expect(previewFrameSettled('pdf:12/r=0.1,0.2,0.3,0.4', new Set(['pdf:12/r=0.1,0.2,0.3,0.4']))).toBe(true);
  });

  it('别的地方加了标注、或这一块还没划线：预览框继续留着', () => {
    expect(previewFrameSettled('pdf:12/r=0.1,0.2,0.3,0.4', new Set(['pdf:13/r=0.1,0.2,0.3,0.4']))).toBe(false);
    expect(previewFrameSettled('pdf:12/r=0.1,0.2,0.3,0.4', new Set<string>())).toBe(false);
  });

  it('没有 locator 的旧框不参与匹配', () => {
    expect(previewFrameSettled(undefined, new Set(['']))).toBe(false);
    expect(previewFrameSettled('', new Set(['']))).toBe(false);
  });
});

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

/* 扫描页的行框比普通 pdf.js 词框高，相邻两行会同时「沾到」选区的行盒。
   按 DOM 顺序取第一个就会挑中上一行，整条高亮跟着往上飘一行。 */
describe('选区该落在哪一行', () => {
  const row = (top: number, bottom: number, tag: string) => ({ left: 10, right: 500, top, bottom, tag });
  const line = { left: 100, right: 400, top: 96, bottom: 104 };

  it('取竖直中心最近的那一块，而不是列表里第一个沾到的', () => {
    expect(nearestHostRow([row(80, 110, '上一行'), row(92, 108, '本行')], line)?.tag).toBe('本行');
  });

  it('竖直不沾、水平不相交的行一律不算', () => {
    expect(nearestHostRow([row(20, 40, '远上方'), row(200, 240, '远下方')], line)).toBeNull();
    expect(nearestHostRow([row(90, 110, '右边')].map((r) => ({ ...r, left: 600, right: 800 })), line)).toBeNull();
  });

  it('一行都没有就返回 null，交给调用方用行盒兜底', () => {
    expect(nearestHostRow([], line)).toBeNull();
  });
});

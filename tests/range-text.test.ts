import { describe, expect, it } from 'vitest';
import { pageSpan } from '../src/engine/range-text';

/* 2026-11-14 真机：「站在第二页点朗读，它从第一页开头念」，反复两轮。
   根因是「哪一段在眼前」跟块矩形比的时候，区间和矩形不在同一个坐标系：
   foliate 的页起点是**内容坐标**（22113），而当时按「文档元素宽」拼的
   区间是整章（0..38529）——于是前面所有页都算「可见」。

   现在区间由 foliate 自己的两个量算：`start`（页起点）+ `viewSize`（一页宽），
   再用 caret 取到的那个字符的 left 当标尺判断坐标系。 */

describe('当前页的横区间', () => {
  it('第一页：两种坐标系下都是 [0, 一页宽]', () => {
    expect(pageSpan({ start: 0, size: 632, probeLeft: 0 })).toEqual({ x0: 0, x1: 632 });
    expect(pageSpan({ start: 0, size: 632, probeLeft: Number.NaN })).toEqual({ x0: 0, x1: 632 });
  });

  it('块矩形是内容坐标（标尺贴着页起点）：区间跟着页起点走', () => {
    expect(pageSpan({ start: 22113, size: 632, probeLeft: 22116 })).toEqual({
      x0: 22113,
      x1: 22745,
    });
  });

  it('块矩形是视口坐标（标尺贴着 0）：区间就是 0 到一页宽', () => {
    expect(pageSpan({ start: 22113, size: 632, probeLeft: 4 })).toEqual({ x0: 0, x1: 632 });
  });

  it('拿不到标尺时按内容坐标处理：宁可这一页取空，也别把整章算成可见', () => {
    expect(pageSpan({ start: 22113, size: 632, probeLeft: Number.NaN })).toEqual({
      x0: 22113,
      x1: 22745,
    });
  });

  it('视口宽还没算出来（不到 8）：不给区间，调用方跳过这一份文档', () => {
    expect(pageSpan({ start: 0, size: 0, probeLeft: 0 })).toBeNull();
    expect(pageSpan({ start: 22113, size: 7, probeLeft: 0 })).toBeNull();
  });
});

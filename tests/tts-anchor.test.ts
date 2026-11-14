import { describe, expect, it } from 'vitest';
import { anyRectInView, locateSpan } from '../src/core/tts-anchor';

describe('字符偏移 → 文本节点', () => {
  it('一句话落在两个节点上：起点在前、终点在后', () => {
    expect(locateSpan([5, 5], 2, 5)).toEqual({
      startIndex: 0,
      startOffset: 2,
      endIndex: 1,
      endOffset: 2,
    });
  });

  it('整块都念：从第一个字到最后一个字', () => {
    expect(locateSpan([5, 5], 0, 10)).toEqual({
      startIndex: 0,
      startOffset: 0,
      endIndex: 1,
      endOffset: 5,
    });
  });

  it('空文本节点跳过，不会把偏移落在它里面', () => {
    expect(locateSpan([5, 0, 5], 5, 3)).toEqual({
      startIndex: 2,
      startOffset: 0,
      endIndex: 2,
      endOffset: 3,
    });
  });

  it('终点正好压在节点边界上：归前一个节点的末尾', () => {
    expect(locateSpan([5, 5], 0, 5)).toEqual({
      startIndex: 0,
      startOffset: 0,
      endIndex: 0,
      endOffset: 5,
    });
  });

  it('起点越界或长度不为正：不框', () => {
    expect(locateSpan([5, 5], 10, 1)).toBeNull();
    expect(locateSpan([5, 5], 3, 0)).toBeNull();
    expect(locateSpan([], 0, 1)).toBeNull();
  });

  it('终点超出总长：截到末尾，仍然框得出来', () => {
    expect(locateSpan([5, 5], 4, 100)).toEqual({
      startIndex: 0,
      startOffset: 4,
      endIndex: 1,
      endOffset: 5,
    });
  });

  it('负数起点按 0 处理', () => {
    expect(locateSpan([5], -3, 2)).toEqual({ startIndex: 0, startOffset: 0, endIndex: 0, endOffset: 2 });
  });
});

/* 分页模式下 `getClientRects()` 是当前栏的视口坐标：屏外那一栏是负数或
   大于宽度，所以在 iframe 里比就行，不需要搬回宿主再比。 */
describe('这一句在不在眼前', () => {
  const rect = (left: number, top: number, right: number, bottom: number) => ({
    left,
    top,
    right,
    bottom,
  });

  it('有一行落在视口里就算在眼前', () => {
    expect(anyRectInView([rect(-900, 10, -500, 40), rect(20, 100, 600, 130)], 632, 900)).toBe(true);
  });

  it('整句都在屏外（上一栏 / 下一栏）：不在眼前', () => {
    expect(anyRectInView([rect(-900, 10, -500, 40)], 632, 900)).toBe(false);
    expect(anyRectInView([rect(700, 10, 1200, 40)], 632, 900)).toBe(false);
  });

  it('纵向在视口外（上面 / 下面那一屏）：不在眼前', () => {
    expect(anyRectInView([rect(20, -200, 600, -160)], 632, 900)).toBe(false);
    expect(anyRectInView([rect(20, 1200, 600, 1240)], 632, 900)).toBe(false);
  });

  it('视口尺寸拿不到时按「不在眼前」处理，别乱翻页', () => {
    expect(anyRectInView([rect(0, 0, 100, 20)], 0, 0)).toBe(false);
  });
});

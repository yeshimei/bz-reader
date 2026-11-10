import { describe, expect, it } from 'vitest';
import { caretPointAt } from '../src/engine/host';

/* ============================================================
 * 视口坐标 → 插入点。
 *
 * 「可见区文字」要用两个插入点夹出一个 Range 才能取到当前屏上的那几行；
 * 命中插入点有两套 API：标准的 caretPositionFromPoint（Chrome 128+）与
 * Chromium 私有的 caretRangeFromPoint（TS 里标了 deprecated）。
 * 这里只钉一件事：**先走标准 API，没有才退回老的**，两条路吐出的
 * (节点, 偏移) 必须一致——否则老内核上新 API 一上线，可见区文字会整体偏移。
 * ============================================================ */

const NODE = { nodeName: '#text' } as unknown as Node;

function posDoc(pos: { offsetNode: Node; offset: number } | null): Document {
  return {
    caretPositionFromPoint: () => pos,
  } as unknown as Document;
}

function rangeDoc(range: { startContainer: Node; startOffset: number } | null): Document {
  return {
    caretRangeFromPoint: () => range,
  } as unknown as Document;
}

describe('caretPointAt', () => {
  it('有标准 API 时走 caretPositionFromPoint', () => {
    const doc = posDoc({ offsetNode: NODE, offset: 7 });
    expect(caretPointAt(doc, 2, 2)).toEqual({ node: NODE, offset: 7 });
  });

  it('标准 API 返回 null（点在空白处）时不再退回老 API，直接给 null', () => {
    const doc = {
      caretPositionFromPoint: () => null,
      caretRangeFromPoint: () => ({ startContainer: NODE, startOffset: 3 }),
    } as unknown as Document;
    /* 两套 API 在同一个内核里同时存在时，标准 API 说「这里没有插入点」
       就是没有——再问老 API 只会得到它自己的另一套边界语义，容易在
       页边留一格错位。 */
    expect(caretPointAt(doc, 2, 2)).toBeNull();
  });

  it('只有老 API 的内核（Electron 更早的版本）退回 caretRangeFromPoint', () => {
    const doc = rangeDoc({ startContainer: NODE, startOffset: 3 });
    expect(caretPointAt(doc, 5, 5)).toEqual({ node: NODE, offset: 3 });
  });

  it('两套 API 都没有时给 null，调用方据此退回整章', () => {
    expect(caretPointAt({} as Document, 1, 1)).toBeNull();
  });

  it('老 API 抛错时也不炸，按没有插入点处理', () => {
    const doc = {
      caretRangeFromPoint: () => {
        throw new Error('boom');
      },
    } as unknown as Document;
    expect(caretPointAt(doc, 1, 1)).toBeNull();
  });
});

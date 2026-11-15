/* ============================================================
 * 批量识别的「继续生成 / 重新生成」（tests/pdf-ocr-scope.test.ts）
 *
 * 点「接下来 20 页」或「整本」先给一句确认：这批里已有多少、新的多少，
 * 再让用户选只补新的，还是整批重认。范围必须按真实页数算（书末不足 20
 * 页时不能凑数），两条路要跑的页号也要和弹窗里报的数一致。
 * ============================================================ */
import { describe, expect, it } from 'vitest';
import { OCR_BATCH, ocrQueue, ocrScopeStats } from '../src/shell/pdf-ocr';

const setOf = (...pages: number[]) => new Set(pages);

describe('一批识别的范围', () => {
  it('从当前页起数 20 页，分开已有与新页', () => {
    const s = ocrScopeStats(100, 30, setOf(30, 31, 32), OCR_BATCH);
    expect(s).toMatchObject({
      first: 30,
      last: 49,
      total: 20,
      existing: 3,
      fresh: 17,
      canContinue: true,
      canRedo: true,
    });
    expect(s.continuePages).toEqual(Array.from({ length: 17 }, (_, i) => i + 33));
    expect(s.redoPages).toEqual(Array.from({ length: 20 }, (_, i) => i + 30));
  });

  it('快到书末时按实际页数算，不硬凑 20 页', () => {
    const s = ocrScopeStats(35, 30, setOf(), OCR_BATCH);
    expect(s).toMatchObject({ first: 30, last: 35, total: 6, existing: 0, fresh: 6 });
    expect(s.redoPages).toEqual([30, 31, 32, 33, 34, 35]);
  });

  it('整本从第 1 页到最后一页', () => {
    const s = ocrScopeStats(35, 1, setOf(2, 3), 35);
    expect(s).toMatchObject({ first: 1, last: 35, total: 35, existing: 2, fresh: 33 });
    expect(s.continuePages[0]).toBe(1);
    expect(s.continuePages).not.toContain(2);
    expect(s.continuePages).not.toContain(3);
  });

  it('这一批全认过：不给「继续生成」，只给「重新生成」', () => {
    const s = ocrScopeStats(10, 1, setOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), OCR_BATCH);
    expect(s).toMatchObject({ total: 10, existing: 10, fresh: 0, canContinue: false, canRedo: true });
    expect(s.continuePages).toEqual([]);
    expect(s.redoPages).toHaveLength(10);
  });

  it('这一批一张都没认过：不给「重新生成」', () => {
    const s = ocrScopeStats(10, 1, setOf(), OCR_BATCH);
    expect(s).toMatchObject({ existing: 0, fresh: 10, canContinue: true, canRedo: false });
  });

  it('页码超出书尾：范围为空，两个按钮都不该给', () => {
    const s = ocrScopeStats(10, 99, setOf(), OCR_BATCH);
    expect(s).toMatchObject({ first: 0, last: 0, total: 0, canContinue: false, canRedo: false });
    expect(s.continuePages).toEqual([]);
    expect(s.redoPages).toEqual([]);
  });
});

describe('重新生成时的页队列', () => {
  it('继续生成跳过已认页，重新生成把已认页也排进去', () => {
    const existing = setOf(1, 2);
    expect(ocrQueue(10, 1, existing, 5)).toEqual([3, 4, 5, 6, 7]);
    expect(ocrQueue(10, 1, existing, 5, true)).toEqual([1, 2, 3, 4, 5]);
  });

  it('重新生成也受这一批的页数上限约束', () => {
    expect(ocrQueue(10, 1, setOf(), 3, true)).toEqual([1, 2, 3]);
    expect(ocrQueue(3, 1, setOf(1, 2, 3), 3, true)).toEqual([1, 2, 3]);
  });
});

/**
 * PDF 渲染失败页的重试（tests/pdf-retry-failed.test.ts）
 *
 * 缩放 / 旋转会让旧尺寸的渲染结论作废。若失败页标记一直留着，
 * enqueue 会永久跳过它——旋转后空壳页没画布也没提示，缩放后旧错误提示
 * 一直挂着。这里锁的是「换视角时失败集合被清空、返回的页号可供清 DOM」。
 */
import { describe, expect, it } from 'vitest';
import { resetFailedPages } from '../src/engine/pdf/retry-failed';

describe('PDF 失败页重试', () => {
  it('清空失败集合并返回原来的页号', () => {
    const failed = new Set([2, 5]);
    expect(resetFailedPages(failed)).toEqual([2, 5]);
    expect(failed.size).toBe(0);
  });

  it('没有失败页时返回空数组', () => {
    const failed = new Set<number>();
    expect(resetFailedPages(failed)).toEqual([]);
    expect(failed.size).toBe(0);
  });
});

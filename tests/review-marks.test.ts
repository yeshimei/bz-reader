import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetReviewMarks,
  markReviewNextDate,
  markReviewPlanned,
  reviewDueState,
  setMarkReviewPlanned,
} from '../src/shell/review-marks';

/**
 * 工具栏那颗「复习 / 已在复习」靠这份内存缓存同步作答：
 * 开书时批量问一次 Review，之后不再阻塞渲染。
 */
describe('划线复习状态缓存', () => {
  beforeEach(() => forgetReviewMarks());

  it('默认不在计划里', () => {
    expect(markReviewPlanned('b1', 'h1')).toBe(false);
  });

  it('写进去之后按书 + 划线精确命中', () => {
    setMarkReviewPlanned('b1', 'h1');
    expect(markReviewPlanned('b1', 'h1')).toBe(true);
    expect(markReviewPlanned('b1', 'h2')).toBe(false);
    expect(markReviewPlanned('b2', 'h1')).toBe(false);
  });

  it('同一本书清空只动这一本', () => {
    setMarkReviewPlanned('b1', 'h1');
    setMarkReviewPlanned('b2', 'h1');
    forgetReviewMarks('b1');
    expect(markReviewPlanned('b1', 'h1')).toBe(false);
    expect(markReviewPlanned('b2', 'h1')).toBe(true);
  });

  it('空 id 不写、不报错（划词路径没有划线 id）', () => {
    setMarkReviewPlanned('', 'h1');
    setMarkReviewPlanned('b1', '');
    expect(markReviewPlanned('', '')).toBe(false);
    expect(markReviewPlanned(undefined, undefined)).toBe(false);
  });

  it('可以取消标记（移出复习计划后）', () => {
    setMarkReviewPlanned('b1', 'h1');
    setMarkReviewPlanned('b1', 'h1', false);
    expect(markReviewPlanned('b1', 'h1')).toBe(false);
  });

  it('缓存下次复习日期', () => {
    setMarkReviewPlanned('b1', 'h1', true, '2026-11-23T09:00:00.000Z');
    expect(markReviewNextDate('b1', 'h1')).toBe('2026-11-23T09:00:00.000Z');
  });
});

describe('reviewDueState', () => {
  const now = new Date(2026, 10, 20, 15, 0, 0).getTime();

  it('没有排期时没有状态', () => {
    expect(reviewDueState(null, now)).toEqual({ due: null, days: null });
  });

  it('今天到期显示去复习', () => {
    expect(reviewDueState(new Date(2026, 10, 20, 9, 0, 0).toISOString(), now)).toEqual({ due: 'today', days: 0 });
  });

  it('过期显示逾期天数', () => {
    expect(reviewDueState(new Date(2026, 10, 17, 9, 0, 0).toISOString(), now)).toEqual({ due: 'overdue', days: 3 });
  });

  it('未到期显示剩余天数', () => {
    expect(reviewDueState(new Date(2026, 10, 23, 9, 0, 0).toISOString(), now)).toEqual({ due: 'future', days: 3 });
  });
});

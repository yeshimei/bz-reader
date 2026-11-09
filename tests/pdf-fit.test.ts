import { describe, expect, it } from 'vitest';
import { fitScaleFor, needsFitWidth, pickFitSize } from '../src/engine/pdf/fit';

/* 《千亿个太阳》的真机尺寸：封面比正文窄三分之一，正是溢出的来源 */
const COVER = { width: 471.8, height: 681.3 };
const BODY = { width: 707, height: 1046.2 };
const BODY_LAST = { width: 707, height: 1079.3 };

describe('pdf fit', () => {
  it('适配基准取所有页里最宽、最高的那页', () => {
    expect(pickFitSize([COVER, BODY, BODY_LAST])).toEqual({ width: 707, height: 1079.3 });
  });

  it('没有可用尺寸时回退到 Letter，不返回 0（0 会让缩放算成无穷大）', () => {
    expect(pickFitSize([])).toEqual({ width: 612, height: 792 });
    expect(pickFitSize([{ width: 0, height: 0 }])).toEqual({ width: 612, height: 792 });
    expect(pickFitSize([{ width: Number.NaN, height: 10 }, null, undefined])).toEqual({
      width: 612,
      height: 792,
    });
  });

  it('适合宽度：按最宽的页算，任何一页都不会超出可用宽度（封面比正文窄的回归）', () => {
    const sizes = [COVER, BODY];
    const avail = { width: 1729, height: 958 };
    const scale = fitScaleFor('width', pickFitSize(sizes), avail, 12);
    for (const page of sizes) {
      expect(Math.round(page.width * scale)).toBeLessThanOrEqual(avail.width);
    }
  });

  it('适合宽度只保证宽度，允许纵向滚动', () => {
    const scale = fitScaleFor('width', BODY, { width: 729, height: 958 }, 0);
    expect(scale).toBeCloseTo(729 / 707, 5);
  });

  it('适合页面：宽高都不超出，取两者里较小的那个', () => {
    const avail = { width: 1729, height: 958 };
    const scale = fitScaleFor('page', BODY, avail, 12);
    expect(scale).toBeCloseTo((958 - 24) / BODY.height, 5);
    expect(BODY.height * scale).toBeLessThanOrEqual(avail.height);
    expect(BODY.width * scale).toBeLessThanOrEqual(avail.width);
  });

  it('可用区域还没量出来（宽高为 0）时给一个能用的比例，不返回 0 或 Infinity', () => {
    const scale = fitScaleFor('width', BODY, { width: 0, height: 0 }, 12);
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeGreaterThanOrEqual(0.2);
    expect(scale).toBeLessThanOrEqual(8);
  });

  it('比例限幅在 0.2～8 之间', () => {
    expect(fitScaleFor('width', { width: 1, height: 1 }, { width: 100000, height: 100000 }, 0)).toBe(8);
    expect(fitScaleFor('page', { width: 100000, height: 100000 }, { width: 100, height: 100 }, 0)).toBe(0.2);
  });

  it('窄栏 / 手机：100% 摆不下整页宽时，首屏该退到「适合宽度」', () => {
    /* 手机竖屏 390px 看 A4 正文（595pt）：100% 一定横向溢出 */
    expect(needsFitWidth(BODY.width, 390, 12)).toBe(true);
    /* 桌面宽栏放得下：保持 100%，不要把书放大 */
    expect(needsFitWidth(BODY.width, 900, 12)).toBe(false);
    /* 刚好塞得下（减掉两侧留白后）就不动 */
    expect(needsFitWidth(400, 424, 12)).toBe(false);
    /* 宽度还没量出来（0）时不判断：等 ResizeObserver 报一次再说 */
    expect(needsFitWidth(BODY.width, 0, 12)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  COLUMN_CAP,
  COLUMN_FALLBACK,
  columnMaxInlineSize,
} from '../src/engine/column-width';

/**
 * 2026-11-13 用户反馈：宽屏上双栏正文两边各空一大片（实测阅读区 2386，
 * 正文只有 1440——分页器默认每栏 720px 封顶，与窗口无关）。
 * 这里锁住「每栏跟着窗口走、但封顶 880」的算术。
 */
describe('columnMaxInlineSize', () => {
  it('窄窗口下等于窗口的一半，与旧行为逐像素一致', () => {
    // 1365 的窗口双栏：旧行为本来就是「窗口宽减去列间距」，这里给到 682，
    // 分页器再按窗口收窄，最终正文照样铺满。
    expect(columnMaxInlineSize(1365, 2)).toBe(682);
    expect(columnMaxInlineSize(1024, 2)).toBe(512);
  });

  it('单栏在窄窗口下直接跟窗口一样宽', () => {
    expect(columnMaxInlineSize(600, 1)).toBe(600);
    expect(columnMaxInlineSize(800, 1)).toBe(800);
    // 超过 880 之后单栏也收窄：一行四十多个字读起来比空白更难受
    expect(columnMaxInlineSize(1365, 1)).toBe(880);
  });

  it('宽屏上封顶 880，不再被 720 锁住', () => {
    expect(columnMaxInlineSize(2386, 2)).toBe(COLUMN_CAP);
    expect(columnMaxInlineSize(2386, 1)).toBe(COLUMN_CAP);
    expect(columnMaxInlineSize(4000, 2)).toBe(COLUMN_CAP);
  });

  it('封顶之前先按栏数平分', () => {
    // 1700 双栏 = 850（还没到 880），说明平分优先于封顶
    expect(columnMaxInlineSize(1700, 2)).toBe(850);
    // 1761 双栏 = 880（刚好触顶）
    expect(columnMaxInlineSize(1761, 2)).toBe(880);
  });

  it('拿不到阅读区宽度时退回上游默认 720', () => {
    expect(columnMaxInlineSize(0, 2)).toBe(COLUMN_FALLBACK);
    expect(columnMaxInlineSize(Number.NaN, 1)).toBe(COLUMN_FALLBACK);
    expect(columnMaxInlineSize(-100, 2)).toBe(COLUMN_FALLBACK);
  });

  it('极小窗口算出的宽度不为 0', () => {
    expect(columnMaxInlineSize(1, 2)).toBe(1);
    expect(columnMaxInlineSize(3, 2)).toBe(1);
  });

  it('栏数只认 1 和 2，其它值按双栏处理', () => {
    expect(columnMaxInlineSize(2000, 0)).toBe(880);
    expect(columnMaxInlineSize(2000, 3)).toBe(880);
  });
});

import { describe, expect, it } from 'vitest';
import { clampQuoteLines, regionCropRect, regionShotSize } from '../src/shell/region-card';

/* ============================================================
 * 框选区域存图（2026-11-15）。
 *
 * 只测纯函数：真出图要 canvas，node 里没有。这里钉住三件事——
 *   · 区域坐标要按出图角度换算，转着看的页不能裁歪；
 *   · 截图在卡片里按宽铺满、超高按高缩，不撑爆版面；
 *   · 引文按字符断行，超出行数补省略号（中文没有空格，不能按词断）。
 * ============================================================ */

const measure = (s: string): number => s.length * 10;

describe('区域裁切', () => {
  it('0 度原样返回', () => {
    const rect = { left: 0.1, top: 0.2, width: 0.3, height: 0.4 };
    expect(regionCropRect(rect, 0)).toEqual(rect);
  });

  it('90 度：宽高互换，左上角的小块转到右上角', () => {
    const rect = { left: 0, top: 0, width: 0.5, height: 0.1 };
    const out = regionCropRect(rect, 90);
    expect(out.width).toBeCloseTo(0.1, 6);
    expect(out.height).toBeCloseTo(0.5, 6);
    expect(out.left).toBeCloseTo(0.9, 6);
    expect(out.top).toBeCloseTo(0, 6);
  });

  it('270 度转回来：宽高再换一次', () => {
    const rect = { left: 0.2, top: 0.1, width: 0.4, height: 0.2 };
    const out = regionCropRect(rect, 270);
    expect(out.width).toBeCloseTo(0.2, 6);
    expect(out.height).toBeCloseTo(0.4, 6);
  });
});

describe('截图在卡片里的尺寸', () => {
  it('宽图按可用宽度铺满', () => {
    expect(regionShotSize(800, 600)).toEqual({ width: 672, height: 504 });
  });

  it('竖长图按高度封顶，宽度跟着缩', () => {
    const out = regionShotSize(300, 2000);
    expect(out.height).toBe(520);
    expect(out.width).toBeLessThan(300);
    expect(out.width).toBe(Math.round(300 * (520 / 2000)));
  });

  it('极端值不返回 0 或负数', () => {
    expect(regionShotSize(0, 0).width).toBeGreaterThan(0);
    expect(regionShotSize(Number.NaN, 10).height).toBeGreaterThan(0);
  });
});

describe('引文断行', () => {
  it('中文按字断，不按空格', () => {
    expect(clampQuoteLines('一二三四五六', 30, measure, 2)).toEqual(['一二三', '四五六']);
  });

  it('超出行数补省略号', () => {
    expect(clampQuoteLines('一二三四五六七八', 20, measure, 1)).toEqual(['一二…']);
  });

  it('空引文返回空数组（只出截图）', () => {
    expect(clampQuoteLines('   ', 100, measure)).toEqual([]);
    expect(clampQuoteLines('', 100, measure)).toEqual([]);
  });
});

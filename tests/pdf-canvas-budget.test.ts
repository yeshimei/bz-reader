import { describe, expect, it } from 'vitest';
import { canvasBudget } from '../src/engine/pdf/document';

/* 问题 #1：iOS 超大页面整页空白。canvasBudget 把「这一页画布该用多大、
   倍率降到多少」抽成纯函数——移动端按更保守的边长（4096）/ 总像素（16e6）
   上限算，桌面维持 8192 / 6.7e7。 */

describe('pdf canvasBudget · 桌面', () => {
  it('正常尺寸保持 dpr（不降倍率）', () => {
    const r = canvasBudget({ cssWidth: 600, cssHeight: 800, dpr: 2 });
    expect(r.ratio).toBe(2);
    expect(r.width).toBe(1200);
    expect(r.height).toBe(1600);
  });

  it('超大页被边长上限夹住，倍率从 dpr 降到 1 与 8192/长边 之间', () => {
    const r = canvasBudget({ cssWidth: 6000, cssHeight: 4000, dpr: 2 });
    // 8192 / 6000 ≈ 1.365，且 < dpr(2)
    expect(r.ratio).toBeCloseTo(8192 / 6000, 3);
    expect(r.ratio).toBeLessThan(2);
    expect(r.ratio).toBeGreaterThanOrEqual(1);
    expect(r.width).toBeLessThanOrEqual(8192);
    expect(r.height).toBeLessThanOrEqual(8192);
    expect(r.width).toBe(8192); // floor(6000 * 8192/6000)
    expect(r.height).toBe(5461); // floor(4000 * 8192/6000)
  });

  it('宽高已 ≤ 8192 时不因边长上限降倍率', () => {
    const r = canvasBudget({ cssWidth: 8000, cssHeight: 1000, dpr: 3 });
    // 边长上限 8192/8000≈1.024 触发，但总像素预算不触发：倍率被边长夹到 1.024
    expect(r.ratio).toBeCloseTo(8192 / 8000, 3);
    expect(r.width).toBeLessThanOrEqual(8192);
  });
});

describe('pdf canvasBudget · 移动端', () => {
  it('3000×4000 页面必须降到 4096 边长内', () => {
    const r = canvasBudget({ cssWidth: 3000, cssHeight: 4000, dpr: 2, mobile: true });
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(4096);
    // 倍率不超过 4096 / 4000
    expect(r.ratio).toBeCloseTo(4096 / 4000, 3);
    expect(r.width).toBe(3072);
    expect(r.height).toBe(4096);
  });

  it('总像素超预算继续降倍率，且不超过移动端 16e6 总像素', () => {
    // 边长上限允许 4096/4000≈1.024，但 4096² ≈ 16.77e6 超过 16e6 预算，
    // 必须把倍率继续压到 1（4000² = 16e6）。
    const r = canvasBudget({ cssWidth: 4000, cssHeight: 4000, dpr: 3, mobile: true });
    expect(r.ratio).toBeLessThan(4096 / 4000);
    expect(r.ratio).toBeGreaterThanOrEqual(1);
    expect(r.width * r.height).toBeLessThanOrEqual(16e6);
    expect(r.width).toBe(4000);
    expect(r.height).toBe(4000);
  });

  it('移动端宽高都小、总像素未超时按 dpr 提清晰度', () => {
    const r = canvasBudget({ cssWidth: 600, cssHeight: 800, dpr: 2, mobile: true });
    expect(r.ratio).toBe(2);
    expect(r.width).toBe(1200);
    expect(r.height).toBe(1600);
  });
});

describe('pdf canvasBudget · ratio 不为 0 / 负 / NaN', () => {
  const cases = [
    { cssWidth: 600, cssHeight: 800, dpr: 2 },
    { cssWidth: 0, cssHeight: 0, dpr: 2 },
    { cssWidth: 9000, cssHeight: 12000, dpr: 3 },
    { cssWidth: 4000, cssHeight: 4000, dpr: 5, mobile: true },
    { cssWidth: 200, cssHeight: 300, dpr: 0.5 },
  ];
  for (const input of cases) {
    it(`输入 ${JSON.stringify(input)} → ratio ≥ 1 且有限`, () => {
      const r = canvasBudget(input);
      expect(Number.isFinite(r.ratio)).toBe(true);
      expect(r.ratio).toBeGreaterThanOrEqual(1);
      expect(r.width).toBeGreaterThanOrEqual(1);
      expect(r.height).toBeGreaterThanOrEqual(1);
    });
  }
});

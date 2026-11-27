import { describe, expect, it } from 'vitest';
import { SAFE_TOP_MAX, SAFE_TOP_MIN, safeTopFor } from '../src/view/safe-top';

/**
 * 2026-11-27 真机反馈：移动端「上方一大片空白」，只有带章节名的书（含剪藏成书）
 * 出现。查下来是 --bzr-safe-top 被算成几百 px——它只喂给 `.bzs-rpages` 的
 * padding-top，而那条规则只在 has-chapter 时命中。
 *
 * 旧公式 `inset - rootTop` 没有上限：安全区变量异常大、或阅读区顶边为负时，
 * 会算出几百 px，正文被整段推下去。
 */
describe('safeTopFor', () => {
  it('宿主已经让位：补 0', () => {
    expect(safeTopFor(47, 47)).toBe(0);
    expect(safeTopFor(59, 80)).toBe(0);
    expect(safeTopFor(44, 60)).toBe(0);
  });

  it('宿主一点没让位：补到安全区本身', () => {
    expect(safeTopFor(47, 0)).toBe(47);
    expect(safeTopFor(44, 0)).toBe(44);
    expect(safeTopFor(59, 20)).toBe(39);
  });

  it('阅读区顶边为负（沉浸模式上移出屏幕）：按 0 算，不会爆掉', () => {
    expect(safeTopFor(47, -280)).toBe(47);
    expect(safeTopFor(44, -9999)).toBe(44);
  });

  it('安全区变量异常大：视为不可信，退回最小值', () => {
    expect(safeTopFor(320, 0)).toBe(SAFE_TOP_MIN);
    expect(safeTopFor(SAFE_TOP_MAX + 1, 0)).toBe(SAFE_TOP_MIN);
    expect(safeTopFor(9999, 0)).toBe(SAFE_TOP_MIN);
  });

  it('安全区变量缺失或非法：用最小值', () => {
    expect(safeTopFor(Number.NaN, 0)).toBe(SAFE_TOP_MIN);
    expect(safeTopFor(0, 0)).toBe(SAFE_TOP_MIN);
    expect(safeTopFor(-5, 0)).toBe(SAFE_TOP_MIN);
  });

  it('结果永远是 0 ~ 安全区之间，不会超过上限', () => {
    const tops = [-999, -100, -1, 0, 20, 40, 47, 60, 200];
    for (const top of tops) {
      for (const inset of [0, 44, 47, 59, 120, 121, 320, 9999]) {
        const v = safeTopFor(inset, top);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(SAFE_TOP_MAX);
      }
    }
  });
});

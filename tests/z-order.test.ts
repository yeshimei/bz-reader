import { describe, expect, it } from 'vitest';
import { __resetZForTests, allocZ, allocZAbove } from '../src/core/z-order';

/** 只要 style.zIndex 的假元素：本模块只读这一个字段 */
const el = (z: string | number): HTMLElement => ({ style: { zIndex: String(z) } }) as unknown as HTMLElement;

/* ============================================================
 * 复现：更新日志的二次确认弹窗被自己的主窗遮住（2026-11-18 真机）
 *
 * 主窗遮罩是 allocZ() 发的号（起点 100000），确认弹窗早期写死 z-index:300，
 * 于是永远在上百层之下。allocZAbove 保证「比给定那层再高一档」。
 * ============================================================ */
describe('z-order · allocZAbove', () => {
  it('严格高于传入元素的当前层级', () => {
    __resetZForTests();
    const mask = el(100003);
    const z = allocZAbove(mask);
    expect(z).toBeGreaterThan(100003);
  });

  it('给几层就按最高的那层再往上加', () => {
    __resetZForTests();
    const z = allocZAbove(el(100002), el(100050), el(100010));
    expect(z).toBeGreaterThan(100050);
  });

  it('没给元素时等同普通发号，仍从 100000 之上起步', () => {
    __resetZForTests();
    expect(allocZAbove()).toBeGreaterThan(100000);
    expect(allocZAbove(undefined, null)).toBeGreaterThan(100000);
  });

  it('元素上是 auto / 空串这类非数字时忽略，不把层级算成 NaN', () => {
    __resetZForTests();
    const z = allocZAbove(el('auto'), el(''));
    expect(Number.isFinite(z)).toBe(true);
    expect(z).toBeGreaterThan(100000);
  });

  it('连续发号单调递增（后显示的永远在上）', () => {
    __resetZForTests();
    const a = allocZAbove(el(100000));
    const b = allocZAbove(el(100000));
    expect(b).toBeGreaterThan(a);
    expect(allocZ()).toBeGreaterThan(b);
  });
});

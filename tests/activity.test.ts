import { describe, expect, it } from 'vitest';
import { accrueTick } from '../src/engine/activity';

/**
 * 回归目标：频繁翻页时阅读时长被严重少记。
 *
 * 旧实现是 `+= min(TICK, now - lastActive)`：每 15 秒一拍，若用户每 3 秒翻一页，
 * 一拍只记 3 秒，一小时真实阅读记成十几分钟。正确口径是「这一拍内活跃就记一拍」。
 */
describe('accrueTick', () => {
  const TICK = 15_000;

  it('整拍活跃：记满一拍', () => {
    expect(accrueTick({ now: 15_000, lastTickAt: 0, lastActive: 12_000 })).toBe(TICK);
  });

  it('用户刚翻过页（距上次活动 3 秒）也记满一拍', () => {
    expect(accrueTick({ now: 15_000, lastTickAt: 0, lastActive: 12_000 })).toBe(TICK);
  });

  it('超过 IDLE 没动作：这一拍不计', () => {
    expect(accrueTick({ now: 90_000, lastTickAt: 75_000, lastActive: 10_000 })).toBe(0);
  });

  it('恰好等于 IDLE 边界：不计（>= 即视为离开）', () => {
    expect(accrueTick({ now: 70_000, lastTickAt: 55_000, lastActive: 10_000, idleMs: 60_000 })).toBe(0);
  });

  it('系统挂起后回来：最多按一拍算，不把整段都记成阅读', () => {
    expect(accrueTick({ now: 300_000, lastTickAt: 0, lastActive: 299_000 })).toBe(TICK);
  });

  it('时间倒流 / 非法值不记', () => {
    expect(accrueTick({ now: 100, lastTickAt: 200, lastActive: 0 })).toBe(0);
    expect(accrueTick({ now: NaN, lastTickAt: 0, lastActive: 0 })).toBe(0);
  });
});

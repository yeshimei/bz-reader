import { describe, expect, it } from 'vitest';
import { ActivityTracker, accrueTick } from '../src/engine/activity';

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

describe('ActivityTracker.settle · 切章不丢尾段', () => {
  it('停 20 秒切走：整拍 15 秒 + 尾段 5 秒都要结算给章节时钟', () => {
    const orig = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      setInterval: () => 1,
      clearInterval: () => undefined,
    };
    try {
      const tracker = new ActivityTracker();
      const got: number[] = [];
      tracker.setSink((sec) => got.push(sec));
      tracker.begin(0);
      /* 模拟「已经过了一拍 15 秒 + 又过了 5 秒」：上一拍记在 15 秒前，
         用户 1 秒前还有动作（活跃）。 */
      const t = tracker as unknown as { lastTickAt: number; lastActive: number };
      t.lastTickAt = Date.now() - 5_000;
      t.lastActive = Date.now() - 1_000;
      tracker.settle();
      expect(got.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(4.5);
      expect(got.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(5.5);
      tracker.end();
    } finally {
      (globalThis as { window?: unknown }).window = orig;
    }
  });
});

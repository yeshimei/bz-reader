import { describe, expect, it } from 'vitest';
import { nextInterruptState } from '../src/engine/activity';

/**
 * 会话中断次数（2026-11-18）：离开超过 1 分钟再回来算一次。
 * 纯状态机：活跃→离开记一次，连续离开不重复记，回来→再离开才记第二次。
 */
describe('nextInterruptState', () => {
  it('一直活跃不算中断', () => {
    const s = nextInterruptState({ lastActive: 100_000, now: 105_000, wasIdle: false });
    expect(s).toEqual({ idle: false, countDelta: 0 });
  });

  it('从活跃转离开记一次', () => {
    const s = nextInterruptState({ lastActive: 10_000, now: 80_000, wasIdle: false });
    expect(s).toEqual({ idle: true, countDelta: 1 });
  });

  it('连续离开只记一次', () => {
    const s = nextInterruptState({ lastActive: 10_000, now: 95_000, wasIdle: true });
    expect(s).toEqual({ idle: true, countDelta: 0 });
  });

  it('回来后再离开记第二次', () => {
    const back = nextInterruptState({ lastActive: 95_000, now: 96_000, wasIdle: true });
    expect(back).toEqual({ idle: false, countDelta: 0 });
    const leave = nextInterruptState({ lastActive: 96_000, now: 170_000, wasIdle: false });
    expect(leave).toEqual({ idle: true, countDelta: 1 });
  });

  it('自定义 idle 阈值', () => {
    const s = nextInterruptState({ lastActive: 10_000, now: 25_000, wasIdle: false, idleMs: 10_000 });
    expect(s.countDelta).toBe(1);
  });
});

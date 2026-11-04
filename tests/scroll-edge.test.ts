import { describe, expect, it } from 'vitest';
import {
  accumulateEdgeTurn,
  scrollEdgeOf,
  SCROLL_EDGE_TURN,
  type EdgeAccumulator,
} from '../src/engine/scroll-edge';

/**
 * 滚动模式下「一章滚完 → 下一章」的纯判断。
 *
 * 为什么抽出来：真实滚动位置只有 paginator 的 getter 知道（start / end /
 * viewSize），node 里没有布局，装 jsdom 也测不出真实的滚动容器。这里只测
 * 「贴边 + 继续滚多少像素算要翻章」，host 负责把手势位移喂进来。
 */
describe('scrollEdgeOf', () => {
  const view = { start: 100, end: 580, viewSize: 2400 };

  it('中间位置：不在任何一边', () => {
    expect(scrollEdgeOf(view)).toBeNull();
  });

  it('滚到内容底部：贴底', () => {
    expect(scrollEdgeOf({ start: 1920, end: 2400, viewSize: 2400 })).toBe('bottom');
  });

  it('顶部偏移为 0（或惯性回弹的负值）：贴顶', () => {
    expect(scrollEdgeOf({ start: 0, end: 480, viewSize: 2400 })).toBe('top');
    expect(scrollEdgeOf({ start: -12, end: 468, viewSize: 2400 })).toBe('top');
  });

  it('内容还没排出来时不乱判', () => {
    expect(scrollEdgeOf({ start: 0, end: 0, viewSize: 0 })).toBeNull();
    expect(scrollEdgeOf({ start: Number.NaN, end: 1, viewSize: 2 })).toBeNull();
  });

  it('内容不足一屏：顶和底都算贴边（往哪边滚决定切哪一章）', () => {
    expect(scrollEdgeOf({ start: 0, end: 300, viewSize: 280 })).toBe('both');
  });
});

describe('accumulateEdgeTurn', () => {
  const idle: EdgeAccumulator = { acc: 0, side: null };

  it('没贴边：怎么滚都不切章，并清掉累计', () => {
    const r = accumulateEdgeTurn({ acc: 40, side: 'bottom' }, 60, null);
    expect(r.turn).toBeNull();
    expect(r.state).toEqual({ acc: 0, side: null });
  });

  it('贴底后向下滚：累计不够不动', () => {
    const r = accumulateEdgeTurn(idle, 20, 'bottom');
    expect(r.turn).toBeNull();
    expect(r.state.acc).toBe(20);
  });

  it('贴底后继续往下，累计够阈值才切下一章', () => {
    let state = idle;
    let turn: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const r = accumulateEdgeTurn(state, 15, 'bottom');
      state = r.state;
      if (r.turn) {
        turn = r.turn;
        break;
      }
    }
    expect(turn).toBe('next');
    expect(state.acc).toBe(0);
    expect(SCROLL_EDGE_TURN).toBeLessThanOrEqual(5 * 15);
  });

  it('贴顶后向上滚：切上一章', () => {
    let state = idle;
    let turn: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const r = accumulateEdgeTurn(state, -15, 'top');
      state = r.state;
      if (r.turn) {
        turn = r.turn;
        break;
      }
    }
    expect(turn).toBe('prev');
  });

  it('贴底却往上滚（回看两行）：不切章，累计清零', () => {
    const r = accumulateEdgeTurn({ acc: 30, side: 'bottom' }, -20, 'bottom');
    expect(r.turn).toBeNull();
    expect(r.state.acc).toBe(0);
  });

  it('换了一边就从零开始，不拿上一侧的位移凑数', () => {
    const r = accumulateEdgeTurn({ acc: 40, side: 'bottom' }, 20, 'top');
    expect(r.turn).toBeNull();
    expect(r.state).toEqual({ acc: 0, side: null });
  });

  it('不足一屏的短章：往下滚切下一章，往上滚切上一章', () => {
    let state = idle;
    let next: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const r = accumulateEdgeTurn(state, 15, 'both');
      state = r.state;
      if (r.turn) {
        next = r.turn;
        break;
      }
    }
    expect(next).toBe('next');

    let prev: string | null = null;
    state = idle;
    for (let i = 0; i < 5; i += 1) {
      const r = accumulateEdgeTurn(state, -15, 'both');
      state = r.state;
      if (r.turn) {
        prev = r.turn;
        break;
      }
    }
    expect(prev).toBe('prev');
  });
});

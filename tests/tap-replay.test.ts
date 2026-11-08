import { describe, expect, it } from 'vitest';
import {
  REPLAY_MS,
  REPLAY_PX,
  isReplayTap,
  touchTapVerdict,
  type TapGesture,
} from '../src/engine/tap-replay';

/**
 * 一次点按会被两条路各报一次（pointer 与 touch）。
 *
 * 真机反馈（iPhone）：翻页点了一两下之后彻底没反应，只能关书重开。
 * 根因是引擎原先用「pointer 走过一次完整的 pointerup」当唯一开关，
 * 走过之后就永久关掉 touch 兜底；而 iOS 上 touchmove 一旦被分页器
 * preventDefault，WKWebView 会派 pointercancel 而不是 pointerup，
 * 从此两条路都不产出点按。
 *
 * 放开的代价是重复上报：两条路必须能各自独立翻页，同时一次手势只算一次。
 * 所以判据是「时间极近 + 位置几乎不动」——同一次触摸的两个事件。
 */
describe('isReplayTap', () => {
  it('第一次点按：没有上一次可比，不是重播', () => {
    expect(isReplayTap(null, 1000, 100, 200)).toBe(false);
  });

  it('pointer 刚报完，touchend 紧接着报同一坐标：算重播，只翻一页', () => {
    const last = { at: 1000, x: 100, y: 200 };
    expect(isReplayTap(last, 1008, 100, 200)).toBe(true);
  });

  it('两次连点：人最快也得百毫秒以上，不能被吞掉', () => {
    const last = { at: 1000, x: 100, y: 200 };
    expect(isReplayTap(last, 1000 + REPLAY_MS, 100, 200)).toBe(false);
    expect(isReplayTap(last, 1200, 100, 200)).toBe(false);
  });

  it('时间很近但位置差得远：是另一根手指 / 另一次点击，不是重播', () => {
    const last = { at: 1000, x: 100, y: 200 };
    expect(isReplayTap(last, 1005, 100 + REPLAY_PX + 1, 200)).toBe(false);
    expect(isReplayTap(last, 1005, 100, 200 + REPLAY_PX + 1)).toBe(false);
  });

  it('窗口内小幅抖动（真机两条路取的坐标偶尔差零点几像素）：仍算同一次', () => {
    const last = { at: 1000, x: 100, y: 200 };
    expect(isReplayTap(last, 1010, 100.4, 200.6)).toBe(true);
  });
});

/**
 * touchend 捕获层的裁决。真机反馈（Android）：一次点按翻两页、中间闪一下。
 *
 * 时间窗（isReplayTap 的 80ms）在手机上靠不住：pointerup 这一下会同步触发
 * 滚动 + 整章重排 + 进度落盘，主线程被占住之后 touchend 才被派发，
 * 间隔常常上百毫秒，于是同一个手势被当成两次点按。
 *
 * 所以真正的判据是手势身份：pointer 这条路报过就把它记在这次手势上，
 * touchend 到了直接闭嘴——不看时间，也不看坐标差不差得开。
 */
describe('touchTapVerdict', () => {
  const base = (patch: Partial<TapGesture> = {}): TapGesture => ({
    x: 100,
    y: 200,
    at: 1000,
    moved: 0,
    fingers: 1,
    reported: false,
    ...patch,
  });
  const opts = (patch: { now?: number; remaining?: number } = {}): {
    now: number;
    remaining: number;
    longPressMs: number;
    movePx: number;
  } => ({ now: 1010, remaining: 0, longPressMs: 500, movePx: 12, ...patch });

  it('没有进行中的手势：什么都不做', () => {
    expect(touchTapVerdict(null, opts())).toBe('skip');
    expect(touchTapVerdict(undefined, opts())).toBe('skip');
  });

  it('普通单指点按：由触摸这条路补上这一次', () => {
    expect(touchTapVerdict(base(), opts())).toBe('report');
  });

  it('pointer 已经为同一手势报过：不再上报，但这条 touchend 仍要吞掉', () => {
    expect(touchTapVerdict(base({ reported: true }), opts())).toBe('settled');
  });

  it('pointer 报得很早、touchend 迟到几百毫秒：照样算同一手势', () => {
    /* 今天那个 bug 就是这一条：主线程被翻页占住，touchend 隔了 300ms 才到，
       80ms 的时间窗判不出来，于是又翻一页。手势身份不看时间。 */
    expect(touchTapVerdict(base({ reported: true }), opts({ now: 1300 }))).toBe('settled');
  });

  it('手指还在屏上（多指还没抬完）：不是这次手势的结束', () => {
    expect(touchTapVerdict(base(), opts({ remaining: 1 }))).toBe('skip');
  });

  it('起手就是两指：不是点按', () => {
    expect(touchTapVerdict(base({ fingers: 2 }), opts())).toBe('skip');
  });

  it('长按：不翻页，也不能吞掉 touchend（分页器还要用它收尾）', () => {
    expect(touchTapVerdict(base(), opts({ now: 1600 }))).toBe('skip');
  });

  it('拖动过：不翻页，交给分页器吸附', () => {
    expect(touchTapVerdict(base({ moved: 40 }), opts())).toBe('skip');
  });

  it('pointer 报过之后紧接着又拖动了：仍然只算一次，不重复上报', () => {
    /* reported 优先于位移判定：这一次手势的翻页已经发生，touchend 不该再来一次 */
    expect(touchTapVerdict(base({ reported: true, moved: 40 }), opts())).toBe('settled');
  });
});

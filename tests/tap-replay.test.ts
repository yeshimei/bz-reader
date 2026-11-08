import { describe, expect, it } from 'vitest';
import { REPLAY_MS, REPLAY_PX, isReplayTap } from '../src/engine/tap-replay';

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
